/**
 * `GET /api/authz/forward` — die Forward-Auth (Spec Abschnitt 1.1).
 *
 * Traefik fragt sie **pro Aufruf**: Darf dieser Nutzer diese App-Domain
 * oeffnen? Das ist die groesste Annahme des Projekts und der Ort, an dem
 * Default-Deny am meisten zaehlt.
 *
 * Die Pruefkette, in dieser Reihenfolge:
 *
 * 1. Host bekannt? Ist es die Control Plane selbst, greift die Pfad-Allowlist
 *    aus Spec 1.3 — sonst entstuende ein Kreis: die Auth-Pruefung braeuchte
 *    eine Auth-Pruefung. Unbekannter Host → 403.
 * 2. Keine Session → 302 auf den Login.
 * 3. Keine Freigabe auf die App → 403.
 * 4. Sonst 200 mit den fuenf Identitaets-Headern aus Spec 3.1.
 *
 * Jede Antwort ausser 2xx heisst „nein". Auch ein Fehler in dieser Route heisst
 * „nein": es gibt keinen Pfad, auf dem ein Ausfall der Control Plane Apps
 * oeffnet. Nichts wird gecacht — ein Widerruf wirkt beim naechsten Aufruf.
 */

import { canAccessApp, identityHeadersForApp, recordAudit } from '../../../../domain';
import { currentUser } from '../../../../lib/actor';
import { readEnv } from '../../../../lib/env';
import { domainContext } from '../../../../lib/runtime';
import type { App } from '../../../../domain/types';

export const dynamic = 'force-dynamic';

/**
 * Pfade der Control Plane, die ohne Session erreichbar sind (Spec 1.3).
 * Sie stehen **im Code**, nicht in der Traefik-Konfiguration: eine
 * Konfigurationszeile kann ein Coolify-Update ueberschreiben, diese Zeile nicht.
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/api/auth/', // Better Auth
  '/api/authz/forward',
  '/healthz',
  '/_next/static/',
] as const;

export function isPublicControlPlanePath(path: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? path.startsWith(prefix)
      : path === prefix || path.startsWith(`${prefix}/`),
  );
}

async function handle(request: Request): Promise<Response> {
  try {
    const ctx = domainContext();
    const env = readEnv();

    // Traefik schickt die Original-Anfrage mit. Ohne Ziel-Host wissen wir
    // nicht, worueber wir entscheiden — also nein.
    const rawHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (rawHost === null) {
      return deny('keine Ziel-Domain im Aufruf');
    }
    const host = hostOnly(rawHost);
    const path = request.headers.get('x-forwarded-uri') ?? '/';

    // Schritt 1a: die Control Plane selbst.
    if (host === env.controlPlaneHost) {
      if (isPublicControlPlanePath(pathOnly(path))) {
        return new Response(null, { status: 200 });
      }
      const user = await currentUser(request);
      return user === null
        ? redirectToLogin(request, host, path)
        : new Response(null, { status: 200 });
    }

    // Schritt 1b: eine registrierte App-Domain?
    const app = await findAppByDomain(host);
    if (app === null) {
      // Eine Domain ohne App ist nicht „offen", sondern unbekannt.
      return deny(`keine App fuer Domain "${host}"`);
    }

    // Schritt 2: Session.
    const user = await currentUser(request);
    if (user === null) {
      return redirectToLogin(request, host, path);
    }

    // Schritt 3: Freigabe.
    const actor = { kind: 'user' as const, id: user.userId, groups: user.groups };
    const allowed = await canAccessApp(ctx, actor, 'read', app);

    await recordAudit(ctx, {
      actor,
      action: 'forward_auth',
      resource: { kind: 'app', id: app.id },
      outcome: allowed ? 'allowed' : 'denied',
      reason: allowed ? null : 'keine Freigabe auf die App',
      detail: { host, path },
    });

    if (!allowed) return deny('keine Freigabe auf die App');

    // Schritt 4: die fuenf Header, signiert mit dem Secret **dieser** App.
    const headers = identityHeadersForApp({
      app,
      identity: {
        userId: user.userId,
        email: user.email,
        groups: user.groups,
        issuedAt: Math.floor(ctx.clock.now().getTime() / 1000),
      },
      masterSecret: env.authMasterSecret,
    });
    return new Response(null, { status: 200, headers });
  } catch {
    return deny('Forward-Auth nicht entscheidbar');
  }
}

function deny(reason: string): Response {
  return new Response(reason, { status: 403, headers: { 'content-type': 'text/plain' } });
}

/**
 * 302 auf den Login, mit dem Ziel als Rueckweg. Traefik gibt 3xx an den Client
 * weiter (Spec Abschnitt 2), also landet der Nutzer beim Login und danach
 * wieder hier.
 */
function redirectToLogin(request: Request, host: string, path: string): Response {
  const login = new URL('/login', request.url);
  login.searchParams.set('next', `https://${host}${path.startsWith('/') ? path : `/${path}`}`);
  return new Response(null, { status: 302, headers: { location: login.toString() } });
}

/** Host ohne Port, kleingeschrieben — dieselbe Form wie `gatewayHost`. */
function hostOnly(value: string): string {
  const lower = value.trim().toLowerCase();
  const colon = lower.indexOf(':');
  return colon === -1 ? lower : lower.slice(0, colon);
}

function pathOnly(value: string): string {
  const query = value.indexOf('?');
  return query === -1 ? value : value.slice(0, query);
}

async function findAppByDomain(host: string): Promise<App | null> {
  // Ein Index-Treffer pro Aufruf, keine Liste: diese Route laeuft bei jedem
  // Request auf jede App-Domain.
  return domainContext().apps.findByDomain(host);
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
