/**
 * Der Konfigurations-Generator (ADR 0008) — die Stelle, an der das
 * Default-Deny jetzt haengt.
 *
 * Der wichtigste Fall dieser Datei ist der zweite `describe`: Er geht die
 * **ganze** erzeugte Konfiguration durch und prueft fuer **jeden** Router,
 * dass beide Middlewares in der richtigen Reihenfolge dranhaengen. Iteriert
 * wird ueber die Ausgabe, nicht ueber eine Liste erwarteter Namen — ein
 * Router-Typ, den es heute noch nicht gibt, wird dadurch von selbst
 * mitgeprueft, sobald der Generator ihn ausgibt.
 *
 * Kein Netz, kein Dateisystem: Der Generator ist eine reine Funktion.
 */

import { describe, expect, it } from 'vitest';
import {
  buildGatewayConfig,
  gatewayConfigProblems,
  gatewayRouterNameFor,
  CATCH_ALL_ROUTER,
  CONTROL_PLANE_ROUTER,
  DENY_SERVICE,
  FORWARD_AUTH_MIDDLEWARE,
  ROUTER_MIDDLEWARES,
  STRIP_IDENTITY_MIDDLEWARE,
  appContainerPort,
  gatewayAliasFor,
  DEFAULT_APP_PORT,
  IDENTITY_HEADERS,
  type GatewayConfigInput,
  type GatewayDynamicConfig,
} from '../src/domain';
import { ConflictError, ValidationError } from '../src/domain/errors';
import {
  compareGatewayConfig,
  renderGatewayConfig,
  createFileGatewayConfigStore,
  RESERVED_DYNAMIC_FILENAMES,
} from '../src/infra/gateway-config-store';
import type { AppManifest } from '../src/domain/types';
import { manifest, testGatewaySettings } from './helpers';

const DOMAIN = 'intern.apps.test';

function input(overrides: Partial<GatewayConfigInput> = {}): GatewayConfigInput {
  return {
    ...testGatewaySettings(),
    appsDomain: DOMAIN,
    apps: [
      { appName: 'projektliste', port: 3000 },
      { appName: 'crm', port: 8080 },
    ],
    ...overrides,
  };
}

