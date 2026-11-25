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
  appContainerPort,
  appPathFor,
  gatewayAliasFor,
  gatewayHost,
  GATEWAY_RESPONSE_HEADERS,
  identityHeadersForApp,
  navHeadersForApp,
  type App,
} from '../domain';

export const ANSICHT_IDENTITY = {
  userId: 'local-viewer',
  email: 'viewer@local.test',
} as const;

/** Header, die nie vom Browser an die App durchgehen. */
const DROP_REQUEST_HEADERS = new Set([
  // Identitaet und Navigation (ADR 0017): Sonst setzt der Browser eigene
  // Links in die Leiste.
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
  const host = gatewayHost(app.primaryDomain);
  Object.assign(headers, signed, nav, {
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

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Startseite: die deployten Apps als Links. Leer und Fehler sind eigene Faelle. */
export function indexPage(apps: readonly AnsichtApp[]): string {
  const deployed = apps.filter((a) => a.primaryDomain !== null);
  const body =
    deployed.length === 0
      ? '<p>No app deployed yet. Run <code>./infra/lokal/apps-ausrollen.sh</code> first.</p>'
      : `<ul>${deployed
          .map(
            (a) =>
              `<li><a href="${appPathFor(a.name)}">${escapeHtml(a.displayName)}</a> <code>${escapeHtml(a.name)}</code></li>`,
          )
          .join('')}</ul>`;
  return `<!doctype html><meta charset="utf-8"><title>openapps local</title>
<body style="font-family:system-ui;margin:3rem;max-width:40rem">
<h1>openapps local</h1>
<p>Signed in as <code>${ANSICHT_IDENTITY.email}</code>, on this machine only.</p>
${body}</body>`;
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
}) {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = req.url ?? '/';
    if (path === '/' || path === '') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(indexPage(await options.listApps()));
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
    try {
      nav = ansichtNav({
        apps: await options.listApps(),
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
  const { createAppRepository } = await import('./pg/repositories');
  const apps = createAppRepository(getPool());

  const port = Number(process.env.ANSEHEN_PORT ?? '8090');
  const cpPort = Number(process.env.ANSEHEN_CP_PORT ?? '8091');
  createAnsichtServer({
    masterSecret,
    findApp: (name) => apps.findByName(name),
    listApps: () => apps.listAll(),
    origin: process.env.ANSEHEN_ORIGIN ?? `http://127.0.0.1:${String(port)}`,
    platformUrl: process.env.ANSEHEN_PLATFORM_URL ?? `http://127.0.0.1:${String(cpPort)}`,
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
