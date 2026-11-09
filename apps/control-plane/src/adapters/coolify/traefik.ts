/**
 * Die Traefik-Labels, die jede App hinter die Forward-Auth stellen.
 *
 * Das ist die groesste Annahme des Projekts (Brief): Bleiben diese Labels bei
 * Coolify-Updates stehen, ist jede App geschuetzt; kippen sie, ist jede App
 * offen. Deshalb werden sie hier **erzeugt** und nicht per Hand gepflegt, und
 * deshalb hat DoD 2 ein eigenes Testskript.
 */

export interface ForwardAuthLabelInput {
  /** Name der App, genutzt als Router- und Middleware-Name. */
  readonly appName: string;
  readonly domain: string;
  /** Erreichbare Adresse der Forward-Auth-Route der Control Plane. */
  readonly forwardAuthUrl: string;
}

export function forwardAuthLabels(
  input: ForwardAuthLabelInput,
): Readonly<Record<string, string>> {
  const middleware = `openapps-auth-${input.appName}`;
  const router = `openapps-${input.appName}`;

  return {
    'traefik.enable': 'true',
    [`traefik.http.middlewares.${middleware}.forwardauth.address`]: input.forwardAuthUrl,
    // Die Antwort der Forward-Auth traegt die Identitaet. Nur diese Header
    // werden uebernommen; alles, was der Client selbst mitschickt, wird von
    // Traefik verworfen, weil es nicht in dieser Liste steht.
    [`traefik.http.middlewares.${middleware}.forwardauth.authResponseHeaders`]:
      'X-Auth-User-Id,X-Auth-User-Email,X-Auth-Groups,X-Auth-Issued-At,X-Openapps-Gateway',
    [`traefik.http.middlewares.${middleware}.forwardauth.trustForwardHeader`]: 'true',
    [`traefik.http.routers.${router}.rule`]: `Host(\`${input.domain}\`)`,
    [`traefik.http.routers.${router}.entrypoints`]: 'https',
    [`traefik.http.routers.${router}.tls.certresolver`]: 'letsencrypt',
    // Default-Deny: ohne diese Middleware gibt es keinen Router auf die App.
    [`traefik.http.routers.${router}.middlewares`]: `${middleware}@docker`,
  };
}
