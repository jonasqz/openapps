/**
 * Im lokalen Betrieb zeigen Links der Verwaltung auf den Ansehen-Proxy
 * (wie `lib/shell-nav.ts` und die Suche), weil es die Hosts des Servers am
 * Loopback nicht gibt. Ueber das lokale Gateway (Host der Apps) bleibt es bei
 * dessen Links. Ausserhalb des lokalen Betriebs: keine Aenderung.
 */

import { appPathFor, type App } from '../domain';
import { DEFAULT_ANSICHT_ORIGIN } from '../infra/lokal-ansehen';

export function lokalAppHref(
  request: Request,
  controlPlaneHost: string,
): ((app: App) => string) | undefined {
  if (process.env.OPENAPPS_BACKEND !== 'lokal') return undefined;
  const raw = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '';
  const host = raw.trim().toLowerCase().split(':')[0] ?? '';
  if (host !== controlPlaneHost) return undefined;
  const origin = (process.env.ANSEHEN_ORIGIN ?? DEFAULT_ANSICHT_ORIGIN).replace(/\/+$/, '');
  return (app) => `${origin}${appPathFor(app.name)}`;
}
