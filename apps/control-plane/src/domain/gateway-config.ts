/**
 * Die dynamische Gateway-Konfiguration, die die Control Plane selbst schreibt
 * (ADR 0008). Reine Funktion: Apps, Domain und Adressen rein, die
 * Konfiguration als Datenstruktur raus. Kein Dateisystem, kein Netz — das
 * Schreiben liegt hinter `GatewayConfigStore` (`domain/ports.ts`).
 *
 * ## Warum diese Datei die wichtigste der Plattform ist
 *
 * ADR 0008, Abschnitt Folgen, erster Satz: Es gibt **keine Stelle mehr, die
 * die Forward-Auth global erzwingt**. Vorher hing sie an Traefiks Entrypoint
 * in einer Datei, die Coolify gehoert; jetzt haengt sie an jedem einzelnen
 * Router, den dieser Generator ausgibt. Das Default-Deny ist von der
 * Infrastruktur in diesen Code gewandert.
 *
 * ## Wie verhindert wird, dass ein Router ohne Middlewares entsteht
 *
 * Nicht durch eine Pruefung, sondern durch den Typ:
 *
 *  1. `GuardedRouter` traegt `middlewares` als **Pflichtfeld** und als Tupel
 *     aus genau den zwei Literalen `[STRIP_IDENTITY_MIDDLEWARE,
 *     FORWARD_AUTH_MIDDLEWARE]`. Ein anderer Wert ist kein Typfehler „spaeter",
 *     sondern sofort.
 *  2. `GuardedRouter` traegt ein Brand unter einem **modul-privaten Symbol**.
 *     Das Symbol wird nicht exportiert; damit kann kein anderes Modul — auch
 *     kein Test — ein Objekt bauen, das als `GuardedRouter` durchgeht.
 *  3. Der einzige Weg zu einem solchen Objekt ist `guardedRouter()`, und diese
 *     Funktion nimmt die Middlewares **nicht als Parameter**. Sie kann sie
 *     also nicht weglassen, falsch sortieren oder ueberschreiben.
 *  4. `GatewayDynamicConfig.http.routers` ist `Record<string, GuardedRouter>`.
 *     Ein Router, der nicht durch (3) gegangen ist, passt nicht in die
 *     Konfiguration.
 *
 * Dazu kommt `gatewayConfigProblems()` als zweite, unabhaengige Schicht: Sie
 * liest die erzeugte Struktur und prueft jeden Router, ohne eine Liste
 * erwarteter Namen zu kennen. Der Typ verhindert den Fehler, der Lint bemerkt
 * ihn auch dann, wenn ihn jemand mit einem Cast erzwingt.
 */

import { ValidationError } from './errors';
import { IDENTITY_HEADERS } from './gateway-headers';
import { appPathFor, appsDomainFor, assertAppName, gatewayAliasFor } from './naming';

/* -------------------------------------------------------------------------- */
/* Namen, die an zwei Seiten haengen                                           */
/* -------------------------------------------------------------------------- */

/** Loescht die `X-Auth-*` der **eingehenden** Anfrage. Laeuft immer zuerst. */
export const STRIP_IDENTITY_MIDDLEWARE = 'openapps-strip-auth-headers';

/** Die Forward-Auth. Laeuft immer danach. */
export const FORWARD_AUTH_MIDDLEWARE = 'openapps-forward-auth';

/**
 * Die Kette in genau dieser Reihenfolge. Erst entfernen, dann pruefen und
 * setzen: Steht der Strip hinter der Auth, ueberschreibt er die Header, die
 * die Auth gerade gesetzt hat — und laesst die des Clients vorher durch
 * (ADR 0004).
 */
export const ROUTER_MIDDLEWARES = [STRIP_IDENTITY_MIDDLEWARE, FORWARD_AUTH_MIDDLEWARE] as const;

/** Der Router, der alles Unbekannte auf der gemeinsamen Domain abfaengt. */
export const CATCH_ALL_ROUTER = 'openapps-catch-all';

