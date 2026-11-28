/**
 * Die Oberflaechen der Apps im lokalen Betrieb ansehen, ohne Google-Login
 * (infra/lokal, ADR 0013).
 *
 * Ein kleiner Proxy auf `127.0.0.1:8090`, der jede Anfrage als **ein fester
 * lokaler Nutzer** signiert und direkt an den Container der App gibt, so wie
 * der Plattform-MCP es fuer Agents tut (ADR 0011). Er laeuft nur:
 *
 * - mit `OPENAPPS_BACKEND=lokal` — sonst bricht er beim Start ab;
 * - als eigener Dienst im Compose-Profil `ansehen`, nur am Loopback.
 *
 * Warum das kein zweiter Weg herein ist: Die Control Plane bekommt keinen
 * Login dazu, `src/lib/auth.ts` bleibt bei Google allein. Der Proxy braucht
 * das Master-Secret und die Owner-DSN — wer beides hat, kann ohnehin jede
 * Signatur bilden. Er macht nichts moeglich, was dieser Rechner nicht schon
 * kann; er macht es nur bequem, und nur hier.
 *
 * Was er nicht kann: Rechte pruefen. Apps enthalten keinen Rechte-Code
 * (CLAUDE.md 3), und der Proxy ersetzt die Forward-Auth nicht — er
 * ueberspringt sie. Deshalb gehoert er nie auf einen Server.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { PlatformNav } from '@openapps/sdk';
import type { LokalAuth } from './lokal-ansehen-cp';
import {
  actionHref,
  actionsAccepting,
  appContainerPort,
  appPathFor,
  cleanExcerpt,
  federateSearch,
  filterBacklinks,
  parseRefList,
  PLATFORM_PEOPLE_PATH,
  PLATFORM_REFS_ACTIONS_PATH,
  PLATFORM_REFS_BACKLINKS_PATH,
  PLATFORM_REFS_RESOLVE_PATH,
  REF_LIST_LIMITS,
  REF_RESOLVE_LIMITS,
  resolveInApp,
  gatewayAliasFor,
  gatewayHost,
  GATEWAY_RESPONSE_HEADERS,
  identityHeadersForApp,
  isSearchable,
  navHeadersForApp,
  parseSearchRequest,
  PLATFORM_SEARCH_LIMITS,
  PLATFORM_SEARCH_PATH,
  readableAppsHeadersForApp,
  searchToolOf,
  ValidationError,
  wantsReadableApps,
  type App,
  type AppToolInvoker,
  type Person,
  type PlatformSearchResult,
  type RefCache,
  type RefRepository,
  type RefResolution,
  type SearchTarget,
} from '../domain';
import { parseObjectRef, parseRef, type ObjectRef } from '@openapps/sdk';

export const ANSICHT_IDENTITY = {
  userId: 'local-viewer',
  email: 'viewer@local.test',
} as const;

/** Header, die nie vom Browser an die App durchgehen. */
const DROP_REQUEST_HEADERS = new Set([
  // Identitaet, Navigation (ADR 0017) und lesbare Apps (ADR 0020): Sonst
  // setzt der Browser eigene Links in die Leiste oder eine eigene Liste
  // lesbarer Apps in die Suche.
  ...GATEWAY_RESPONSE_HEADERS.map((h) => h.toLowerCase()),
  'host',
  'connection',
  'x-forwarded-host',
  'x-forwarded-for',
  'x-forwarded-proto',
  'cookie',
  'origin',
]);

/**
 * Die eigenen Adressen des Proxys. Nur eine Anfrage, die von hier kommt,
 * bekommt die Origin der App — Next prueft bei Server Actions, dass Origin
 * und `x-forwarded-host` zusammenpassen (CSRF-Schutz). Jede andere Origin
 * geht unveraendert durch, und Next lehnt sie weiter ab: Eine fremde Seite im
 * Browser kann ueber den Proxy keine Aktion ausloesen.
 */
export const OWN_ORIGINS: ReadonlySet<string> = new Set([
  'http://127.0.0.1:8090',
  'http://localhost:8090',
]);

