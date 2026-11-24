/**
 * Die Weiterleitung an eine App — ein HTTP-Aufruf gegen ihren Tool-Endpunkt
 * `POST <basePath>/api/tools/<tool>` (`createToolRoute` aus `@openapps/sdk`).
 *
 * Der Aufruf geht **direkt an den Container** im Netz der Plattform, nicht
 * durch Traefik (ADR 0011). Durch Traefik ginge er an der Forward-Auth vorbei
 * nicht — er scheiterte an ihr: Sie verlangt eine Browser-Session, und ein
 * Agent hat keine. Die Pruefung, die sie fuer Menschen macht, hat der MCP fuer
 * den Agenten schon gemacht (`callAppTool`: Freigabe auf `<app>.<tool>`,
 * protokolliert).
 *
 * Warum das nicht unsicherer ist: Die App vertraut keinem Weg, sondern der
 * Signatur ueber die Identitaet (ADR 0004). Dieselbe Funktion, die die
 * Forward-Auth benutzt, signiert hier mit dem Secret **dieser** App; das SDK
 * prueft sie bei jedem Aufruf. Wer den Container direkt erreicht, ohne das
 * Secret zu kennen, bekommt 401.
 */

import {
  appContainerPort,
  appPathFor,
  gatewayAliasFor,
  gatewayHost,
  identityHeadersForApp,
} from '@openapps/control-plane/domain';
import type { AppToolInvoker } from './app-tools';

export interface HttpInvokerOptions {
  /**
   * Master-Secret der Control Plane. Aus ihm leitet `identityHeadersForApp`
   * das Secret **dieser** App ab — der MCP kennt kein App-Secret selbst.
   */
  readonly authMasterSecret: string;
  readonly requestTimeoutMs?: number;
  /**
   * Andere Basis-Adresse je App, statt `http://<netz-alias>:<port>`. Nur fuer
   * Laeufe ausserhalb des Plattform-Netzes (Tests, lokale Entwicklung ohne
   * Container). Der Pfad der App wird trotzdem angehaengt.
   */
  readonly addressOverride?: (appName: string) => string | undefined;
}

/**
 * Die Adresse des Tool-Endpunkts: Netz-Alias und Port wie im Router der
 * Gateway-Konfiguration (`gateway-config.ts`), dazu der Pfad der App, weil
 * Next mit `basePath` baut und der Container ihn erwartet.
 */
export function appToolUrl(
  app: Parameters<typeof appContainerPort>[0],
  toolName: string,
  addressOverride?: (appName: string) => string | undefined,
): string {
  const base =
    addressOverride?.(app.name) ?? `http://${gatewayAliasFor(app.name)}:${appContainerPort(app)}`;
  return `${base.replace(/\/+$/, '')}${appPathFor(app.name)}/api/tools/${encodeURIComponent(toolName)}`;
}

export function createHttpInvoker(options: HttpInvokerOptions): AppToolInvoker {
  return {
    async invoke({ app, toolName, actor, args }) {
      if (app.primaryDomain === null) {
        // Noch nie deployt: Es gibt keinen Container, und auch kein Secret,
        // mit dem er rechnen koennte.
        throw new Error(`App "${app.name}" ist nicht deployt und nicht aufrufbar`);
      }

      // Dieselbe Funktion, die auch die Forward-Auth benutzt. Der Agent ist
      // das Subjekt: sein Name steht im Rechtemodell, also steht er auch hier.
      const headers = identityHeadersForApp({
        app,
        identity: {
          userId: `agent:${actor.id}`,
          email: `${actor.id}@agents.invalid`,
          groups: [],
          issuedAt: Math.floor(Date.now() / 1000),
        },
        masterSecret: options.authMasterSecret,
      });

      const url = appToolUrl(app, toolName, options.addressOverride);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'content-type': 'application/json',
          // Der direkte Aufruf traegt als Host den Netz-Alias. Das SDK prueft
          // aber, dass der Aufruf sich an die Domain dieser App richtet
          // (`assertRequestHost`) — dieselbe, die in der Signatur steht. Also
          // sagen wir sie, wie Traefik es taete.
          'x-forwarded-host': gatewayHost(app.primaryDomain),
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(options.requestTimeoutMs ?? 30_000),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`App "${app.name}" antwortete ${response.status}: ${text.slice(0, 500)}`);
      }
      return response.json();
    },
  };
}
