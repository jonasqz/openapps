/**
 * Rohe Anfragen an Traefik auf dem Loopback, mit `Host: apps.local.test`.
 * Fuer die Faelle, in denen der Statuscode selbst die Aussage ist (302 statt
 * 200), denn der Browser folgt einer Weiterleitung. Das Zertifikat ist lokal
 * selbst signiert (einrichten.sh), deshalb ohne Pruefung, und nur hier.
 */

import { request } from 'node:https';
import { APPS_HOST, GATEWAY_PORT } from './stack';

export interface RawResponse {
  readonly status: number;
  readonly location: string | null;
  readonly body: string;
}

export function gatewayGet(
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: GATEWAY_PORT,
        servername: APPS_HOST,
        path,
        method: 'GET',
        rejectUnauthorized: false,
        headers: { ...headers, host: `${APPS_HOST}:${String(GATEWAY_PORT)}` },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          // Nur der Anfang: Die Aussage steckt im Status, nicht in der Seite.
          if (chunks.reduce((n, c) => n + c.length, 0) < 64 * 1024) chunks.push(chunk);
        });
        res.on('end', () => {
          const location = res.headers.location;
          resolve({
            status: res.statusCode ?? 0,
            location: typeof location === 'string' ? location : null,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`gateway request ${path} timed out`)));
    req.on('error', reject);
    req.end();
  });
}

/** Gefaelschte Identitaet, wie ein Browser sie selbst setzen koennte. */
export function forgedIdentityHeaders(email: string): Record<string, string> {
  return {
    'X-Auth-User-Id': 'forged-admin',
    'X-Auth-User-Email': email,
    'X-Auth-Groups': 'platform-admins',
    'X-Auth-Issued-At': String(Math.floor(Date.now() / 1000)),
    'X-Auth-Signature': 'f'.repeat(64),
  };
}

/** Eine gefaelschte Leiste mit einem fremden Link (ADR 0017). */
export function forgedNavHeaders(evilHref: string): Record<string, string> {
  const nav = {
    v: 1,
    platformUrl: 'https://evil.invalid',
    apps: [{ name: 'evil', title: 'Evil', category: null, href: evilHref }],
    canCreateApps: true,
    isAdmin: true,
  };
  return {
    'X-Auth-Nav': Buffer.from(JSON.stringify(nav)).toString('base64url'),
    'X-Auth-Nav-Signature': 'a'.repeat(64),
  };
}