export type AnsichtApp = Pick<
  App,
  'name' | 'displayName' | 'primaryDomain' | 'authSecretGeneration' | 'manifest'
> &
  Partial<Pick<App, 'category'>>;

/** Adresse des Proxys selbst; die Links der Leiste zeigen hierher. */
export const DEFAULT_ANSICHT_ORIGIN = 'http://127.0.0.1:8090';

/** Die Control Plane im lokalen Betrieb (ADR 0014, `lokal-ansehen-cp.ts`). */
export const DEFAULT_ANSICHT_PLATFORM_URL = 'http://127.0.0.1:8091';

/**
 * Die Navigation des lokalen Betrachters (ADR 0017). Er hat keine echten
 * Freigaben — der Proxy ueberspringt die Forward-Auth (siehe Dateikopf) —,
 * also sieht er alle deployten Apps. Apps anlegen darf er, Administrator ist
 * er nicht: Die Verwaltung unter `platformUrl` prueft ihre Rechte selbst.
 */
export function ansichtNav(params: {
  readonly apps: readonly AnsichtApp[];
  readonly origin?: string;
  readonly platformUrl?: string;
}): PlatformNav {
  const origin = (params.origin ?? DEFAULT_ANSICHT_ORIGIN).replace(/\/+$/, '');
  return {
    v: 1,
    platformUrl: params.platformUrl ?? DEFAULT_ANSICHT_PLATFORM_URL,
    apps: params.apps
      .filter((a) => a.primaryDomain !== null)
      .map((a) => ({
        name: a.name,
        title: a.displayName,
        category: a.category ?? null,
        href: `${origin}${appPathFor(a.name)}`,
      })),
    canCreateApps: true,
    isAdmin: false,
  };
}

