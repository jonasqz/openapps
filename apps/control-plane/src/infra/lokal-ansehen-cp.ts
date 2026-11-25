/**
 * Die Oberflaeche der Control Plane im lokalen Betrieb ansehen, ohne
 * Google-Login (ADR 0014). Teil des Ansehen-Proxys (`lokal-ansehen.ts`),
 * eigener Port `127.0.0.1:8091`.
 *
 * Was hier umgangen wird, und was nicht:
 *
 * - **Umgangen** wird nur der Schritt bei Google. Nutzer und Session entstehen
 *   ueber Better Auth selbst (`internalAdapter`), also mit denselben Hooks wie
 *   nach einem Google-Login: Die Domain-Schranke prueft die Adresse, und die
 *   Bootstrap-Admins landen in `platform-admins`. Eine Adresse ausserhalb von
 *   `AUTH_ALLOWED_EMAIL_DOMAINS` bekommt auch hier keine Session.
 * - **Nicht umgangen** wird das Rechtemodell. Die Control Plane liest die
 *   Session wie immer, die Gruppen aus der Datenbank, und jede Aktion prueft
 *   die Freigabe. Als `user` siehst du genau das, was ein Mensch ohne
 *   Freigaben sieht.
 *
 * Das Session-Cookie bekommt der Browser nie. Der Proxy haengt es nur an die
 * Anfrage nach innen. Und weil damit jede Anfrage an `127.0.0.1:8091`
 * angemeldet ist, laesst er schreibende Anfragen nur durch, wenn sie von
 * seiner eigenen Adresse kommen: Eine fremde Seite im Browser kann keine
 * Freigabe vergeben.
 */

import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { GATEWAY_RESPONSE_HEADERS } from '../domain';

export const ROLLEN = ['admin', 'user'] as const;
export type Rolle = (typeof ROLLEN)[number];

export const ROLLEN_COOKIE = 'openapps_local_role';
export const CP_OWN_ORIGINS: ReadonlySet<string> = new Set([
  'http://127.0.0.1:8091',
  'http://localhost:8091',
]);

/**
 * Die Adresse je Rolle. `admin` ist der erste Bootstrap-Admin (landet ueber
 * den Hook in `platform-admins`), `user` eine Adresse in der ersten
 * erlaubten Domain, ohne Gruppe und ohne Freigabe.
 */
export function emailFuerRolle(
  rolle: Rolle,
  env: {
    readonly bootstrapAdmins: readonly string[];
    readonly allowedEmailDomains: readonly string[];
  },
): string {
  if (rolle === 'admin') {
    const admin = env.bootstrapAdmins[0];
    if (admin === undefined) throw new Error('AUTH_BOOTSTRAP_ADMINS is empty: no local admin');
    return admin;
  }
  const domain = env.allowedEmailDomains[0];
  if (domain === undefined) throw new Error('AUTH_ALLOWED_EMAIL_DOMAINS is empty: no local user');
  return `user@${domain}`;
}

/** Wie better-call: `encodeURIComponent(token + "." + base64(HMAC-SHA256))`. */
export function signSessionToken(token: string, secret: string): string {
  const signature = createHmac('sha256', secret).update(token).digest('base64');
  return encodeURIComponent(`${token}.${signature}`);
}

export function rolleAusCookie(cookieHeader: string | undefined): Rolle {
  const match = new RegExp(`(?:^|;\\s*)${ROLLEN_COOKIE}=([a-z]+)`).exec(cookieHeader ?? '');
  const value = match?.[1];
  return value === 'user' ? 'user' : 'admin';
}

/** `/_local/as/user` → `user`; alles andere `null`. */
export function rollenwechsel(path: string): Rolle | null {
  const match = /^\/_local\/as\/([a-z]+)\/?$/.exec(path);
  const value = match?.[1];
  return value !== undefined && (ROLLEN as readonly string[]).includes(value)
    ? (value as Rolle)
    : null;
}

const DROP = new Set([
  // Identitaet und Navigation (ADR 0017): nie vom Browser.
  ...GATEWAY_RESPONSE_HEADERS.map((h) => h.toLowerCase()),
  'host',
  'connection',
  'cookie',
  'origin',
  'x-forwarded-host',
  'x-forwarded-for',
  'x-forwarded-proto',
  'authorization',
]);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class FremdeHerkunftError extends Error {}

/**
 * Baut die Anfrage nach innen. Wirft `FremdeHerkunftError`, wenn eine
 * schreibende Anfrage nicht von der eigenen Adresse kommt.
 */
