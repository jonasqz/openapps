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
    console.warn('[crm] DATABASE_URL is not set — skipping migrations.');
    return;
  }

  const [{ runMigrations, runSeeds }, { join }, { appPool }] = await Promise.all([
    import('@openapps/sdk'),
    import('node:path'),
    import('./lib/db'),
  ]);

  const result = await runMigrations(appPool(), join(process.cwd(), 'migrations'));
  if (result.applied.length > 0) {
    console.info(`[crm] migrations applied: ${result.applied.join(', ')}`);
  }

  // Beispieldaten nur, wenn die Plattform es verlangt (lokal ja, Server nein).
  const seeded = await runSeeds(appPool(), join(process.cwd(), 'seeds'));
  if (seeded !== null && seeded.applied.length > 0) {
    console.info(`[crm] sample data loaded: ${seeded.applied.join(', ')}`);
  }

  // Ereignisse an die Plattform (ADR 0022): Outbox liefern, Faelliges melden.
  // Haelt den Start nicht auf und laesst ihn nicht scheitern.
  const { startCrmEvents } = await import('./lib/events');
  startCrmEvents();
  // Verweise und Erwaehnungen an die Plattform (ADR 0023), ebenso ohne Warten.
  const { crmRefs } = await import('./lib/refs');
  crmRefs.start();
}