export interface Forward {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** Name der App aus dem Pfad: `/crm/deals` → `crm`. */
export function appNameFromPath(path: string): string | null {
  const match = /^\/([a-z][a-z0-9-]{1,40})(?:[/?]|$)/.exec(path);
  return match?.[1] ?? null;
}

/**
 * Baut die Weiterleitung: Ziel direkt am Container, Identitaets-Header frisch
 * signiert, alles, was der Browser an Identitaet mitschickt, verworfen.
 */
export function buildForward(params: {
  readonly app: AnsichtApp;
  readonly path: string;
  readonly incoming: Readonly<Record<string, string | string[] | undefined>>;
  readonly masterSecret: string;
  readonly now?: Date;
  /** Navigation der Leiste; ohne sie gehen beide Nav-Header leer raus. */
  readonly nav?: PlatformNav | null;
  /**
   * Lesbare Apps (ADR 0020), nur wenn das Manifest der App sie anfordert.
   * Der Betrachter sieht wie in der Leiste alle Apps (siehe `ansichtNav`).
   */
  readonly readableApps?: readonly string[] | null;
}): Forward {
  const { app } = params;
  if (app.primaryDomain === null) {
    throw new Error(`App "${app.name}" is not deployed`);
  }
  if (!params.path.startsWith(appPathFor(app.name))) {
    throw new Error(`path "${params.path}" does not belong to app "${app.name}"`);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.incoming)) {
    if (value === undefined || DROP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }

  const identity = {
    ...ANSICHT_IDENTITY,
    groups: [],
    issuedAt: Math.floor((params.now ?? new Date()).getTime() / 1000),
  };
  const signed = identityHeadersForApp({ app, identity, masterSecret: params.masterSecret });
  // Wie die Forward-Auth: beide Nav-Header immer gesetzt, notfalls leer.
  const nav = navHeadersForApp({
    app,
    identity,
    masterSecret: params.masterSecret,
    nav: params.nav ?? null,
  });
  // Wie die Forward-Auth: immer gesetzt, leer ohne Anforderung im Manifest.
  const readable = readableAppsHeadersForApp({
    app,
    identity,
    masterSecret: params.masterSecret,
    apps: wantsReadableApps(app) ? (params.readableApps ?? null) : null,
  });
  const host = gatewayHost(app.primaryDomain);
  Object.assign(headers, signed, nav, readable, {
    'x-forwarded-host': host,
    'x-forwarded-proto': 'https',
  });
  const origin = params.incoming.origin ?? params.incoming.Origin;
  if (typeof origin === 'string') {
    headers.origin = OWN_ORIGINS.has(origin) ? `https://${host}` : origin;
  }

  return {
    url: `http://${gatewayAliasFor(app.name)}:${appContainerPort(app)}${params.path}`,
    headers,
  };
}

/**
 * Die Suche ueber alle Apps fuer den Betrachter (ADR 0021). Auf dem Server
 * fuehrt Traefik `/_platform/search` zur Control Plane, die die Session
 * prueft. Hier gibt es keine Session und keine Forward-Auth (Dateikopf);
 * der Proxy foederiert selbst, mit derselben Funktion wie die Control Plane
 * (`federateSearch`), als der Betrachter. Er sieht, wie in der Leiste, alle
 * deployten Apps. Die Links zeigen auf diesen Proxy.
 */
export async function ansichtSearch(params: {
  readonly apps: readonly AnsichtApp[];
  readonly url: URL;
  readonly invoker: AppToolInvoker;
  readonly origin?: string;
  readonly timeoutMs?: number;
}): Promise<PlatformSearchResult> {
  const {
    query,
    limit,
    apps: only,
  } = parseSearchRequest({
    query: params.url.searchParams.get('q') ?? '',
    ...(params.url.searchParams.get('limit') === null
      ? {}
      : { limit: Number(params.url.searchParams.get('limit')) }),
    ...(params.url.searchParams.get('apps') === null
      ? {}
      : {
          apps: (params.url.searchParams.get('apps') ?? '')
            .split(',')
            .map((name) => name.trim())
            .filter((name) => name !== ''),
        }),
  });
  const origin = (params.origin ?? DEFAULT_ANSICHT_ORIGIN).replace(/\/+$/, '');
  // Im Betrieb kommt die Liste aus `apps.listAll()` und traegt jedes Feld
  // einer App; `AnsichtApp` ist nur fuer die Tests schmaler. Der Invoker
  // liest davon Name, Domain, Manifest und Secret-Generation.
  const deployed = params.apps as readonly App[];
  const readable = deployed.map((a) => a.name);
  const targets: SearchTarget[] = deployed
    .filter((app) => isSearchableAnsicht(app) && (only === undefined || only.includes(app.name)))
    .map((app) => ({
      app,
      tool: searchToolOf(app) ?? '',
      baseHref: `${origin}${appPathFor(app.name)}`,
    }));
  const actor = { kind: 'user' as const, id: ANSICHT_IDENTITY.userId, groups: [] };
  const outcome = await federateSearch({
    targets,
    query,
    limit,
    timeoutMs: params.timeoutMs ?? PLATFORM_SEARCH_LIMITS.timeoutMs,
    call: (target, args, signal) =>
      params.invoker.invoke({
        app: target.app,
        toolName: target.tool,
        actor,
        args,
        readableApps: wantsReadableApps(target.app) ? readable : null,
        humanIdentity: { ...ANSICHT_IDENTITY, groups: [] },
        signal,
      }),
  });
  return { query, ...outcome };
}

/**
 * Verweise fuer den Betrachter (ADR 0023 F). Auf dem Server fuehrt Traefik
 * `/_platform/refs/…` und `/_platform/people` zur Control Plane, die die
 * Session prueft. Hier gibt es keine Session (Dateikopf): Der Betrachter
 * sieht wie in der Leiste alle deployten Apps, der Proxy loest mit
 * denselben Funktionen auf wie die Control Plane, als der Betrachter.
 */
export interface AnsichtRefsOptions {
  /** Eingehende Verweise; ohne sie sind die Rueckverweise leer. */
  readonly refs?: Pick<RefRepository, 'listIncoming'>;
  /** Wer in einer App erwaehnt werden kann; ohne sie ist die Liste leer. */
  readonly people?: (
    app: App,
    options: { readonly query: string; readonly limit: number },
  ) => Promise<readonly Person[]>;
  readonly cache?: RefCache;
}

export async function ansichtRefs(params: {
  readonly path: string;
  readonly apps: readonly AnsichtApp[];
  readonly url: URL;
  readonly invoker: AppToolInvoker;
  readonly origin?: string;
  readonly options?: AnsichtRefsOptions;
  readonly timeoutMs?: number;
}): Promise<unknown> {
  const origin = (params.origin ?? DEFAULT_ANSICHT_ORIGIN).replace(/\/+$/, '');
  // Wie bei der Suche: Im Betrieb traegt jede Zeile alle Felder einer App.
  const deployed = (params.apps as readonly App[]).filter((app) => app.primaryDomain !== null);
  const byName = new Map(deployed.map((app) => [app.name, app]));
  const appHref = (app: App) => `${origin}${appPathFor(app.name)}`;
  const actor = { kind: 'user' as const, id: ANSICHT_IDENTITY.userId, groups: [] };
  const search = params.url.searchParams;

  if (params.path === PLATFORM_REFS_RESOLVE_PATH) {
    const refs = parseRefList(
      [...search.getAll('ref'), ...search.getAll('refs').flatMap((value) => value.split(','))]
        .map((ref) => ref.trim())
        .filter((ref) => ref !== ''),
    );
    const results = new Map<string, RefResolution>();
    const perApp = new Map<string, ObjectRef[]>();
    for (const value of refs) {
      const parsed = parseRef(value);
      if (parsed === null) results.set(value, { ref: value, state: 'not_found' });
      else if (parsed.kind === 'subject') {
        results.set(value, {
          ref: value,
          state: 'resolved',
          kind: parsed.subjectKind,
          title: parsed.id,
        });
      } else perApp.set(parsed.app, [...(perApp.get(parsed.app) ?? []), parsed]);
    }
    await Promise.all(
      [...perApp.entries()].map(async ([name, appRefs]) => {
        const app = byName.get(name);
        if (app === undefined) {
          for (const ref of appRefs) results.set(ref.ref, { ref: ref.ref, state: 'restricted' });
          return;
        }
        const resolved = await resolveInApp({
          app,
          refs: appRefs,
          now: Date.now(),
          timeoutMs: params.timeoutMs ?? REF_RESOLVE_LIMITS.timeoutMs,
          appHref,
          ...(params.options?.cache === undefined ? {} : { cache: params.options.cache }),
          call: (tool, args, signal) =>
            params.invoker.invoke({
              app,
              toolName: tool,
              actor,
              args: { type: args.type, ids: [...args.ids] },
              readableApps: null,
              humanIdentity: { ...ANSICHT_IDENTITY, groups: [] },
              signal,
            }),
        });
        for (const [ref, resolution] of resolved) results.set(ref, resolution);
      }),
    );
    return {
      results: refs.map((ref): RefResolution => results.get(ref) ?? { ref, state: 'unavailable' }),
    };
  }

  if (params.path === PLATFORM_REFS_BACKLINKS_PATH) {
    const target = parseObjectRef(search.get('ref'));
    if (target === null)
      throw new ValidationError('ref must be an object reference <app>:<type>:<id>');
    if (params.options?.refs === undefined || !byName.has(target.app)) {
      return { ref: target.ref, backlinks: [] };
    }
    const incoming = await params.options.refs.listIncoming(target.ref, REF_LIST_LIMITS.backlinks);
    const backlinks = await filterBacklinks({
      incoming,
      findApp: async (name) => byName.get(name) ?? null,
      mayRead: async () => true,
    });
    return { ref: target.ref, backlinks };
  }

  if (params.path === PLATFORM_REFS_ACTIONS_PATH) {
    const source = parseObjectRef(search.get('ref'));
    if (source === null)
      throw new ValidationError('ref must be an object reference <app>:<type>:<id>');
    const excerpt = cleanExcerpt(search.get('excerpt'));
    return {
      ref: source.ref,
      actions: actionsAccepting(deployed, source)
        .filter(({ action }) => action.path !== undefined)
        .map(({ app, action }) => ({
          app: app.name,
          appTitle: app.displayName,
          name: action.name,
          title: action.title,
          tool: `${app.name}.${action.tool}`,
          href: actionHref(appHref(app), action.path ?? '/', source.ref, excerpt),
        })),
    };
  }

  if (params.path === PLATFORM_PEOPLE_PATH) {
    const app = byName.get(search.get('app') ?? '');
    const query = (search.get('q') ?? '').trim().toLowerCase().slice(0, REF_LIST_LIMITS.queryMax);
    if (app === undefined || params.options?.people === undefined) {
      return { app: search.get('app') ?? '', people: [] };
    }
    const people = await params.options.people(app, {
      query,
      limit: REF_LIST_LIMITS.peopleDefault,
    });
    return { app: app.name, people };
  }

  throw new ValidationError(`unknown platform path ${params.path}`);
}

/** Die Pfade der Verweise, die der Proxy selbst beantwortet. */
export const ANSICHT_REFS_PATHS: readonly string[] = [
  PLATFORM_REFS_RESOLVE_PATH,
  PLATFORM_REFS_BACKLINKS_PATH,
  PLATFORM_REFS_ACTIONS_PATH,
  PLATFORM_PEOPLE_PATH,
];

/** `isSearchable` fuer die schmalere Form; `listAll` liefert nur nicht archivierte Apps. */
function isSearchableAnsicht(app: AnsichtApp): boolean {
  return isSearchable({ ...app, archivedAt: null });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/**
 * Startseite: die deployten Apps als Links. Leer und Fehler sind eigene Faelle.
 *
 * Reines HTML aus dem Proxy, ohne `@openapps/ui`. Damit trotzdem keine eigenen
 * Farbwerte entstehen, nutzt sie nur die Systemfarben des Browsers
 * (`Canvas`, `CanvasText`, `GrayText`) und folgt so auch hell/dunkel. Form
 * wie ADR 0010: Mono-Wortmarke, Serifentitel, Haarlinien.
 */
export function indexPage(apps: readonly AnsichtApp[]): string {
  const deployed = apps.filter((a) => a.primaryDomain !== null);
  const body =
    deployed.length === 0
      ? '<p class="empty">No app deployed yet. Run <code>./infra/lokal/apps-ausrollen.sh</code> first.</p>'
      : `<ul>${deployed
          .map(
            (a) =>
              `<li><a href="${appPathFor(a.name)}"><span class="n">${escapeHtml(a.displayName)}</span><code>${escapeHtml(a.name)}</code><span class="go" aria-hidden="true">&rarr;</span></a></li>`,
          )
          .join('')}</ul>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>openapps local</title>
<style>
:root{color-scheme:light dark;font-family:'Helvetica Neue',Helvetica,ui-sans-serif,system-ui,sans-serif}
body{margin:0;background:Canvas;color:CanvasText;-webkit-font-smoothing:antialiased}
main{max-width:36rem;margin:0 auto;padding:4rem 1.25rem}
.brand{font:500 .75rem/1 ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;display:flex;align-items:center;gap:.5rem}
.brand::before{content:"";width:.625rem;height:.625rem;background:currentColor}
.brand small{font:inherit;color:GrayText;letter-spacing:.08em}
h1{font:400 2.25rem/1.1 'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;letter-spacing:-.02em;margin:2.5rem 0 .5rem}
p{margin:0;color:GrayText;font-size:.875rem;line-height:1.5}
code{font:.75rem ui-monospace,'SF Mono',Menlo,monospace}
ul{list-style:none;margin:2rem 0 0;padding:0;border-top:1px solid color-mix(in srgb,CanvasText 14%,Canvas)}
li a{display:flex;align-items:baseline;gap:.75rem;padding:.875rem .25rem;border-bottom:1px solid color-mix(in srgb,CanvasText 14%,Canvas);color:inherit;text-decoration:none}
li a:hover .n{text-decoration:underline;text-underline-offset:4px}
li a:focus-visible{outline:2px solid CanvasText;outline-offset:2px}
.n{font-weight:500;flex:1}
li code{color:GrayText}
.go{color:GrayText}
.empty{margin-top:2rem;padding:2rem;border:1px dashed GrayText;text-align:center}
</style>
<main>
<div class="brand">openapps<small>/ local</small></div>
<h1>Your apps</h1>
<p>Signed in as <code>${ANSICHT_IDENTITY.email}</code>, on this machine only.</p>
${body}
</main></html>`;
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export function createAnsichtServer(options: {
  readonly masterSecret: string;
  readonly findApp: (name: string) => Promise<AnsichtApp | null>;
  readonly listApps: () => Promise<readonly AnsichtApp[]>;
  /** Adresse des Proxys, fuer die Links der Leiste. */
  readonly origin?: string;
  /** Adresse der lokalen Control Plane, fuer die Leiste. */
  readonly platformUrl?: string;
  /** Fuer die Suche ueber alle Apps (ADR 0021). Ohne ihn antwortet sie mit 404. */
  readonly invoker?: AppToolInvoker;
  /** Verweise (ADR 0023): Rueckverweise und Personen; Aufloesen braucht nur `invoker`. */
  readonly refs?: AnsichtRefsOptions;
}) {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = req.url ?? '/';
    if (path === '/' || path === '') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(indexPage(await options.listApps()));
      return;
    }
    const url = new URL(path, 'http://ansicht.invalid');
    if (url.pathname === PLATFORM_SEARCH_PATH) {
      await searchResponse(req, res, url);
      return;
    }
    if (ANSICHT_REFS_PATHS.includes(url.pathname)) {
      await refsResponse(req, res, url);
      return;
    }
    const name = appNameFromPath(path);
    const app = name === null ? null : await options.findApp(name);
    if (app === null || app.primaryDomain === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('No deployed app at this path.');
      return;
    }

    // Navigation pro Aufruf, wie die Forward-Auth. Scheitert sie, bleibt die
    // Leiste leer und die Seite kommt trotzdem.
    let nav: PlatformNav | null = null;
    let readableApps: readonly string[] | null = null;
    try {
      const all = await options.listApps();
      // Der Betrachter hat keine echten Freigaben (Dateikopf); er sieht wie
      // in der Leiste alle Apps, auch in der Suche.
      readableApps = all.map((a) => a.name);
      nav = ansichtNav({
        apps: all,
        ...(options.origin === undefined ? {} : { origin: options.origin }),
        ...(options.platformUrl === undefined ? {} : { platformUrl: options.platformUrl }),
      });
    } catch (error) {
      console.error('[view] navigation not computed', error);
    }
    const forward = buildForward({
      app,
      path,
      incoming: req.headers,
      masterSecret: options.masterSecret,
      nav,
      readableApps,
    });
    const body = await readBody(req);
    const upstream = await fetch(forward.url, {
      method: req.method ?? 'GET',
      headers: forward.headers,
      redirect: 'manual',
      ...(body === undefined ? {} : { body }),
    });

    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      // fetch hat schon entpackt; Laenge und Kodierung stimmen nicht mehr.
      if (key === 'content-encoding' || key === 'content-length') return;
      headers[key] = value;
    });
    res.writeHead(upstream.status, headers);
    if (upstream.body === null) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
  };

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(body));
  };

  const searchResponse = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> => {
    if (req.method !== 'GET' || options.invoker === undefined) {
      json(res, 404, { error: 'not_found', message: 'no search here' });
      return;
    }
    try {
      const result = await ansichtSearch({
        apps: await options.listApps(),
        url,
        invoker: options.invoker,
        ...(options.origin === undefined ? {} : { origin: options.origin }),
      });
      json(res, 200, result);
    } catch (error) {
      if (error instanceof ValidationError) {
        json(res, 422, { error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  };

  const refsResponse = async (
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> => {
    if (req.method !== 'GET' || options.invoker === undefined) {
      json(res, 404, { error: 'not_found', message: 'no references here' });
      return;
    }
    try {
      json(
        res,
        200,
        await ansichtRefs({
          path: url.pathname,
          apps: await options.listApps(),
          url,
          invoker: options.invoker,
          ...(options.origin === undefined ? {} : { origin: options.origin }),
          ...(options.refs === undefined ? {} : { options: options.refs }),
        }),
      );
    } catch (error) {
      if (error instanceof ValidationError) {
        json(res, 422, { error: error.code, message: error.message });
        return;
      }
      throw error;
    }
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      console.error('[view]', error);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('App not reachable.');
    });
  });
}

async function main(): Promise<void> {
  if (process.env.OPENAPPS_BACKEND !== 'lokal') {
    throw new Error('lokal-ansehen only runs with OPENAPPS_BACKEND=lokal');
  }
  const masterSecret = process.env.OPENAPPS_AUTH_MASTER_SECRET;
  if (masterSecret === undefined || masterSecret === '') {
    throw new Error('OPENAPPS_AUTH_MASTER_SECRET is missing');
  }
  const { getPool } = await import('./pg/pool');
  const { createAppRepository, createAgentIdentityRepository, createGrantRepository } =
    await import('./pg/repositories');
  const { createGroupRepository } = await import('./pg/groups');
  const { createRefRepository } = await import('./pg/refs');
  const { createUserDirectory } = await import('./pg/events');
  const { createRefCache, peopleWithRead } = await import('../domain');
  const apps = createAppRepository(getPool());
  // Fuer die Verweise (ADR 0023): lesend auf Freigaben, Gruppen, Agents und Nutzer.
  const directory = {
    grants: createGrantRepository(getPool()),
    groups: createGroupRepository(getPool()),
    agents: createAgentIdentityRepository(getPool()),
    users: createUserDirectory(getPool()),
  };

  const port = Number(process.env.ANSEHEN_PORT ?? '8090');
  const cpPort = Number(process.env.ANSEHEN_CP_PORT ?? '8091');
  createAnsichtServer({
    masterSecret,
    findApp: (name) => apps.findByName(name),
    listApps: () => apps.listAll(),
    origin: process.env.ANSEHEN_ORIGIN ?? `http://127.0.0.1:${String(port)}`,
    platformUrl: process.env.ANSEHEN_PLATFORM_URL ?? `http://127.0.0.1:${String(cpPort)}`,
    // Dieselbe Weiterleitung wie fuer Agents, direkt an die Container.
    invoker: (await import('./app-tool-invoker')).createHttpInvoker({
      authMasterSecret: masterSecret,
    }),
    refs: {
      refs: createRefRepository(getPool()),
      people: (app, peopleOptions) => peopleWithRead(directory, app, peopleOptions),
      cache: createRefCache(),
    },
  }).listen(port, '0.0.0.0', () => {
    console.log(`[view] http://127.0.0.1:${String(port)} (local only)`);
  });

  // Die Control Plane (ADR 0014): Sessions ueber Better Auth mit den echten
  // Hooks, nur der Schritt bei Google faellt weg.
  const { createAuth } = await import('../lib/auth');
  const { readAuthEnv } = await import('../lib/env');
  const cp = await import('./lokal-ansehen-cp');
  const authEnv = readAuthEnv();
  const auth = createAuth({ pool: getPool(), env: authEnv });
  cp.createCpAnsichtServer({
    cpOrigin: authEnv.baseUrl,
    upstream: process.env.CONTROL_PLANE_SERVICE_URL ?? 'http://openapps-control-plane:3000',
    sessionFuer: (rolle) =>
      cp.lokaleSession(
        // Better Auth typisiert `$context` breiter; gebraucht wird nur der
        // Ausschnitt aus `LokalAuth` (findUserByEmail, createUser, createSession).
        auth as unknown as LokalAuth,
        cp.emailFuerRolle(rolle, authEnv),
      ),
  }).listen(cpPort, '0.0.0.0', () => {
    console.log(`[view] Control plane: http://127.0.0.1:${String(cpPort)} (local only)`);
  });
}

if (process.argv[1]?.endsWith('lokal-ansehen.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
