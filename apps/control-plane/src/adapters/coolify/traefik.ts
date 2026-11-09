/**
 * Die Traefik-Labels, die eine App hinter die Forward-Auth stellen.
 *
 * Das ist die groesste Annahme des Projekts (Brief): Bleiben diese Labels bei
 * Coolify-Updates stehen, ist jede App geschuetzt; kippen sie, ist jede App
 * offen. Deshalb werden sie hier **erzeugt** und nicht per Hand gepflegt, und
 * deshalb hat DoD 2 ein eigenes Testskript.
 *
 * Wichtig fuer das Gesamtbild: Diese Labels sind laut Spec 1.2 **nicht** die
 * Quelle des Schutzes. Die Middleware haengt am Entrypoint und gilt fuer jeden
 * Router, auch fuer die, die Coolify selbst anlegt; dazu kommt ein
 * Catch-all-Router mit Deny-Backend. Die Labels hier ordnen Host → Container zu
 * und bringen die zwei App-spezifischen Stuecke mit: das Entfernen
 * mitgeschickter `X-Auth-*`-Header und die Uebernahme der Antwort-Header.
 */

import { IDENTITY_HEADERS } from '../../domain';

export interface ForwardAuthLabelInput {
  /** Name der App, genutzt als Router- und Middleware-Name. */
  readonly appName: string;
  readonly domain: string;
  /** Erreichbare Adresse der Forward-Auth-Route der Control Plane. */
  readonly forwardAuthUrl: string;
}

/** Header-Name in der Form, in der Traefik-Labels ihn schreiben: `X-Auth-User-Id`. */
function headerLabelName(lowerCaseName: string): string {
  return lowerCaseName
    .split('-')
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

export function forwardAuthLabels(input: ForwardAuthLabelInput): Readonly<Record<string, string>> {
  const auth = `openapps-auth-${input.appName}`;
  const strip = `openapps-strip-${input.appName}`;
  const router = `openapps-${input.appName}`;

  const labels: Record<string, string> = {
    'traefik.enable': 'true',

    // 1. Alle `X-Auth-*` der eingehenden Anfrage entfernen, bevor die
    //    Forward-Auth ihre eigenen setzt. ADR 0004 nennt das als den Punkt, an
    //    dem das Modell wertlos wird, wenn er fehlt: ein vom Client
    //    mitgeschickter Header wuerde sonst durchgereicht. Ein leerer Wert in
    //    `customRequestHeaders` loescht den Header.
    //    Das ist Guertel **und** Hosentraeger: die fuenf Namen stehen auch in
    //    `authResponseHeaders` und wuerden dort ueberschrieben. Beides, weil
    //    eine Antwort ohne 200 keine Response-Header setzt.
  };
  for (const header of IDENTITY_HEADERS) {
    labels[
      `traefik.http.middlewares.${strip}.headers.customrequestheaders.${headerLabelName(header)}`
    ] = '';
  }

  // 2. Die Forward-Auth selbst.
  labels[`traefik.http.middlewares.${auth}.forwardauth.address`] = input.forwardAuthUrl;
  // Genau diese fuenf Header werden aus der Antwort uebernommen — nicht mehr.
  labels[`traefik.http.middlewares.${auth}.forwardauth.authResponseHeaders`] =
    IDENTITY_HEADERS.map(headerLabelName).join(',');
  labels[`traefik.http.middlewares.${auth}.forwardauth.trustForwardHeader`] = 'true';

  // 3. Der Router: Host → Container, mit beiden Middlewares in dieser
  //    Reihenfolge. Erst entfernen, dann pruefen und setzen.
  labels[`traefik.http.routers.${router}.rule`] = `Host(\`${input.domain}\`)`;
  labels[`traefik.http.routers.${router}.entrypoints`] = 'websecure';
  labels[`traefik.http.routers.${router}.tls.certresolver`] = 'letsencrypt';
  labels[`traefik.http.routers.${router}.middlewares`] = `${strip}@docker,${auth}@docker`;

  return labels;
}

/**
 * Prueft, ob ein Label-Satz vollstaendig ist — die Grundlage des Label-Lints
 * aus Spec 1 (Baustein „Label-Lint"). Gibt die fehlenden Schluessel zurueck;
 * leer heisst vollstaendig.
 *
 * Absichtlich hier und nicht im Review-Gate: Was vollstaendig heisst, weiss nur
 * die Stelle, die die Labels erzeugt.
 */
export function missingForwardAuthLabels(
  actual: Readonly<Record<string, string>>,
  expectedFor: ForwardAuthLabelInput,
): readonly string[] {
  const expected = forwardAuthLabels(expectedFor);
  return Object.keys(expected).filter((key) => actual[key] !== expected[key]);
}
