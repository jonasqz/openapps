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
 *    eine Auth-Pruefung. Sonst sagt das **erste Pfadsegment**, welche App
 *    gemeint ist (ADR 0007: eine Domain, ein Pfad je App). Kein App-Pfad oder
 *    eine App, die nicht auf diesem Host liegt → 403.
 * 2. Keine Session → 302 auf den Login.
 * 3. Keine Freigabe auf die App → 403.
 * 4. Sonst 200 mit den fuenf Identitaets-Headern aus Spec 3.1.
 *
 * Jede Antwort ausser 2xx heisst „nein". Auch ein Fehler in dieser Route heisst
 * „nein": es gibt keinen Pfad, auf dem ein Ausfall der Control Plane Apps
 * oeffnet. Nichts wird gecacht — ein Widerruf wirkt beim naechsten Aufruf.
 */

import {
  appNameFromPath,
  canAccessApp,
  gatewayHost,
  identityHeadersForApp,
  recordAudit,
} from '../../../../domain';
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
  // Der Plattform-MCP (ADR 0009). Ohne Session erreichbar, aber nicht ohne
  // Ausweis: Ein Agent hat keinen Browser und keinen Cookie, er weist sich
  // mit seinem Token aus — und das prueft der MCP bei jedem Aufruf selbst.
  '/mcp',
] as const;

export function isPublicControlPlanePath(path: string): boolean {
  const normalized = normalizedPath(path);
  // Im Zweifel nicht oeffentlich: ein Pfad, den wir nicht eindeutig lesen
  // koennen, braucht eine Session.
  if (normalized === null) return false;
  return PUBLIC_PREFIXES.some((prefix) =>
    prefix.endsWith('/')
      ? normalized.startsWith(prefix)
      : normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

/**
 * Der Pfad, auf dem die Allowlist entscheidet — oder `null`, wenn er nicht
 * eindeutig ist.
 *
 * Grund: Ein reiner Praefix-Vergleich haelt `/login/../grants` fuer
 * oeffentlich. `X-Forwarded-Uri` kommt so, wie der Client ihn geschickt hat;
 * wir normalisieren nicht nach, sondern lehnen ab. Dasselbe gilt fuer eine
 * zweite Kodierung (`/login/%2e%2e/grants`): einmal dekodieren, dann pruefen.
 */
function normalizedPath(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\u0000')) {
    return null;
  }
  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  return decoded;
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
        ? redirectToLogin(env.controlPlaneHost, host, path)
        : new Response(null, { status: 200 });
    }

    // Schritt 1b: welche App? Unter ADR 0007 tragen alle Apps denselben Host,
    // also entscheidet der Pfad. Ein Pfad ohne App ist nicht „offen", sondern
    // unbekannt — auch `/` auf der gemeinsamen Domain.
    const app = await findAppForPath(pathOnly(path), host);
    if (app === null) {
      return deny(`keine App fuer "${host}${pathOnly(path)}"`);
    }

    // Schritt 2: Session.
    const user = await currentUser(request);
    if (user === null) {
      return redirectToLogin(env.controlPlaneHost, host, path);
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
 *
 * Die Adresse kommt aus `CONTROL_PLANE_HOST`, **nicht** aus `request.url`.
 * Diese Route wird von Traefik aufgerufen, nicht vom Browser: `request.url`
 * traegt die container-interne Adresse der Forward-Auth
 * (`http://openapps-control-plane:3000/api/authz/forward`). Ein Redirect
 * darauf schickt den Browser an einen Namen, den es im Netz des Nutzers nicht
 * gibt — der Login waere unerreichbar, und zwar genau in dem Fall, in dem er
 * gebraucht wird.
 *
 * `https` bei beiden Adressen: Unsere Router haengen an genau einem
 * Entrypoint, und das ist der mit TLS (`GATEWAY_ENTRYPOINT`, Default `https`).
 * Eine Weiterleitung auf `http` landete erst in Coolifys Umleitung auf https —
 * ein Umweg, den wir selbst gebaut haetten.
 */
function redirectToLogin(controlPlaneHost: string, host: string, path: string): Response {
  const login = new URL('/login', `https://${controlPlaneHost}`);
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

/**
 * Die App zu diesem Aufruf: abgeleitet aus dem ersten Pfadsegment, gegen das
 * Register geprueft.
 *
 * Zwei Pruefungen, und die zweite ist die wichtigere: Der Name muss eine
 * registrierte App treffen (ein Name allein oeffnet nichts), **und** diese App
 * muss auf diesem Host liegen. Ohne die zweite Pruefung wuerde jeder Host, den
 * Traefik an die Forward-Auth gibt, jede App freischalten — die Domain waere
 * dann kein Teil der Entscheidung mehr.
 *
 * Ein Index-Treffer pro Aufruf, keine Liste: diese Route laeuft bei jedem
 * Request auf jede App.
 */
async function findAppForPath(path: string, host: string): Promise<App | null> {
  const name = appNameFromPath(path);
  if (name === null) return null;

  const app = await domainContext().apps.findByName(name);
  if (app === null) return null;
  // Eine archivierte App ist keine App. `findByName` filtert nicht danach —
  // die Stelle, die entscheidet, muss es tun.
  if (app.archivedAt !== null) return null;
  if (app.primaryDomain === null || gatewayHost(app.primaryDomain) !== host) return null;
  return app;
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
