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
import {
  appContainerPort,
  appPathFor,
  gatewayAliasFor,
  gatewayHost,
  identityHeadersForApp,
  IDENTITY_HEADERS,
  type App,
} from '../domain';

export const ANSICHT_IDENTITY = {
  userId: 'lokal-ansicht',
  email: 'ansicht@local.test',
} as const;

/** Header, die nie vom Browser an die App durchgehen. */
const DROP_REQUEST_HEADERS = new Set([
  ...IDENTITY_HEADERS.map((h) => h.toLowerCase()),
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
>;

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
}): Forward {
  const { app } = params;
  if (app.primaryDomain === null) {
    throw new Error(`App "${app.name}" ist nicht deployt`);
  }
  if (!params.path.startsWith(appPathFor(app.name))) {
    throw new Error(`Pfad "${params.path}" gehoert nicht zu App "${app.name}"`);
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.incoming)) {
    if (value === undefined || DROP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }

  const signed = identityHeadersForApp({
    app,
    identity: {
      ...ANSICHT_IDENTITY,
      groups: [],
      issuedAt: Math.floor((params.now ?? new Date()).getTime() / 1000),
    },
    masterSecret: params.masterSecret,
  });
  const host = gatewayHost(app.primaryDomain);
  Object.assign(headers, signed, {
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
      ? '<p>Noch keine App deployt. Erst <code>./infra/lokal/apps-ausrollen.sh</code> laufen lassen.</p>'
      : `<ul>${deployed
          .map(
            (a) =>
              `<li><a href="${appPathFor(a.name)}">${escapeHtml(a.displayName)}</a> <code>${escapeHtml(a.name)}</code></li>`,
          )
          .join('')}</ul>`;
  return `<!doctype html><meta charset="utf-8"><title>openapps lokal</title>
<body style="font-family:system-ui;margin:3rem;max-width:40rem">
<h1>openapps lokal</h1>
<p>Angemeldet als <code>${ANSICHT_IDENTITY.email}</code>, nur auf diesem Rechner.</p>
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
      res.end('Keine deployte App unter diesem Pfad.');
      return;
    }

    const forward = buildForward({
      app,
      path,
      incoming: req.headers,
      masterSecret: options.masterSecret,
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
      console.error('[ansehen]', error);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('App nicht erreichbar.');
    });
  });
}

async function main(): Promise<void> {
  if (process.env.OPENAPPS_BACKEND !== 'lokal') {
    throw new Error('lokal-ansehen laeuft nur mit OPENAPPS_BACKEND=lokal');
  }
  const masterSecret = process.env.OPENAPPS_AUTH_MASTER_SECRET;
  if (masterSecret === undefined || masterSecret === '') {
    throw new Error('OPENAPPS_AUTH_MASTER_SECRET fehlt');
  }
  const { getPool } = await import('./pg/pool');
  const { createAppRepository } = await import('./pg/repositories');
  const apps = createAppRepository(getPool());

  const port = Number(process.env.ANSEHEN_PORT ?? '8090');
  createAnsichtServer({
    masterSecret,
    findApp: (name) => apps.findByName(name),
    listApps: () => apps.listAll(),
  }).listen(port, '0.0.0.0', () => {
    console.log(`[ansehen] http://127.0.0.1:${String(port)} (nur lokal)`);
  });
}

if (process.argv[1]?.endsWith('lokal-ansehen.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
