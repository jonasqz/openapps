/**
 * App-Id und Host, wie sie ins Signatur-Material gehen.
 *
 * Diese zwei Funktionen sind der Grund, dass Gateway und App ueberhaupt
 * zusammenpassen. ADR 0004: `OPENAPPS_APP_ID` und `OPENAPPS_APP_HOST` muessen
 * **byte-gleich** dem entsprechen, was das Gateway signiert. Also gibt es genau
 * eine Quelle fuer beide Werte — hier —, und sowohl die Forward-Auth als auch
 * das Setzen der Env rufen sie.
 *
 * `@openapps/sdk` trimmt und kleinschreibt den Host aus der Env
 * (`resolveConfig`) und setzt ihn so ins Material. `gatewayHost` macht genau
 * dasselbe, damit die Normalisierung auf beiden Seiten identisch ist. Ohne das
 * passt keine Signatur, sobald jemand eine Domain mit Großbuchstaben oder einem
 * Leerzeichen eintraegt.
 */

import type { App } from './types';

/**
 * Die App-Id im Signatur-Material: der App-Name.
 *
 * Nicht die UUID: Der Name ist der Wert, den die Spec in ihrem Beispiel zeigt
 * (`12:projektliste`), er steht im Manifest, in der Domain und in jeder
 * Freigabe, und er ist in dieser Instanz eindeutig. Die UUID waere stabiler
 * gegen Umbenennungen — ein Umbenennen gibt es in v1 nicht, und wenn es kommt,
 * ist es ein Redeploy.
 */
export function appIdOf(app: Pick<App, 'name'>): string {
  return app.name;
}

/** Der Host, getrimmt und kleingeschrieben — wie das SDK ihn aus der Env liest. */
export function gatewayHost(domain: string): string {
  return domain.trim().toLowerCase();
}
