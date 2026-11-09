/**
 * Die Weiterleitung an eine App — ein HTTP-Aufruf gegen ihren API-Endpunkt.
 *
 * Der Aufruf geht durch das Gateway, nicht daran vorbei: die Identitaet des
 * Agents wird mit derselben Signatur mitgegeben, mit der die Forward-Auth
 * arbeitet (`@openapps/control-plane/gateway`). Die App vertraut diesen Headern
 * nur ueber `@openapps/sdk` — und das SDK prueft die Signatur.
 */

import { identityHeadersForApp } from '@openapps/control-plane/domain';
import type { AppToolInvoker } from './app-tools';

export interface HttpInvokerOptions {
  /**
   * Master-Secret der Control Plane. Aus ihm leitet `identityHeadersForApp`
   * das Secret **dieser** App ab — der MCP kennt kein App-Secret selbst.
   */
  readonly authMasterSecret: string;
  readonly requestTimeoutMs?: number;
}

export function createHttpInvoker(options: HttpInvokerOptions): AppToolInvoker {
  return {
    async invoke({ app, toolName, actor, args }) {
      if (app.primaryDomain === null) {
        throw new Error(`App "${app.name}" hat keine Domain und ist nicht aufrufbar`);
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

      const response = await fetch(`https://${app.primaryDomain}/api/tools/${toolName}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
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
