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
  const masterSecret = process.env.OPENAPPS_AUTH_MASTER_SECRET;

  if (clientId === undefined || clientSecret === undefined) {
    throw new Error('PLATFORM_MCP_CLIENT_ID und PLATFORM_MCP_CLIENT_SECRET fehlen');
  }
  if (masterSecret === undefined) {
    throw new Error('OPENAPPS_AUTH_MASTER_SECRET fehlt');
  }

  const ctx = platformContext();
  const actor = await actorForClient(ctx, clientId, clientSecret);
  const server = await createPlatformServer({
    ctx,
    actor,
    invoker: createHttpInvoker({ authMasterSecret: masterSecret }),
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
