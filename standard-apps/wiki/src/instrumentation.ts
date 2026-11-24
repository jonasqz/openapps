/**
 * Laeuft einmal beim Start des Servers, bevor die erste Anfrage bedient wird.
 * Hier zieht die App ihr Schema auf den Stand von `migrations/`.
 *
 * Nur in der Node-Runtime: Die Edge-Runtime hat weder Dateisystem noch `pg`.
 * Der Import ist deshalb dynamisch, damit der Edge-Build ihn nie sieht.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateOnStart } = await import('./lib/migrate-on-start');
  await migrateOnStart();
}
