/**
 * Laeuft einmal beim Start des Servers, bevor die erste Anfrage bedient wird.
 * Nur in der Node-Runtime: Die Edge-Runtime hat weder Dateisystem noch `pg`,
 * deshalb der dynamische Import.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateOnStart } = await import('./lib/migrate-on-start');
  await migrateOnStart();
}