describe('Gateway-Konfiguration: was erzeugt wird', () => {
  it('gibt je App einen Router auf Host und Pfad und einen Dienst auf den Netz-Alias', () => {
    const config = buildGatewayConfig(input());
    const name = gatewayRouterNameFor('projektliste');

    expect(config.http.routers[name]?.rule).toBe(
      `Host(\`${DOMAIN}\`) && PathPrefix(\`/projektliste\`)`,
    );
    expect(config.http.routers[name]?.service).toBe(name);
    // Der Netz-Alias, nicht der Containername: der traegt ein
    // Zeitstempel-Suffix und aendert sich bei jedem Deploy (ADR 0008).
    expect(config.http.services[name]?.loadBalancer.servers).toEqual([
      { url: `http://${gatewayAliasFor('projektliste')}:3000` },
    ]);
    expect(config.http.services[gatewayRouterNameFor('crm')]?.loadBalancer.servers).toEqual([
      { url: `http://${gatewayAliasFor('crm')}:8080` },
    ]);
  });

  it('entfernt den Pfad-Praefix nicht — die App setzt ihn als basePath (ADR 0007)', () => {
    const config = buildGatewayConfig(input());
    // Keine dritte Middleware, insbesondere kein `stripprefix`: der Praefix
    // bleibt stehen, sonst zeigen die Verweise der App ins Leere.
    expect(config.http.routers[gatewayRouterNameFor('projektliste')]?.middlewares).toEqual([
      STRIP_IDENTITY_MIDDLEWARE,
      FORWARD_AUTH_MIDDLEWARE,
    ]);
  });

  it('legt einen Catch-all mit kleinster Prioritaet auf dieselbe Domain', () => {
    const config = buildGatewayConfig(input());
    const catchAll = config.http.routers[CATCH_ALL_ROUTER];

    expect(catchAll?.rule).toBe(`Host(\`${DOMAIN}\`)`);
    expect(catchAll?.service).toBe(DENY_SERVICE);
    // Er muss gegen jeden App-Router verlieren (die haben keine Prioritaet und
    // bekommen die Laenge ihrer Regel) und gegen Coolifys eigenen Catch-all
    // bei -1000 gewinnen.
    expect(catchAll?.priority).toBe(1);
    expect(config.http.services[DENY_SERVICE]?.loadBalancer.servers[0]?.url).toBe(
      'http://openapps-deny-backend:8080',
    );
  });

  it('beantragt fuer den Catch-all kein Zertifikat, fuer App-Router schon', () => {
    const config = buildGatewayConfig(input());

    expect(config.http.routers[CATCH_ALL_ROUTER]?.tls).toEqual({});
    expect(config.http.routers[gatewayRouterNameFor('crm')]?.tls).toEqual({
      certResolver: 'letsencrypt',
    });
  });

  it('definiert die zwei Middlewares: alle fuenf Header loeschen, dann Forward-Auth', () => {
    const config = buildGatewayConfig(input());
    const strip = config.http.middlewares[STRIP_IDENTITY_MIDDLEWARE];
    const auth = config.http.middlewares[FORWARD_AUTH_MIDDLEWARE];

    expect(strip).toEqual({
      headers: {
        customRequestHeaders: {
          'X-Auth-User-Id': '',
          'X-Auth-User-Email': '',
          'X-Auth-Groups': '',
          'X-Auth-Issued-At': '',
          'X-Auth-Signature': '',
        },
      },
    });
    expect(auth).toEqual({
      forwardAuth: {
        address: 'http://openapps-control-plane:3000/api/authz/forward',
        authResponseHeaders: [
          'X-Auth-User-Id',
          'X-Auth-User-Email',
          'X-Auth-Groups',
          'X-Auth-Issued-At',
          'X-Auth-Signature',
        ],
        trustForwardHeader: true,
        forwardBody: false,
      },
    });
    // Genau die fuenf aus Spec 3.1 — nicht mehr und nicht weniger.
    expect(IDENTITY_HEADERS).toHaveLength(5);
  });

  it('haengt die Router an Coolifys Entrypoint-Namen, nicht an unseren alten', () => {
    const config = buildGatewayConfig(input());
    for (const router of Object.values(config.http.routers)) {
      expect(router.entryPoints).toEqual(['https']);
    }
  });

  it('weist eine Domain ab, die die Host-Regel verlassen koennte', () => {
    expect(() => buildGatewayConfig(input({ appsDomain: 'a.test`) || Host(`fremd.test' }))).toThrow(
      ValidationError,
    );
  });

  it('weist einen Netz-Alias ab, der kein Hostname ist', () => {
    expect(() =>
      buildGatewayConfig(
        input({ apps: [{ appName: 'crm', port: 3000, networkAlias: 'crm:3000/../x' }] }),
      ),
    ).toThrow(ValidationError);
  });

  it('weist eine Forward-Auth-Adresse ab, die keine Adresse ist', () => {
    expect(() => buildGatewayConfig(input({ forwardAuthAddress: 'control-plane' }))).toThrow(
      ValidationError,
    );
  });

  it('weist eine App zweimal ab, statt den Router stillschweigend zu ueberschreiben', () => {
    expect(() =>
      buildGatewayConfig(
        input({
          apps: [
            { appName: 'crm', port: 3000 },
            { appName: 'crm', port: 4000 },
          ],
        }),
      ),
    ).toThrow(ValidationError);
  });

  it('schreibt ohne Control-Plane-Angabe keinen Router fuer sie', () => {
    const { controlPlane: _ignored, ...withoutControlPlane } = input();
    const config = buildGatewayConfig(withoutControlPlane);

    expect(config.http.routers[CONTROL_PLANE_ROUTER]).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Der Fall, auf den es ankommt                                               */
/* -------------------------------------------------------------------------- */

describe('kein Router ohne Middlewares — ueber die ganze Ausgabe', () => {
  /**
   * Alle Konfigurationen, die der Generator ueberhaupt ausgeben kann: keine
   * App, eine App, viele Apps, mit und ohne Control Plane, mit und ohne
   * Zertifikats-Resolver. Jede neue Form gehoert hier dazu — und der Fall
   * darunter geht sie alle durch, ohne zu wissen, welche Router darin stehen.
   */
  const configurations: readonly { name: string; config: GatewayDynamicConfig }[] = [
    { name: 'ohne App', config: buildGatewayConfig(input({ apps: [] })) },
    {
      name: 'eine App',
      config: buildGatewayConfig(input({ apps: [{ appName: 'crm', port: 3000 }] })),
    },
    { name: 'zwei Apps', config: buildGatewayConfig(input()) },
    {
      name: 'ohne Control Plane',
      config: (() => {
        const { controlPlane: _ignored, ...rest } = input();
        return buildGatewayConfig(rest);
      })(),
    },
    {
      name: 'ohne Zertifikats-Resolver',
      config: buildGatewayConfig(input({ certResolver: null })),
    },
    {
      name: 'zehn Apps',
      config: buildGatewayConfig(
        input({
          apps: Array.from({ length: 10 }, (_unused, index) => ({
            appName: `app-${String(index)}`,
            port: 3000 + index,
          })),
        }),
      ),
    },
  ];

  for (const { name, config } of configurations) {
    it(`jeder Router traegt [strip, forward-auth] in dieser Reihenfolge (${name})`, () => {
      const routers = Object.entries(config.http.routers);
      expect(routers.length).toBeGreaterThan(0);

      for (const [routerName, router] of routers) {
        // Die Reihenfolge ist Teil der Sicherheit: Steht der Strip hinter der
        // Auth, ueberschreibt er die Header, die die Auth gerade gesetzt hat
        // (ADR 0004).
        expect(router.middlewares, `Router ${routerName}`).toEqual([...ROUTER_MIDDLEWARES]);
        // Und die Kette zeigt auf Middlewares, die es gibt.
        for (const middleware of router.middlewares) {
          expect(config.http.middlewares[middleware], `Router ${routerName}`).toBeDefined();
        }
        // Und auf einen Dienst, der eine Adresse hat.
        expect(
          config.http.services[router.service]?.loadBalancer.servers[0]?.url,
          `Router ${routerName}`,
        ).toMatch(/^https?:\/\//);
      }
    });

    it(`der Lint hat an dieser Konfiguration nichts zu beanstanden (${name})`, () => {
      expect(gatewayConfigProblems(config)).toEqual([]);
    });
  }

  it('der Lint faengt eine vertauschte Kette auch dann, wenn jemand sie mit einem Cast erzwingt', () => {
    const config = buildGatewayConfig(input());
    const name = gatewayRouterNameFor('crm');
    // Der Typ `GuardedRouter` laesst das nicht zu — genau das ist sein Zweck.
    // Der Cast erzwingt es, um zu zeigen, dass der Lint die zweite Schicht ist
    // und nicht die einzige.
    const vertauscht = {
      ...config,
      http: {
        ...config.http,
        routers: {
          ...config.http.routers,
          [name]: {
            ...config.http.routers[name],
            middlewares: [FORWARD_AUTH_MIDDLEWARE, STRIP_IDENTITY_MIDDLEWARE],
          },
        },
      },
    } as unknown as GatewayDynamicConfig;

    const problems = gatewayConfigProblems(vertauscht);
    expect(problems.join(' ')).toContain('in genau dieser Reihenfolge');
  });

  it('der Lint faengt einen Router ganz ohne Middlewares (erzwungen)', () => {
    const config = buildGatewayConfig(input());
    const name = gatewayRouterNameFor('crm');
    const ohne = {
      ...config,
      http: {
        ...config.http,
        routers: {
          ...config.http.routers,
          [name]: { ...config.http.routers[name], middlewares: [] },
        },
      },
    } as unknown as GatewayDynamicConfig;

    expect(gatewayConfigProblems(ohne).join(' ')).toContain('erwartet genau zwei');
  });

  it('der Lint faengt eine Strip-Middleware, die einen der fuenf Header nicht loescht', () => {
    const config = buildGatewayConfig(input());
    const kaputt = {
      ...config,
      http: {
        ...config.http,
        middlewares: {
          ...config.http.middlewares,
          [STRIP_IDENTITY_MIDDLEWARE]: {
            headers: { customRequestHeaders: { 'X-Auth-User-Id': '' } },
          },
        },
      },
    } as unknown as GatewayDynamicConfig;

    expect(gatewayConfigProblems(kaputt).join(' ')).toContain('X-Auth-Signature');
  });

  it('der Lint faengt einen fehlenden Catch-all', () => {
    const config = buildGatewayConfig(input());
    const { [CATCH_ALL_ROUTER]: _ignored, ...routers } = config.http.routers;
    const ohne = { http: { ...config.http, routers } } as unknown as GatewayDynamicConfig;

    expect(gatewayConfigProblems(ohne).join(' ')).toContain(CATCH_ALL_ROUTER);
  });
});

/* -------------------------------------------------------------------------- */
/* Die Datei                                                                   */
/* -------------------------------------------------------------------------- */

describe('die Datei auf dem Host', () => {
  it('schreibt YAML, in dem jeder Wert eine Zeichenkette bleibt', () => {
    const text = renderGatewayConfig(buildGatewayConfig(input()));

    expect(text).toContain('"rule": "Host(`intern.apps.test`) && PathPrefix(`/crm`)"');
    // Der leere Wert loescht den Header — er darf nicht zu `null` werden.
    expect(text).toContain('"X-Auth-User-Id": ""');
    // Wahrheitswerte und Zahlen bleiben, was sie sind.
    expect(text).toContain('"trustForwardHeader": true');
    expect(text).toContain('"priority": 1');
    expect(text).toContain('"tls": {}');
    // Das Brand-Symbol des Router-Typs taucht nicht in der Datei auf.
    expect(text).not.toContain('Symbol');
    expect(text).not.toContain('guarded');
  });

  it('erzeugt denselben Text fuer dieselbe Eingabe — sonst taugt der Vergleich nicht', () => {
    expect(renderGatewayConfig(buildGatewayConfig(input()))).toBe(
      renderGatewayConfig(buildGatewayConfig(input())),
    );
  });

  it('nennt die Zeile, in der die Datei auf dem Host abweicht', () => {
    const config = buildGatewayConfig(input());
    const veraendert = renderGatewayConfig(config).replace(
      'openapps-control-plane:3000/api/authz/forward',
      'boeser-host:3000/api/authz/forward',
    );

    const result = compareGatewayConfig(veraendert, config, '/traefik/dynamic/openapps.yaml');
    expect(result.state).toBe('mismatch');
    if (result.state === 'mismatch') {
      expect(result.problems[0]).toContain('boeser-host');
    }
  });

  it('meldet eine unveraenderte Datei als Treffer', () => {
    const config = buildGatewayConfig(input());
    expect(compareGatewayConfig(renderGatewayConfig(config), config, '/x').state).toBe('match');
  });

  it('verweigert einen Dateinamen, den Coolify selbst ueberschreibt', () => {
    for (const reserved of RESERVED_DYNAMIC_FILENAMES) {
      expect(() =>
        createFileGatewayConfigStore({ directory: '/traefik/dynamic', filename: reserved }),
      ).toThrow(/reservierte/);
    }
  });
});

describe('Port einer App', () => {
  const app = (env: AppManifest['env']) => ({
    name: 'projektliste',
    manifest: { ...manifest('projektliste'), env },
  });

  const portEnv = (value: string): AppManifest['env'] => [
    { name: 'PORT', secret: false, description: 'Port der App', required: true, default: value },
  ];

  it('nimmt die Konvention 3000, wenn das Manifest nichts anderes sagt', () => {
    expect(appContainerPort(app([]))).toBe(DEFAULT_APP_PORT);
    expect(DEFAULT_APP_PORT).toBe(3000);
  });

  it('nimmt den Port aus der Env-Deklaration PORT des Manifests', () => {
    expect(appContainerPort(app(portEnv('8080')))).toBe(8080);
  });

  it('bricht ab, statt bei einem unsinnigen PORT still auf 3000 zurueckzufallen', () => {
    expect(() => appContainerPort(app(portEnv('dreitausend')))).toThrow(ConflictError);
    expect(() => appContainerPort(app(portEnv('0')))).toThrow(ConflictError);
  });

  it('weist einen unsinnigen Port auch im Generator ab', () => {
    expect(() => buildGatewayConfig(input({ apps: [{ appName: 'crm', port: 0 }] }))).toThrow(
      ValidationError,
    );
    expect(() => buildGatewayConfig(input({ apps: [{ appName: 'crm', port: 70000 }] }))).toThrow(
      ValidationError,
    );
  });
});
