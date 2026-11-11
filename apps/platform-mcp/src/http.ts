#!/usr/bin/env node
/**
 * Start ueber HTTP — der Weg fuer Agents, die sich als eigener OAuth-Client
 * anmelden.
 *
 * Die Identitaet kommt pro Aufruf aus dem `Authorization`-Header
 * (`src/credentials.ts`) und wird bei **jedem** Aufruf geprueft. Kein
 * Token-Cache, keine Session: wird ein Agent gesperrt, ist er beim naechsten
 * Aufruf draussen.
 *
 * Von aussen erreichbar ist dieser Server nicht direkt, sondern ueber
 * `https://<CONTROL_PLANE_HOST>/mcp` — die Control Plane reicht den Aufruf
 * durch (ADR 0009). Deshalb hoert er standardmaessig nur auf 127.0.0.1.
 */

import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { platformContext } from './context';
import { credentialsFrom } from './credentials';
import { actorForClient, UnauthenticatedError } from './identity';
import { createHttpInvoker } from './invoker';
import { createPlatformServer } from './server';

const PORT = Number(process.env.PLATFORM_MCP_PORT ?? '3001');

const HOST = process.env.PLATFORM_MCP_HOST ?? '127.0.0.1';

const masterSecret = process.env.OPENAPPS_AUTH_MASTER_SECRET;
if (masterSecret === undefined) {
  throw new Error('OPENAPPS_AUTH_MASTER_SECRET fehlt');
}
const invoker = createHttpInvoker({ authMasterSecret: masterSecret });

const httpServer = createServer(async (request, response) => {
  // Lebenszeichen fuer das Startskript — ohne Datenbank, ohne Auskunft.
  if (request.method === 'GET' && request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }

  const credentials = credentialsFrom(request.headers.authorization);
  if (credentials === null) {
    response.writeHead(401, { 'www-authenticate': 'Bearer realm="openapps"' }).end();
    return;
  }

  try {
    const ctx = platformContext();
    const actor = await actorForClient(ctx, credentials.id, credentials.secret);
    const server = await createPlatformServer({ ctx, actor, invoker });
    // Zustandslos: ein Transport pro Aufruf. Damit traegt kein Aufruf Rechte
    // eines frueheren mit sich.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // Das SDK deklariert `sessionId?: string`, verlangt in `connect` aber
    // `sessionId: string`. Unter `exactOptionalPropertyTypes` passt das nicht
    // zusammen — ein Widerspruch in den Typen des SDK, nicht hier. Die
    // Zusicherung ist eng: dasselbe Objekt, nur als `Transport` gelesen.
    await server.connect(transport as unknown as Transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    const status = error instanceof UnauthenticatedError ? 401 : 500;
    response
      .writeHead(status, { 'content-type': 'text/plain' })
      .end(status === 401 ? 'nicht angemeldet' : 'interner Fehler');
  }
});

httpServer.listen(PORT, HOST, () => {
  process.stderr.write(`platform-mcp hoert auf ${HOST}:${PORT}\n`);
});
