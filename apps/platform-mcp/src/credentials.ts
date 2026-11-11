/**
 * Wie ein Agent sich ausweist — aus dem `Authorization`-Header gelesen.
 *
 * Zwei Formen, ein Inhalt:
 *
 * - `Bearer <clientId>.<secret>` — das Token, das `create_agent` ausgibt. Der
 *   Normalweg: MCP-Clients nehmen einen festen Header, und ein Bearer-Token
 *   ist die Form, die jeder von ihnen kennt.
 * - `Basic base64(<clientId>:<secret>)` — die fruehere Form, weiter gueltig.
 *
 * Hier wird nur gelesen. Ob Id und Secret stimmen, entscheidet
 * `actorForClient` — bei jedem Aufruf neu.
 */

import { parseAgentToken } from '@openapps/control-plane/domain';

export interface ClientCredentials {
  readonly id: string;
  readonly secret: string;
}

export function credentialsFrom(header: string | undefined): ClientCredentials | null {
  if (header === undefined) return null;
  const space = header.indexOf(' ');
  if (space === -1) return null;
  const scheme = header.slice(0, space).toLowerCase();
  const value = header.slice(space + 1).trim();
  if (value === '') return null;

  if (scheme === 'bearer') {
    const parsed = parseAgentToken(value);
    return parsed === null ? null : { id: parsed.clientId, secret: parsed.secret };
  }

  if (scheme === 'basic') {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator <= 0 || separator === decoded.length - 1) return null;
    return { id: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
  }

  return null;
}