export function buildCpForward(params: {
  readonly method: string;
  readonly path: string;
  readonly incoming: Readonly<Record<string, string | string[] | undefined>>;
  readonly session: { readonly cookieName: string; readonly value: string };
  /** `BETTER_AUTH_URL`, etwa `https://cp.local.test:8443`. */
  readonly cpOrigin: string;
  readonly upstream: string;
}): { url: string; headers: Record<string, string> } {
  const origin = params.incoming.origin;
  const ownOrigin = typeof origin === 'string' && CP_OWN_ORIGINS.has(origin);
  if (!SAFE_METHODS.has(params.method.toUpperCase()) && !ownOrigin) {
    throw new FremdeHerkunftError(
      `write request from "${typeof origin === 'string' ? origin : 'unknown'}" rejected`,
    );
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.incoming)) {
    if (value === undefined || DROP.has(key.toLowerCase())) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  const cp = new URL(params.cpOrigin);
  headers.cookie = `${params.session.cookieName}=${params.session.value}`;
  headers['x-forwarded-host'] = cp.host;
  headers['x-forwarded-proto'] = cp.protocol.replace(':', '');
  if (ownOrigin) headers.origin = cp.origin;

  return { url: `${params.upstream.replace(/\/+$/, '')}${params.path}`, headers };
}

/** Weiterleitungen der Control Plane auf ihre eigene Adresse zurueck auf den Proxy. */
export function rewriteLocation(location: string, cpOrigin: string): string {
  const origin = new URL(cpOrigin).origin;
  return location.startsWith(origin) ? location.slice(origin.length) || '/' : location;
}

/* -------------------------------------------------------------------------- */
/* Sessions und Server                                                         */
/* -------------------------------------------------------------------------- */

/** Das, was hier von Better Auth gebraucht wird. */
export interface LokalAuth {
  readonly $context: Promise<{
    readonly secret: string;
    readonly authCookies: { readonly sessionToken: { readonly name: string } };
    readonly internalAdapter: {
      findUserByEmail(email: string): Promise<{ user: { id: string } } | null>;
      createUser(user: {
        email: string;
        name: string;
        emailVerified: boolean;
      }): Promise<{ id: string }>;
      createSession(
        userId: string,
        request: undefined,
      ): Promise<{ token: string; expiresAt: Date }>;
    };
  }>;
}

export interface LokalSession {
  readonly cookieName: string;
  readonly value: string;
  readonly expiresAt: Date;
}

/**
 * Legt Nutzer (falls neu) und Session ueber Better Auth an. Die Hooks aus
 * `src/lib/auth.ts` laufen dabei mit: Domain-Schranke und Bootstrap-Gruppe.
 */
export async function lokaleSession(auth: LokalAuth, email: string): Promise<LokalSession> {
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email);
  const userId =
    found?.user.id ??
    (
      await ctx.internalAdapter.createUser({
        email,
        name: email.split('@')[0] ?? email,
        emailVerified: true,
      })
    ).id;
  const session = await ctx.internalAdapter.createSession(userId, undefined);
  return {
    cookieName: ctx.authCookies.sessionToken.name,
    value: signSessionToken(session.token, ctx.secret),
    expiresAt: session.expiresAt,
  };
}

export function createCpAnsichtServer(options: {
  readonly cpOrigin: string;
  readonly upstream: string;
  readonly sessionFuer: (rolle: Rolle) => Promise<LokalSession>;
}) {
  const cache = new Map<Rolle, LokalSession>();
  const sessionFuer = async (rolle: Rolle, frisch: boolean): Promise<LokalSession> => {
    const known = cache.get(rolle);
    if (!frisch && known !== undefined && known.expiresAt.getTime() > Date.now() + 60_000) {
      return known;
    }
    const created = await options.sessionFuer(rolle);
    cache.set(rolle, created);
    return created;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = req.url ?? '/';
    const wechsel = rollenwechsel(path);
    if (wechsel !== null) {
      res.writeHead(303, {
        location: '/',
        'set-cookie': `${ROLLEN_COOKIE}=${wechsel}; Path=/; HttpOnly; SameSite=Strict`,
      });
      res.end();
      return;
    }
    const rolle = rolleAusCookie(req.headers.cookie);
    const method = req.method ?? 'GET';
    const body = SAFE_METHODS.has(method.toUpperCase()) ? undefined : await readAll(req);

    const send = async (frisch: boolean): Promise<Response> => {
      const forward = buildCpForward({
        method,
        path,
        incoming: req.headers,
        session: await sessionFuer(rolle, frisch),
        cpOrigin: options.cpOrigin,
        upstream: options.upstream,
      });
      return fetch(forward.url, {
        method,
        headers: forward.headers,
        redirect: 'manual',
        ...(body === undefined ? {} : { body }),
      });
    };

    let upstream = await send(false);
    // Session abgelaufen oder abgemeldet: einmal mit frischer Session.
    if (
      upstream.status >= 300 &&
      upstream.status < 400 &&
      (upstream.headers.get('location') ?? '').includes('/login')
    ) {
      upstream = await send(true);
    }

    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      // Session-Cookies der Control Plane bleiben drinnen; Laenge und
      // Kodierung stimmen nach fetch nicht mehr.
      if (key === 'set-cookie' || key === 'content-encoding' || key === 'content-length') return;
      headers[key] = key === 'location' ? rewriteLocation(value, options.cpOrigin) : value;
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
      if (error instanceof FremdeHerkunftError) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(error.message);
        return;
      }
      console.error('[view-cp]', error);
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Control plane not reachable.');
    });
  });
}

async function readAll(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}