/** Der Dienst hinter dem Catch-all: das Deny-Backend. */
export const DENY_SERVICE = 'openapps-deny';

/** Der Router der Control Plane selbst (eigener Host, Spec 1.3). */
export const CONTROL_PLANE_ROUTER = 'openapps-control-plane';

export const CONTROL_PLANE_SERVICE = 'openapps-control-plane';

/** Router- und Dienstname einer App. */
export function gatewayRouterNameFor(appName: string): string {
  assertAppName(appName);
  return `openapps-app-${appName}`;
}

/**
 * Die kleinste moegliche Prioritaet fuer den Catch-all. Coolifys eigener
 * Catch-all liegt bei `-1000` (ADR 0008, `Server.php:826-827`) — unser
 * Catch-all muss ihn schlagen und gegen jeden App-Router verlieren. App-Router
 * haben keine Prioritaet gesetzt und bekommen von Traefik die Laenge ihrer
 * Regel, die ueber jeder dieser Zahlen liegt.
 */
const CATCH_ALL_PRIORITY = 1;
const CONTROL_PLANE_PRIORITY = 2;

/* -------------------------------------------------------------------------- */
/* Die Datenstruktur                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Modul-privat und absichtlich nicht exportiert: das Brand, das `GuardedRouter`
 * ausserhalb dieser Datei unkonstruierbar macht. Ein Symbol-Schluessel
 * erscheint in keiner Serialisierung (`Object.keys`, `JSON.stringify` und der
 * YAML-Renderer gehen nur ueber Zeichenketten-Schluessel).
 */
const GUARDED = Symbol('openapps.guarded-router');

export interface GatewayTls {
  readonly certResolver?: string;
}

/**
 * Ein Router, der seine zwei Middlewares nicht verlieren kann. Siehe
 * Dateikopf, Punkt 1 bis 4.
 */
export interface GuardedRouter {
  readonly [GUARDED]: true;
  readonly rule: string;
  readonly entryPoints: readonly string[];
  readonly service: string;
  readonly middlewares: readonly [typeof STRIP_IDENTITY_MIDDLEWARE, typeof FORWARD_AUTH_MIDDLEWARE];
  readonly priority?: number;
  readonly tls?: GatewayTls;
}

export interface GatewayService {
  readonly loadBalancer: {
    readonly servers: readonly { readonly url: string }[];
    readonly passHostHeader: boolean;
  };
}

export interface StripIdentityMiddleware {
  readonly headers: { readonly customRequestHeaders: Readonly<Record<string, string>> };
}

export interface ForwardAuthMiddleware {
  readonly forwardAuth: {
    readonly address: string;
    readonly authResponseHeaders: readonly string[];
    readonly trustForwardHeader: boolean;
    readonly forwardBody: boolean;
  };
}

export type GatewayMiddleware = StripIdentityMiddleware | ForwardAuthMiddleware;

export interface GatewayDynamicConfig {
  readonly http: {
    readonly routers: Readonly<Record<string, GuardedRouter>>;
    readonly middlewares: Readonly<Record<string, GatewayMiddleware>>;
    readonly services: Readonly<Record<string, GatewayService>>;
  };
}

/* -------------------------------------------------------------------------- */
/* Eingabe                                                                     */
/* -------------------------------------------------------------------------- */

/** Eine App, wie das Gateway sie erreicht: Pfad, Netz-Alias, Port. */
export interface GatewayApp {
  readonly appName: string;
  /**
   * Port, auf dem der Container lauscht (`domain/app-port.ts`). Ohne ihn
   * koennte Traefik nur raten — in der eigenen Konfiguration gibt es keine
   * `EXPOSE`-Heuristik, die Adresse des Dienstes ist eine vollstaendige URL.
   */
  readonly port: number;
  /**
   * Netz-Alias, unter dem der Container erreichbar ist. **Nicht** der
   * Containername: der traegt ein Zeitstempel-Suffix und aendert sich bei jedem
   * Deploy (ADR 0008, `docker.php:670-686`). Default ist der abgeleitete Alias
   * aus `naming.ts`.
   */
  readonly networkAlias?: string;
}

