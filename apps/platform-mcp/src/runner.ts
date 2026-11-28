#!/usr/bin/env node
/**
 * Der dritte Prozess im Container der Control Plane (ADR 0024 E, neben Next
 * und dem MCP, ADR 0009): fuehrt Laeufe der Plattform-Agents aus. Endet er,
 * endet der Container (`start.sh`).
 *
 * Ohne Chat-Modell startet er trotzdem und wartet: Ohne Modell legt die
 * Plattform keinen Lauf an, und einen alten beendet er mit `not_configured`.
 *
 * Beim Start enden Laeufe, die ein frueherer Prozess hielt, als `failed`
 * (`interrupted`); sie werden nicht wiederholt, weil ein halber Lauf schon
 * in Apps geschrieben haben kann.
 */

import { chatConfigured, createRefCache } from '@openapps/control-plane/domain';
import { platformContext } from './context';
import { createHttpInvoker } from './invoker';
import { createRunner, failInterruptedRuns, runConcurrencyFrom } from './runner-loop';

const masterSecret = process.env.OPENAPPS_AUTH_MASTER_SECRET;
if (masterSecret === undefined || masterSecret === '') {
  throw new Error('OPENAPPS_AUTH_MASTER_SECRET is missing');
}

const ctx = platformContext();
const concurrency = runConcurrencyFrom(process.env.OPENAPPS_AGENT_RUN_CONCURRENCY);
const runner = createRunner({
  ctx,
  invoker: createHttpInvoker({ authMasterSecret: masterSecret }),
  concurrency,
  refCache: createRefCache(),
});
/** Mit Modell alle 2 s nachsehen, ohne alle 15 s (es entsteht ohnehin nichts). */
const pollMs = chatConfigured(ctx) ? 2000 : 15_000;

async function main(): Promise<void> {
  try {
    const interrupted = await failInterruptedRuns(ctx);
    if (interrupted > 0) {
      process.stderr.write(`runner: ${String(interrupted)} interrupted run(s) marked as failed\n`);
    }
  } catch (error) {
    process.stderr.write(`WARN runner: interrupted runs not checked: ${String(error)}\n`);
  }
  process.stderr.write(
    `runner: started, ${String(concurrency)} run(s) at a time, chat ${chatConfigured(ctx) ? 'configured' : 'not configured'}\n`,
  );

  const timer = setInterval(() => {
    runner.tick().catch((error: unknown) => {
      process.stderr.write(`WARN runner: ${String(error)}\n`);
    });
  }, pollMs);

  const shutdown = (): void => {
    clearInterval(timer);
    void runner.stop(20_000).finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
