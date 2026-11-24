/**
 * Laeuft einmal beim Start des Servers, bevor die erste Anfrage bedient wird.
 * Hier spielt die App ihre Migrationen ein — mit ihrer eigenen Rolle in ihr
 * eigenes Schema (siehe runMigrations im SDK).
 *
 * Nur in der Node-Laufzeit: Die Edge-Laufzeit hat keinen Postgres-Treiber und
 * kein Dateisystem. Deshalb auch die dynamischen Importe — ein statischer
 * Import zoege `pg` in das Edge-Bundle.
 *
 * Scheitert eine Migration, wirft `register` und der Server startet nicht.
 * Das ist gewollt: Eine App auf halbem Schema ist schlimmer als eine, die
 * nicht laeuft.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if ((process.env.DATABASE_URL ?? '').trim() === '') {
    console.warn('[crm] DATABASE_URL ist nicht gesetzt — Migrationen übersprungen.');
    return;
  }

  const [{ runMigrations }, { join }, { appPool }] = await Promise.all([
    import('@openapps/sdk'),
    import('node:path'),
    import('./lib/db'),
  ]);

  const result = await runMigrations(appPool(), join(process.cwd(), 'migrations'));
  if (result.applied.length > 0) {
    console.info(`[crm] Migrationen angewendet: ${result.applied.join(', ')}`);
  }
}