export interface GatewayConfigInput {
  /** Die eine Domain, unter der alle Apps liegen (ADR 0007). */
  readonly appsDomain: string;
  readonly apps: readonly GatewayApp[];
  /**
   * Adresse, die die Forward-Auth pro Aufruf fragt — eine vollstaendige URL
   * auf die Control Plane im Gateway-Netz.
   *
   * Hier steht **nicht** mehr der interne `authz`-Entrypoint aus der alten
   * Fassung: Entrypoints stehen in Traefiks statischer Konfiguration, und die
   * gehoert Coolify (ADR 0008). Damit faellt der Umweg weg, der der
   * Forward-Auth ihr 2-s-Timeout gegeben hat. Siehe `GATEWAY_TIMEOUT_NOTE`.
   */
  readonly forwardAuthAddress: string;
  /** Das Deny-Backend, auf das der Catch-all zeigt. */
  readonly denyBackendUrl: string;
  /** Entrypoint-Name in Coolifys statischer Konfiguration. Default `https`. */
  readonly entryPoint?: string;
  /**
   * Zertifikats-Resolver aus Coolifys statischer Konfiguration
   * (`letsencrypt`, ADR 0008, `proxy.php:776-778`). Wir definieren ihn nicht,
   * wir verweisen nur darauf. `null` heisst: TLS ohne Resolver (lokal).
   */
  readonly certResolver?: string | null;
  /**
   * Die Control Plane selbst. Sie hat einen eigenen Host (Spec 1.3: die
   * Pfad-Allowlist entscheidet im Code, nicht in der Konfiguration), und sie
   * liegt hinter denselben zwei Middlewares wie jede App. Fehlt die Angabe,
   * schreibt der Generator keinen Router fuer sie — dann ist sie ueber unsere
   * Konfiguration nicht erreichbar.
   */
  readonly controlPlane?: {
    readonly host: string;
    readonly url: string;
  };
}

/**
 * Was mit dem `authz`-Entrypoint verloren geht, als Satz an der Stelle, an der
 * jemand danach sucht. Gehoert in den Bericht an den CoS, nicht in einen
 * stillen Kommentar: Traefiks `forwardAuth` hat keine Timeout-Option (ihr
 * HTTP-Client hat 30 s fest eingebaut), und das 2-s-Timeout hing an einem
 * Dienst hinter einem eigenen Entrypoint. Entrypoints stehen statisch; die
 * statische Datei fassen wir nach ADR 0008 nicht an. Eine langsame Control
 * Plane blockiert damit bis zu 30 s statt 2 s — sie laesst nichts durch, aber
 * der Fall „Control Plane antwortet langsam" aus Spec 2 ist nicht mehr durch
 * Konfiguration abgedeckt.
 */
export const GATEWAY_TIMEOUT_NOTE =
  'ohne eigenen Entrypoint hat die Forward-Auth kein 2-s-Timeout mehr (ADR 0008)';

/* -------------------------------------------------------------------------- */
/* Der Generator                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Der **einzige** Weg zu einem Router. Die Middlewares sind kein Parameter:
 * diese Funktion setzt sie immer, in dieser Reihenfolge.
 */
function guardedRouter(parts: {
  rule: string;
  entryPoint: string;
  service: string;
  priority?: number;
  certResolver?: string | null;
}): GuardedRouter {
  return {
    [GUARDED]: true,
    rule: parts.rule,
    entryPoints: [parts.entryPoint],
    service: parts.service,
    middlewares: [STRIP_IDENTITY_MIDDLEWARE, FORWARD_AUTH_MIDDLEWARE],
    ...(parts.priority === undefined ? {} : { priority: parts.priority }),
    tls:
      parts.certResolver === undefined || parts.certResolver === null
        ? {}
        : { certResolver: parts.certResolver },
  };
}

function service(url: string, passHostHeader = true): GatewayService {
  return { loadBalancer: { servers: [{ url }], passHostHeader } };
}

