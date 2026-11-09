/**
 * Laute Befunde, die nichts abbrechen.
 *
 * Dieselbe Entscheidung wie beim Startup-Check in `gateway-guard.ts`, aus
 * demselben Grund: Ein Befund des Label-Lints macht eine App kaputt, nicht
 * offen (Spec 1.2 — der Schutz haengt am Entrypoint, eine App ohne Router
 * landet am Catch-all mit 403). Ein `process.exit` oder ein rotes `/healthz`
 * wuerde den Schaden vergroessern: Stirbt die Control Plane, antwortet die
 * Forward-Auth niemandem mehr und **jede** Domain sperrt, auch der Login, ueber
 * den der Befund behoben wird.
 *
 * Also: im Prozess merken, einmal laut ins Log, in `/healthz` sichtbar. Der
 * dauerhafte Nachweis liegt im Audit-Log und am Status des Deployments; dies
 * hier ist die Stelle, die ihn ohne Datenbankzugriff zeigt — `/healthz` darf
 * die Datenbank nicht anfassen.
 */

import type { AlarmSink, PlatformAlarm } from '../domain/ports';

const raised = new Map<string, PlatformAlarm>();

function keyOf(kind: string, subject: string): string {
  return `${kind}\u0000${subject}`;
}

/** Die offenen Alarme, je einer pro Art und Gegenstand. */
export function platformAlarms(): readonly PlatformAlarm[] {
  return [...raised.values()];
}

/** Nur fuer Tests: Zustand zuruecksetzen. */
export function resetPlatformAlarms(): void {
  raised.clear();
}

export function createAlarmSink(log: Pick<Console, 'error' | 'info'> = console): AlarmSink {
  return {
    raise(alarm: PlatformAlarm): void {
      raised.set(keyOf(alarm.kind, alarm.subject), alarm);
      log.error(`ALARM ${alarm.kind} ${alarm.subject}: ${alarm.problems.join(' | ')}`);
    },
    clear(kind: string, subject: string): void {
      if (raised.delete(keyOf(kind, subject))) {
        log.info(`Alarm ${kind} ${subject} ist behoben.`);
      }
    },
  };
}
