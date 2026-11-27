/**
 * Die Weiterleitung an eine App — ein HTTP-Aufruf gegen ihren Tool-Endpunkt
 * `POST <basePath>/api/tools/<tool>` (`createToolRoute` aus `@openapps/sdk`).
 * Der Plattform-MCP (Agents, ADR 0011) und die Route fuer App-Aufrufe
 * (ADR 0020) benutzen dieselbe Weiterleitung.
 *
 * Der Aufruf geht **direkt an den Container** im Netz der Plattform, nicht
 * durch Traefik. Durch Traefik scheiterte er an der Forward-Auth: Sie
 * verlangt eine Browser-Session. Die Pruefung, die sie fuer Menschen macht,
 * hat `callAppTool` schon gemacht (Freigabe auf `<app>.<tool>`,
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
  AppToolError,
  appPathFor,
  gatewayAliasFor,
  gatewayHost,
  identityHeadersForApp,
  invocationIdentityFor,
  readableAppsHeadersForApp,
  type AppToolInvoker,
} from '../domain';

export interface HttpInvokerOptions {
  /**
   * Master-Secret der Control Plane. Aus ihm wird das Secret **dieser** App
   * abgeleitet — der Aufrufer kennt kein App-Secret selbst.
   */
  readonly authMasterSecret: string;
  readonly requestTimeoutMs?: number;
  /**
   * Andere Basis-Adresse je App, statt `http://<netz-alias>:<port>`. Nur fuer
   * Laeufe ausserhalb des Plattform-Netzes (Tests, lokale Entwicklung ohne
   * Container). Der Pfad der App wird trotzdem angehaengt.
   */
  readonly addressOverride?: (appName: string) => string | undefined;
  /** Uhr in Millisekunden. Fuer Tests. */
  readonly now?: () => number;
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
    async invoke({ app, toolName, actor, args, readableApps, humanIdentity, signal }) {
      if (app.primaryDomain === null) {
        // Noch nie deployt: Es gibt keinen Container, und auch kein Secret,
        // mit dem er rechnen koennte.
        throw new Error(`app "${app.name}" is not deployed and cannot be called`);
      }

      // Dieselbe Funktion, die auch die Forward-Auth benutzt. Der Aufrufer
      // ist das Subjekt: `agent:<name>`, `app:<name>` oder, fuer die Suche
      // ueber alle Apps (ADR 0021), der Mensch aus seiner Session.
      const identity = invocationIdentityFor(
        actor,
        humanIdentity,
        Math.floor((options.now?.() ?? Date.now()) / 1000),
      );
      const headers = identityHeadersForApp({
        app,
        identity,
        masterSecret: options.authMasterSecret,
      });
      // Immer gesetzt, leer, wenn die Ziel-App sie nicht anfordert (ADR 0020).
      const readable = readableAppsHeadersForApp({
        app,
        identity,
        masterSecret: options.authMasterSecret,
        apps: readableApps ?? null,
      });

      const url = appToolUrl(app, toolName, options.addressOverride);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          ...readable,
          'content-type': 'application/json',
          // Der direkte Aufruf traegt als Host den Netz-Alias. Das SDK prueft
          // aber, dass der Aufruf sich an die Domain dieser App richtet
          // (`assertRequestHost`) — dieselbe, die in der Signatur steht. Also
          // sagen wir sie, wie Traefik es taete.
          'x-forwarded-host': gatewayHost(app.primaryDomain),
        },
        body: JSON.stringify(args),
        signal:
          signal === undefined
            ? AbortSignal.timeout(options.requestTimeoutMs ?? 30_000)
            : AbortSignal.any([signal, AbortSignal.timeout(options.requestTimeoutMs ?? 30_000)]),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        let body: unknown = null;
        try {
          body = text === '' ? null : (JSON.parse(text) as unknown);
        } catch {
          body = null;
        }
        throw new AppToolError(
          `app "${app.name}" responded ${String(response.status)}: ${text.slice(0, 500)}`,
          response.status,
          body,
        );
      }
      return response.json();
    },
  };
}