/**
 * Hostname, der in einer ``Host(`...`)``-Regel steht, ohne sie zu verlassen.
 * Ein Backtick in der Domain beendet die Regel; der Rest der Zeile waere dann
 * Traefik-Syntax aus einer Quelle, die wir nicht kontrollieren.
 */
const SAFE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

function safeHost(raw: string, what: string): string {
  const host = raw.trim().toLowerCase();
  if (!SAFE_HOST.test(host)) {
    throw new ValidationError(
      `${what} "${raw}" taugt nicht als Host-Regel: ein Zeichen darin kann die Regel verlassen`,
    );
  }
  return host;
}

/** Eine vollstaendige http- oder https-URL ohne Platz fuer Ueberraschungen. */
function safeUrl(raw: string, what: string): string {
  const url = raw.trim();
  if (!/^https?:\/\/[^\s`'"]+$/.test(url)) {
    throw new ValidationError(`${what} "${raw}" ist keine brauchbare Adresse`);
  }
  return url;
}

/**
 * Netz-Alias als DNS-Label: das, was Dockers DNS im Gateway-Netz aufloest.
 * Kein Punkt, kein Doppelpunkt, kein Schraegstrich — sonst steht in der
 * Dienst-URL etwas anderes als ein Host.
 */
const SAFE_ALIAS = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function safeAlias(raw: string, appName: string): string {
  const alias = raw.trim().toLowerCase();
  if (!SAFE_ALIAS.test(alias)) {
    throw new ValidationError(
      `der Netz-Alias "${raw}" der App "${appName}" taugt nicht als Hostname im Gateway-Netz`,
    );
  }
  return alias;
}

function safePort(port: number, appName: string): number {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ValidationError(
      `App "${appName}" hat den Port ${String(port)} — das ist keine Portnummer zwischen 1 und 65535`,
    );
  }
  return port;
}

/** Header-Name in der Form, in der Traefik ihn schreibt: `X-Auth-User-Id`. */
export function canonicalHeaderName(lowerCaseName: string): string {
  return lowerCaseName
    .split('-')
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('-');
}

export function buildGatewayConfig(input: GatewayConfigInput): GatewayDynamicConfig {
  const domain = safeHost(appsDomainFor(input.appsDomain), 'die App-Domain');
  const entryPoint = input.entryPoint ?? 'https';
  const certResolver = input.certResolver === undefined ? 'letsencrypt' : input.certResolver;
  const forwardAuthAddress = safeUrl(input.forwardAuthAddress, 'die Forward-Auth-Adresse');
  const denyBackendUrl = safeUrl(input.denyBackendUrl, 'das Deny-Backend');

  const routers: Record<string, GuardedRouter> = {};
  const services: Record<string, GatewayService> = {
    [DENY_SERVICE]: service(denyBackendUrl, false),
  };

  // 1. Je App ein Router und ein Dienst. Der Pfad trennt die Apps (ADR 0007),
  //    der Praefix bleibt stehen — die App setzt ihn als `basePath`.
  for (const app of input.apps) {
    assertAppName(app.appName);
    const name = gatewayRouterNameFor(app.appName);
    if (routers[name] !== undefined) {
      throw new ValidationError(`App "${app.appName}" kommt zweimal in der Gateway-Konfiguration`);
    }
    const alias = app.networkAlias ?? gatewayAliasFor(app.appName);
    routers[name] = guardedRouter({
      rule: `Host(\`${domain}\`) && PathPrefix(\`${appPathFor(app.appName)}\`)`,
      entryPoint,
      service: name,
      certResolver,
    });
    services[name] = service(
      `http://${safeAlias(alias, app.appName)}:${String(safePort(app.port, app.appName))}`,
    );
  }

  // 2. Die Control Plane, wenn sie uns gesagt wurde. Eigener Host, dieselben
  //    zwei Middlewares — die oeffentlichen Ausnahmen entscheidet ihr Code.
  if (input.controlPlane !== undefined) {
    const host = safeHost(input.controlPlane.host, 'der Host der Control Plane');
    routers[CONTROL_PLANE_ROUTER] = guardedRouter({
      rule: `Host(\`${host}\`)`,
      entryPoint,
      service: CONTROL_PLANE_SERVICE,
      priority: CONTROL_PLANE_PRIORITY,
      certResolver,
    });
    services[CONTROL_PLANE_SERVICE] = service(
      safeUrl(input.controlPlane.url, 'die Adresse der Control Plane'),
    );
  }

  // 3. Der Catch-all auf derselben Domain: alles, was kein App-Pfad ist, geht
  //    ans Deny-Backend. Ohne `certResolver` — fuer einen Pfad, den niemand
  //    freigegeben hat, soll kein Zertifikat beantragt werden.
  routers[CATCH_ALL_ROUTER] = guardedRouter({
    rule: `Host(\`${domain}\`)`,
    entryPoint,
    service: DENY_SERVICE,
    priority: CATCH_ALL_PRIORITY,
    certResolver: null,
  });

  const customRequestHeaders: Record<string, string> = {};
  for (const header of IDENTITY_HEADERS) {
    // Ein leerer Wert loescht den Header aus der Anfrage. Alle fuenf Namen,
    // nicht „die wichtigen": ein nicht geloeschter `X-Auth-Issued-At` reicht,
    // um das 60-Sekunden-Fenster aufzuweiten.
    customRequestHeaders[canonicalHeaderName(header)] = '';
  }

  return {
    http: {
      routers,
      middlewares: {
        [STRIP_IDENTITY_MIDDLEWARE]: { headers: { customRequestHeaders } },
        [FORWARD_AUTH_MIDDLEWARE]: {
          forwardAuth: {
            address: forwardAuthAddress,
            authResponseHeaders: IDENTITY_HEADERS.map(canonicalHeaderName),
            trustForwardHeader: true,
            // Der Rumpf geht nicht an die Auth. Sie entscheidet ueber Host,
            // Pfad und Session, nicht ueber Nutzdaten.
            forwardBody: false,
          },
        },
      },
      services,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Der Lint auf der erzeugten Konfiguration                                    */
/* -------------------------------------------------------------------------- */

function isForwardAuth(
  middleware: GatewayMiddleware | undefined,
): middleware is ForwardAuthMiddleware {
  return middleware !== undefined && 'forwardAuth' in middleware;
}

function isStrip(middleware: GatewayMiddleware | undefined): middleware is StripIdentityMiddleware {
  return middleware !== undefined && 'headers' in middleware;
}

/**
 * Liest die erzeugte Konfiguration und gibt zurueck, was an ihr nicht traegt.
 * Leer heisst: traegt.
 *
 * Absichtlich **ohne** Liste erwarteter Router-Namen: Geprueft wird jeder
 * Router, der in der Ausgabe steht. Ein Router-Typ, den es heute noch nicht
 * gibt, wird damit von selbst mitgeprueft, sobald der Generator ihn ausgibt.
 */
export function gatewayConfigProblems(config: GatewayDynamicConfig): readonly string[] {
  const problems: string[] = [];
  const { routers, middlewares, services } = config.http;

  const names = Object.keys(routers);
  if (names.length === 0) {
    problems.push('die Konfiguration enthaelt keinen einzigen Router');
  }

  for (const name of names) {
    const router = routers[name];
    if (router === undefined) continue;

    // Reihenfolge und Vollstaendigkeit der Kette. Der Provider-Suffix (`@file`)
    // wird geschluckt, damit dieselbe Pruefung auch auf einem Satz laeuft, der
    // aus der Traefik-API kommt.
    const chain = (router.middlewares as readonly string[]).map(
      (entry) => entry.split('@')[0] ?? entry,
    );
    if (chain.length !== ROUTER_MIDDLEWARES.length) {
      problems.push(
        `Router "${name}" traegt die Kette [${chain.join(', ')}], erwartet genau zwei ` +
          `(${ROUTER_MIDDLEWARES.join(', ')})`,
      );
    } else if (chain[0] !== STRIP_IDENTITY_MIDDLEWARE || chain[1] !== FORWARD_AUTH_MIDDLEWARE) {
      problems.push(
        `Router "${name}" traegt die Kette [${chain.join(', ')}] — erwartet ` +
          `[${ROUTER_MIDDLEWARES.join(', ')}] in genau dieser Reihenfolge`,
      );
    }

    if (!/Host\(`[^`]+`\)/.test(router.rule)) {
      problems.push(`Router "${name}" hat keine Host-Regel: "${router.rule}"`);
    }
    if (router.entryPoints.length === 0) {
      problems.push(`Router "${name}" haengt an keinem Entrypoint`);
    }

    const target = services[router.service];
    if (target === undefined) {
      problems.push(`Router "${name}" zeigt auf den Dienst "${router.service}", den es nicht gibt`);
    } else if (
      target.loadBalancer.servers.length === 0 ||
      target.loadBalancer.servers.some((server) => !/^https?:\/\/\S+$/.test(server.url))
    ) {
      problems.push(`Dienst "${router.service}" hat keine brauchbare Adresse`);
    }
  }

  // Die zwei Middlewares, auf die jeder Router zeigt, muessen es auch geben —
  // und das Richtige tun.
  const strip = middlewares[STRIP_IDENTITY_MIDDLEWARE];
  if (!isStrip(strip)) {
    problems.push(`die Middleware "${STRIP_IDENTITY_MIDDLEWARE}" fehlt oder hat die falsche Form`);
  } else {
    for (const header of IDENTITY_HEADERS) {
      if (strip.headers.customRequestHeaders[canonicalHeaderName(header)] !== '') {
        problems.push(
          `"${STRIP_IDENTITY_MIDDLEWARE}" loescht den Header ${canonicalHeaderName(header)} nicht — ` +
            'ein Client koennte seine eigene Identitaet mitschicken (ADR 0004)',
        );
      }
    }
  }

  const auth = middlewares[FORWARD_AUTH_MIDDLEWARE];
  if (!isForwardAuth(auth)) {
    problems.push(`die Middleware "${FORWARD_AUTH_MIDDLEWARE}" fehlt oder hat die falsche Form`);
  } else {
    if (!/^https?:\/\/\S+$/.test(auth.forwardAuth.address)) {
      problems.push(
        `die Forward-Auth zeigt auf "${auth.forwardAuth.address}" — das ist keine Adresse`,
      );
    }
    const expected = IDENTITY_HEADERS.map(canonicalHeaderName);
    const missing = expected.filter((name) => !auth.forwardAuth.authResponseHeaders.includes(name));
    if (missing.length > 0) {
      problems.push(`die Forward-Auth uebernimmt die Header [${missing.join(', ')}] nicht`);
    }
    const extra = auth.forwardAuth.authResponseHeaders.filter((name) => !expected.includes(name));
    if (extra.length > 0) {
      problems.push(`die Forward-Auth uebernimmt fremde Header [${extra.join(', ')}]`);
    }
  }

  // Der Catch-all: ohne ihn landet ein unbekannter Pfad in Traefiks 404 statt
  // in einem klaren Nein.
  const catchAll = routers[CATCH_ALL_ROUTER];
  if (catchAll === undefined) {
    problems.push(`der Catch-all-Router "${CATCH_ALL_ROUTER}" fehlt`);
  } else if (catchAll.service !== DENY_SERVICE) {
    problems.push(
      `der Catch-all zeigt auf "${catchAll.service}" statt auf das Deny-Backend "${DENY_SERVICE}"`,
    );
  }

  return problems;
}

/** Die Router-Namen der Konfiguration, wie die Traefik-API sie nennt. */
export function gatewayRouterNames(config: GatewayDynamicConfig): readonly string[] {
  return Object.keys(config.http.routers);
}

/** Die Kette eines Routers, zum Lesen von aussen (Tests, Lint, Bericht). */
export function routerMiddlewares(
  config: GatewayDynamicConfig,
  routerName: string,
): readonly string[] | undefined {
  const router = config.http.routers[routerName];
  return router === undefined ? undefined : [...router.middlewares];
}
