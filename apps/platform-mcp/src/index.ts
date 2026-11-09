#!/usr/bin/env node
/**
 * Start ueber stdio — der Weg, auf dem Claude Code den Plattform-MCP anspricht.
 *
 * Die Identitaet kommt aus der Env: `PLATFORM_MCP_CLIENT_ID` und
 * `PLATFORM_MCP_CLIENT_SECRET`. Fehlt sie, startet der Server nicht. Es gibt
 * keinen Lauf ohne Identitaet, weil es ohne Identitaet kein Rechtemodell gibt.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { platformContext } from './context';
import { actorForClient } from './identity';
import { createHttpInvoker } from './invoker';
import { createPlatformServer } from './server';

async function main(): Promise<void> {
  const clientId = process.env.PLATFORM_MCP_CLIENT_ID;
  const clientSecret = process.env.PLATFORM_MCP_CLIENT_SECRET;
  const signingSecret = process.env.GATEWAY_SIGNING_SECRET;

  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('PLATFORM_MCP_CLIENT_ID und PLATFORM_MCP_CLIENT_SECRET fehlen');
  }
  if (signingSecret === undefined) {
    throw new Error('GATEWAY_SIGNING_SECRET fehlt');
  }

  const ctx = platformContext();
  const actor = await actorForClient(ctx, clientId, clientSecret);
  const server = await createPlatformServer({
    ctx,
    actor,
    invoker: createHttpInvoker({ gatewaySigningSecret: signingSecret }),
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
