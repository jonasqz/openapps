/**
 * Die Forward-Auth-Route. Traefik fragt sie **pro Aufruf**: Darf dieser Nutzer
 * diese App-Domain oeffnen?
 *
 * Das ist die groesste Annahme des Projekts (Brief) und der Ort, an dem
 * Default-Deny am meisten zaehlt. Die Regeln dieser Datei:
 *
 * 1. Jede Antwort ausser 200 heisst "nein". Jeder Fehler, jede fehlende
 *    Angabe, jede unbekannte Domain fuehrt zu 403 — nie zu 200.
 * 2. Ohne Session: 401 mit Weiterleitung zum Login.
 * 3. Mit Session, aber ohne Freigabe auf die App: 403.
 * 4. Erst bei Freigabe: 200 mit den Identitaets-Headern plus Signatur, damit
 *    die App dem Aufruf trauen kann (siehe lib/gateway.ts).
 * 5. Nichts wird gecacht. Ein Widerruf wirkt beim naechsten Aufruf.
 */

import { canAccessApp, recordAudit } from '../../../../domain';
import type { App } from '../../../../domain/types';
import { currentUser } from '../../../../lib/actor';
import { readEnv } from '../../../../lib/env';
import { identityHeaders } from '../../../../lib/gateway';
import { domainContext } from '../../../../lib/runtime';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  try {
    const ctx = domainContext();
    const env = readEnv();

    // Traefik schickt die angefragte Domain mit. Ohne sie wissen wir nicht,
    // worueber wir entscheiden — also nein.
    const domain =
      request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? null;
    if (domain === null) {
      return deny('keine Ziel-Domain im Aufruf');
    }

    const app = await findAppByDomain(domain);
    if (app === null) {
      // Eine Domain ohne App ist nicht "offen", sondern unbekannt.
      return deny(`keine App fuer Domain "${domain}"`);
    }

    const user = await currentUser(request);
    if (user === null) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', `https://${domain}`);
      return new Response(null, { status: 401, headers: { location: loginUrl.toString() } });
    }

    const actor = { kind: 'user' as const, id: user.userId, groups: user.groups };
    const allowed = await canAccessApp(ctx, actor, 'read', app);

    await recordAudit(ctx, {
      actor,
      action: 'forward_auth',
      resource: { kind: 'app', id: app.id },
      outcome: allowed ? 'allowed' : 'denied',
      reason: allowed ? null : 'keine Freigabe auf die App',
      detail: { domain },
    });

    if (!allowed) return deny('keine Freigabe auf die App');

    const headers = identityHeaders(
      {
        userId: user.userId,
        email: user.email,
        groups: user.groups,
        issuedAt: Math.floor(ctx.clock.now().getTime() / 1000),
      },
      env.gatewaySigningSecret,
    );
    return new Response(null, { status: 200, headers });
  } catch {
    // Auch ein Fehler in dieser Route ist ein "nein". Es gibt keinen Pfad,
    // auf dem ein Ausfall der Control Plane Apps oeffnet.
    return deny('Forward-Auth nicht entscheidbar');
  }
}

function deny(reason: string): Response {
  return new Response(reason, { status: 403, headers: { 'content-type': 'text/plain' } });
}

async function findAppByDomain(domain: string): Promise<App | null> {
  // Ein Index-Treffer pro Aufruf, keine Liste: diese Route laeuft bei jedem
  // Request auf jede App-Domain.
  const host = domain.split(':')[0] ?? domain;
  return domainContext().apps.findByDomain(host);
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
