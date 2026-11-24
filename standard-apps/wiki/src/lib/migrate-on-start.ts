import { join } from 'node:path';
import { runMigrations } from '@openapps/sdk';
import { appPool } from './db';

/**
 * Migrationen beim Start. Ohne `DATABASE_URL` (lokaler Lauf ohne Datenbank,
 * `next build`) wird nur gewarnt — die App startet, und jede Seite zeigt ihren
 * Fehlerzustand.
 *
 * Scheitert eine Migration, wirft diese Funktion: Eine App mit halbem Schema
 * soll nicht starten (die SDK-Funktion rollt die Datei vollstaendig zurueck).
 */
export async function migrateOnStart(): Promise<void> {
  if ((process.env.DATABASE_URL ?? '').trim() === '') {
    console.warn('[wiki] DATABASE_URL ist nicht gesetzt — Migrationen übersprungen.');
    return;
  }
  const result = await runMigrations(appPool(), join(process.cwd(), 'migrations'));
  if (result.applied.length > 0) {
    console.info(`[wiki] Migrationen angewendet: ${result.applied.join(', ')}`);
  }
}
