/**
 * Der taegliche Loeschlauf der Ereignisse (ADR 0022 F). Laeuft im Prozess
 * der Control Plane, gestartet aus `instrumentation.ts`: einmal kurz nach dem
 * Start, dann alle 24 Stunden. Scheitert ein Lauf, versucht es der naechste;
 * der Prozess laeuft weiter.
 *
 * Die Frist kommt aus `OPENAPPS_EVENTS_RETENTION_DAYS` (Default 90). Ein
 * unbrauchbarer Wert ist laut (ALARM im Log) und loescht nichts, statt eine
 * Frist zu raten.
 */

import { purgeExpiredEvents, retentionDaysFrom, type DomainContext } from '../domain';

export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RETENTION_FIRST_RUN_DELAY_MS = 60 * 1000;

export interface RetentionLog {
  info(message: string): void;
  error(message: string): void;
}

/** Ein Lauf. Gibt zurueck, was geloescht wurde, oder `null`, wenn nichts lief. */
export async function runEventRetention(
  ctx: DomainContext,
  env: Readonly<Record<string, string | undefined>>,
  log: RetentionLog = console,
): Promise<{ events: number; notifications: number } | null> {
  let days: number;
  try {
    days = retentionDaysFrom(env.OPENAPPS_EVENTS_RETENTION_DAYS);
  } catch (error) {
    log.error(
      `ALARM event retention not run: ${error instanceof Error ? error.message : 'invalid'}`,
    );
    return null;
  }
  try {
    const removed = await purgeExpiredEvents(ctx, { retentionDays: days });
    if (removed.events > 0) {
      log.info(
        `event retention (${String(days)} days): ${String(removed.events)} event(s), ` +
          `${String(removed.notifications)} notification(s) deleted`,
      );
    }
    return { events: removed.events, notifications: removed.notifications };
  } catch (error) {
    log.error(`event retention failed: ${error instanceof Error ? error.name : 'error'}`);
    return null;
  }
}

/** Startet den Takt. Gibt eine Funktion zurueck, die ihn anhaelt. */
export function startEventRetention(
  ctx: () => DomainContext,
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly firstRunDelayMs?: number;
    readonly intervalMs?: number;
  } = {},
): () => void {
  const env = options.env ?? process.env;
  const run = (): void => {
    void runEventRetention(ctx(), env);
  };
  const first = setTimeout(run, options.firstRunDelayMs ?? RETENTION_FIRST_RUN_DELAY_MS);
  const timer = setInterval(run, options.intervalMs ?? RETENTION_INTERVAL_MS);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
