/**
 * Was „lokal“ heisst (ADR 0024 C2). Inhalte aus Apps in
 * `OPENAPPS_MODEL_LOCAL_ONLY_APPS` gehen nur an einen lokalen Anbieter.
 *
 * Lokal ist **nur** `openai-compatible` mit einer Basis-URL auf
 *
 * - Loopback (`127.0.0.0/8`, `::1`, `localhost`),
 * - einer privaten Adresse (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), oder
 * - einem Namen ohne Punkt im internen Netz (etwa `ollama`).
 *
 * Alles andere ist extern, auch eine Link-Local-Adresse, ein Name mit Punkt
 * (`ollama.intern.example`) und jede Angabe, die sich nicht lesen laesst. Die
 * WHATWG-URL normalisiert Schreibweisen wie `0x7f.1` oder `2130706433` zu
 * `127.0.0.1`, bevor hier geprueft wird.
 */

import type { ModelProviderKind } from './ports';

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const [a, b] = parts.map(Number) as [number, number, number, number];
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  // `new URL` liefert IPv6 in eckigen Klammern und kleingeschrieben.
  if (!host.startsWith('[') || !host.endsWith(']')) return false;
  const address = host.slice(1, -1);
  if (address === '::1') return true;
  // IPv4 in IPv6 (`::ffff:127.0.0.1` wird zu `::ffff:7f00:1`): nicht lokal,
  // lieber extern als eine zweite Rechnung.
  const first = address.split(':')[0] ?? '';
  if (/^f[cd][0-9a-f]{2}$/.test(first)) return true;
  return false;
}

/** Ist diese Basis-URL lokal? Unlesbar heisst: nein. */
export function isLocalBaseUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === '') return false;
  if (host === 'localhost') return true;
  if (host.startsWith('[')) return isPrivateIpv6(host);
  if (/^[\d.]+$/.test(host)) return isPrivateIpv4(host);
  // Ein Name ohne Punkt wird nur im internen Netz aufgeloest.
  return !host.includes('.');
}

/** Lokal nur `openai-compatible` mit lokaler Basis-URL, alles andere extern. */
export function isLocalProvider(kind: ModelProviderKind, baseUrl: string | null): boolean {
  return kind === 'openai-compatible' && baseUrl !== null && isLocalBaseUrl(baseUrl);
}
