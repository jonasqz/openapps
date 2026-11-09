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
import type { GatewayLabelLint, GatewayLabelPlan, GatewayTarget } from '../../domain/ports';

export interface ForwardAuthLabelInput {
  /** Name der App, genutzt als Router- und Middleware-Name. */
  readonly appName: string;
  readonly domain: string;
  /**
   * Port, auf dem der App-Container lauscht. Kommt aus der Domaene
   * (`appContainerPort`), nicht von hier: Ohne diesen Wert raet Traefik den
   * Port aus dem `EXPOSE` des Images und scheitert, wenn es keines oder
   * mehrere gibt.
   */
  readonly port: number;
  /**
   * Adresse, die Traefik pro Aufruf fragt. Nicht die oeffentliche URL der
   * Control Plane, sondern der interne `authz`-Entrypoint von Traefik selbst
   * (Default in `config.ts`, Gegenstueck in `infra/traefik/traefik.yml`):
   * `forwardAuth` hat keine Timeout-Option, ein Traefik-Dienst schon.
   */
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

  // 4. Der Dienst mit dem Port. Ohne `loadbalancer.server.port` nimmt Traefik
  //    den einen `EXPOSE` des Images — und nur dann, wenn es genau einen gibt.
  //    Bei einem Image ohne `EXPOSE` kommt der Router nicht hoch (gemessen im
  //    Gateway-Lauf, docs/nachweise/dod-02-laeufe). Der Router
  //    zeigt ausdruecklich auf diesen Dienst, damit die Zuordnung nicht an der
  //    Heuristik "genau ein Dienst am Container" haengt.
  labels[`traefik.http.services.${router}.loadbalancer.server.port`] = String(input.port);
  labels[`traefik.http.routers.${router}.service`] = router;

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

/* -------------------------------------------------------------------------- */
/* Der Label-Lint als Anschluss der Domaene                                    */
/* -------------------------------------------------------------------------- */

/**
 * Liest einem Label-Satz an, was er bedeutet: Port, Forward-Auth-Adresse,
 * Host-Regel, Middleware-Kette, und ob die Kette die mitgeschickten
 * `X-Auth-*`-Header **vor** der Forward-Auth entfernt.
 *
 * Absichtlich ueber die Schluessel gelesen und nicht aus `appName` geraten:
 * Dieselbe Funktion beurteilt den Satz, den wir erzeugen wuerden, und den
 * Satz, der nach dem Deploy wirklich am Container steht. Ein Satz, in dem die
 * Reihenfolge der Middlewares vertauscht ist, faellt hier auf — Spec 2,
 * Zeile „Middleware-Reihenfolge vertauscht".
 */
export function inspectForwardAuthLabels(
  labels: Readonly<Record<string, string>>,
  appName: string,
): Omit<GatewayLabelPlan, 'labels'> {
  const router = `openapps-${appName}`;
  const middlewares = (labels[`traefik.http.routers.${router}.middlewares`] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  // Name ohne Provider-Suffix: `openapps-auth-demo@docker` → `openapps-auth-demo`.
  const plain = middlewares.map((entry) => entry.split('@')[0] ?? entry);

  const authIndex = plain.findIndex(
    (name) => labels[`traefik.http.middlewares.${name}.forwardauth.address`] !== undefined,
  );
  const stripIndex = plain.findIndex((name) =>
    IDENTITY_HEADERS.every(
      (header) =>
        labels[
          `traefik.http.middlewares.${name}.headers.customrequestheaders.${headerLabelName(header)}`
        ] === '',
    ),
  );

  const authName = authIndex === -1 ? undefined : plain[authIndex];

  return {
    servicePort: labels[`traefik.http.services.${router}.loadbalancer.server.port`],
    forwardAuthAddress:
      authName === undefined
        ? undefined
        : labels[`traefik.http.middlewares.${authName}.forwardauth.address`],
    hostRule: labels[`traefik.http.routers.${router}.rule`],
    middlewares,
    // Entfernen vor Pruefen. Steht der Strip hinter der Auth, ist er wertlos:
    // dann ueberschreibt er die Header, die die Auth gerade gesetzt hat, bzw.
    // laesst die des Clients vorher durch (ADR 0004).
    stripsIdentityHeaders: stripIndex !== -1 && (authIndex === -1 || stripIndex < authIndex),
    forwardsAuth: authIndex !== -1,
  };
}

/**
 * Der Label-Lint, den die Domaene benutzt (`GatewayLabelLint` in
 * `domain/ports.ts`). Reine Rechnung, kein Netzzugriff — damit der Schritt im
 * Review-Gate deterministisch bleibt.
 */
export function createTraefikLabelLint(forwardAuthUrl: string): GatewayLabelLint {
  const inputOf = (target: GatewayTarget): ForwardAuthLabelInput => ({
    appName: target.appName,
    domain: target.domain,
    port: target.port,
    forwardAuthUrl,
  });

  return {
    plan(target: GatewayTarget): GatewayLabelPlan {
      const labels = forwardAuthLabels(inputOf(target));
      return { labels, ...inspectForwardAuthLabels(labels, target.appName) };
    },
    missing(actual, target): readonly string[] {
      return missingForwardAuthLabels(actual, inputOf(target));
    },
  };
}
