/**
 * Laeuft einmal beim Start des Servers, bevor die erste Anfrage bedient wird.
 * Hier zieht die App ihr Schema auf den Stand von `migrations/` und startet
 * die Lieferung an die gemeinsame Suche (`search-sync.ts`, ADR 0020), die
 * der Ereignisse (`events.ts`, ADR 0022) und die der Verweise (`refs.ts`,
 * ADR 0023). Keine Lieferung haelt den Start auf
 * oder laesst ihn scheitern.
 *
 * Nur in der Node-Runtime: Die Edge-Runtime hat weder Dateisystem noch `pg`.
 * Der Import ist deshalb dynamisch, damit der Edge-Build ihn nie sieht.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateOnStart } = await import('./lib/migrate-on-start');
  await migrateOnStart();
  if ((process.env.DATABASE_URL ?? '').trim() === '') return;
  const { startSearchSync } = await import('./lib/search-sync');
  void startSearchSync();
  // Ereignisse an die Plattform (ADR 0022), getrennt von der Suche.
  const { wikiEvents } = await import('./lib/events');
  wikiEvents.start();
  // Verweise und Erwaehnungen an die Plattform (ADR 0023).
  const { wikiRefs } = await import('./lib/refs');
  wikiRefs.start();
}
