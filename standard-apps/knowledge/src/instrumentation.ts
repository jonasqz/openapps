/**
 * Laeuft einmal beim Start des Servers (Next `register`).
 *
 * 1. Migrationen im eigenen Schema (`runMigrations` aus dem SDK). Scheitert
 *    eine, wirft `register` und die App startet nicht — lieber kein Start als
 *    ein Stand, den die Datenbank nicht hat.
 * 2. Dokumente ohne Abschnitte zerlegen (`chunkPendingDocuments`).
 *
 * Warum die Beispieldokumente erst hier zerlegt werden und nicht als
 * vorberechnete Abschnitte in `seeds/` stehen:
 *
 * - Es gibt genau einen Weg, auf dem Abschnitte entstehen: `chunkText`. Eine
 *   vorberechnete Migration waere eine zweite, eingefrorene Kopie davon, und
 *   ob sie zur Funktion passt, liesse sich spaeter nicht mehr pruefen — die
 *   Migration darf nie geaendert werden, die Funktion schon.
 * - Die Migration bleibt lesbares SQL, das ein Mensch und das Review-Gate
 *   pruefen koennen, statt vier Dokumente doppelt als generierte Stuecke.
 * - Der Schritt heilt sich selbst: Bricht der Start nach der Migration ab,
 *   holt der naechste Start das Zerlegen nach. Je Dokument eine Transaktion
 *   mit `for update skip locked`, also auch mit zwei Instanzen nie doppelt.
 *
 * Der Preis: Zwischen Migration und Zerlegen sind die Beispieldokumente
 * gelistet, aber nicht auffindbar — Sekundenbruchteile beim ersten Start.
 * Scheitert das Zerlegen, startet die App trotzdem und meldet es im Log;
 * Suche und Ablage funktionieren fuer alles andere weiter.
 *
 * Alles wird erst innerhalb von `register` importiert: `pg` und `node:fs`
 * gehoeren nicht in die Edge-Runtime, die Next fuer diese Datei ebenfalls
 * baut.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if ((process.env.DATABASE_URL ?? '').trim() === '') {
    console.warn('[knowledge] DATABASE_URL is not set — no migrations, no database.');
    return;
  }

  const { join } = await import('node:path');
  const { runMigrations, runSeeds } = await import('@openapps/sdk');
  const { appPool } = await import('./lib/db');
  const { chunkPendingDocuments } = await import('./lib/documents');

  const result = await runMigrations(appPool(), join(process.cwd(), 'migrations'));
  if (result.applied.length > 0) {
    console.info(`[knowledge] Migrations applied: ${result.applied.join(', ')}`);
  }
  // Beispieldokumente nur, wenn die Plattform es verlangt (lokal ja, Server nein).
  const seeded = await runSeeds(appPool(), join(process.cwd(), 'seeds'));
  if (seeded !== null && seeded.applied.length > 0) {
    console.info(`[knowledge] Sample documents loaded: ${seeded.applied.join(', ')}`);
  }

  try {
    const chunked = await chunkPendingDocuments();
    if (chunked > 0) console.info(`[knowledge] Split ${chunked} document(s) into sections.`);
  } catch (error) {
    console.error('[knowledge] Splitting pending documents failed:', error);
  }
}
