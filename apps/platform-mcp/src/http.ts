#!/usr/bin/env node
/**
 * Start ueber HTTP — der Weg fuer Agents, die sich als eigener OAuth-Client
 * anmelden.
 *
 * Die Identitaet kommt pro Aufruf aus `Authorization: Basic <clientId:secret>`
 * und wird bei **jedem** Aufruf geprueft. Kein Token-Cache, keine Session:
 * wird ein Agent gesperrt, ist er beim naechsten Aufruf draussen.
 */

import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { platformContext } from './context';
import { actorForClient, UnauthenticatedError } from './identity';
import { createHttpInvoker } from './invoker';
import { createPlatformServer } from './server';

const PORT = Number(process.env.PLATFORM_MCP_PORT ?? '3001');

function credentialsFrom(header: string | undefined): { id: string; secret: string } | null {
  if (header === undefined || !header.toLowerCase().startsWith('basic ')) return null;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator === -1) return null;
  return { id: decoded.slice(0, separator), secret: decoded.slice(separator + 1) };
}

const signingSecret = process.env.GATEWAY_SIGNING_SECRET;
if (signingSecret === undefined) {
  throw new Error('GATEWAY_SIGNING_SECRET fehlt');
}
const invoker = createHttpInvoker({ gatewaySigningSecret: signingSecret });

const httpServer = createServer(async (request, response) => {
  const credentials = credentialsFrom(request.headers.authorization);
  if (credentials === null) {
    response.writeHead(401, { 'www-authenticate': 'Basic realm="openapps"' }).end();
    return;
  }

  try {
    const ctx = platformContext();
    const actor = await actorForClient(ctx, credentials.id, credentials.secret);
    const server = await createPlatformServer({ ctx, actor, invoker });
    // Zustandslos: ein Transport pro Aufruf. Damit traegt kein Aufruf Rechte
    // eines frueheren mit sich.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(request, response);
  } catch (error) {
    const status = error instanceof UnauthenticatedError ? 401 : 500;
    response.writeHead(status, { 'content-type': 'text/plain' }).end(
      status === 401 ? 'nicht angemeldet' : 'interner Fehler',
    );
  }
});

httpServer.listen(PORT, () => {
  process.stderr.write(`platform-mcp hoert auf Port ${PORT}\n`);
});
