import type { PlatformUser } from './gateway.js';

/**
 * Wer ruft: Mensch, Agent oder App (ADR 0011, ADR 0020). Die Plattform
 * schreibt das in die signierte Identitaet, die App liest es hier und
 * nirgends sonst ab.
 *
 * - Agent: Nutzer-Id `agent:<name>`, E-Mail `<name>@agents.invalid`.
 * - App:   Nutzer-Id `app:<name>`,   E-Mail `<name>@apps.invalid`.
 * - Mensch: alles andere (Id aus der Anmeldung).
 *
 * Beide Angaben muessen zusammenpassen. Eine Nutzer-Id `app:wiki` mit einer
 * echten E-Mail ist kein App-Aufruf, sondern ein Mensch mit einer seltsamen
 * Id: `.invalid` kann keine Anmelde-Domain sein (RFC 2606), also kommt diese
 * Kombination nur von der Plattform selbst. Gelesen wird nur, was
 * `getUser` schon gegen die Signatur geprueft hat.
 */

export type Caller =
  | { readonly kind: 'human'; readonly id: string }
  | { readonly kind: 'agent'; readonly agent: string }
  | { readonly kind: 'app'; readonly app: string };

export const APP_CALLER_PREFIX = 'app:';
export const AGENT_CALLER_PREFIX = 'agent:';
export const APP_CALLER_EMAIL_DOMAIN = 'apps.invalid';
export const AGENT_CALLER_EMAIL_DOMAIN = 'agents.invalid';

/** App-Namen der Control Plane. */
const APP_NAME = /^[a-z][a-z0-9-]{0,63}$/;
/** Agent-Namen der Control Plane, mit etwas Luft. */
const AGENT_NAME = /^[a-z0-9][a-z0-9_-]{0,127}$/;

/** Aus einem geprueften Nutzer (`getUser`) der Aufrufer. Wirft nie. */
export function callerOf(user: Pick<PlatformUser, 'id' | 'email'>): Caller {
  const app = prefixed(user, APP_CALLER_PREFIX, APP_CALLER_EMAIL_DOMAIN, APP_NAME);
  if (app !== null) return Object.freeze({ kind: 'app', app });
  const agent = prefixed(user, AGENT_CALLER_PREFIX, AGENT_CALLER_EMAIL_DOMAIN, AGENT_NAME);
  if (agent !== null) return Object.freeze({ kind: 'agent', agent });
  return Object.freeze({ kind: 'human', id: user.id });
}

function prefixed(
  user: Pick<PlatformUser, 'id' | 'email'>,
  prefix: string,
  emailDomain: string,
  pattern: RegExp,
): string | null {
  if (!user.id.startsWith(prefix)) return null;
  const name = user.id.slice(prefix.length);
  if (!pattern.test(name)) return null;
  if (user.email.toLowerCase() !== `${name}@${emailDomain}`) return null;
  return name;
}
