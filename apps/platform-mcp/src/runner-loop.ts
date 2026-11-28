/**
 * Die Schleife des Prozesses fuer Laeufe (ADR 0024 E), ohne Start, damit sie
 * testbar ist. Warteschlange in Postgres (`agent_runs`), hoechstens
 * `concurrency` Laeufe zugleich.
 */

import {
  claimAgentRun,
  executeAgentRun,
  failInterruptedRuns,
  type AppToolInvoker,
  type DomainContext,
  type RefCache,
  type RunToolboxFactory,
} from '@openapps/control-plane/domain';
import { createRunToolbox } from './run-toolbox';

export const RUN_CONCURRENCY_DEFAULT = 2;
export const RUN_CONCURRENCY_MAX = 10;

/** `OPENAPPS_AGENT_RUN_CONCURRENCY`: ganze Zahl von 1 bis 10, sonst der Default. */
export function runConcurrencyFrom(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return RUN_CONCURRENCY_DEFAULT;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > RUN_CONCURRENCY_MAX) {
    process.stderr.write(
      `ALARM OPENAPPS_AGENT_RUN_CONCURRENCY must be a whole number from 1 to ${String(RUN_CONCURRENCY_MAX)}; using ${String(RUN_CONCURRENCY_DEFAULT)}\n`,
    );
    return RUN_CONCURRENCY_DEFAULT;
  }
  return parsed;
}

export interface Runner {
  /** Nimmt wartende Laeufe auf, bis die Grenze erreicht ist. */
  tick(): Promise<void>;
  /** Nimmt nichts mehr an und wartet auf die laufenden; danach bricht er sie ab. */
  stop(graceMs: number): Promise<void>;
  readonly active: () => number;
}

export function createRunner(input: {
  readonly ctx: DomainContext;
  readonly invoker: AppToolInvoker;
  readonly concurrency: number;
  readonly refCache?: RefCache;
  /** Fuer Tests: eigene Tools statt des Plattform-MCP. */
  readonly toolbox?: RunToolboxFactory;
}): Runner {
  const running = new Set<Promise<void>>();
  const abort = new AbortController();
  let stopping = false;
  let ticking = false;
  const toolbox: RunToolboxFactory =
    input.toolbox ??
    ((ctx, scope) =>
      createRunToolbox({
        ctx,
        scope,
        invoker: input.invoker,
        ...(input.refCache === undefined ? {} : { refCache: input.refCache }),
      }));

  return {
    active: () => running.size,
    async tick() {
      if (ticking || stopping) return;
      ticking = true;
      try {
        while (!stopping && running.size < input.concurrency) {
          const run = await claimAgentRun(input.ctx);
          if (run === null) break;
          const task: Promise<void> = executeAgentRun(input.ctx, {
            run,
            toolbox,
            signal: abort.signal,
          })
            .then(() => undefined)
            .catch((error: unknown) => {
              process.stderr.write(`[runner] run ${run.id}: ${String(error)}\n`);
            })
            .finally(() => {
              running.delete(task);
            });
          running.add(task);
        }
      } finally {
        ticking = false;
      }
    },
    async stop(graceMs) {
      stopping = true;
      const timer = setTimeout(() => abort.abort(), graceMs);
      await Promise.allSettled([...running]);
      clearTimeout(timer);
    },
  };
}

export { failInterruptedRuns };
