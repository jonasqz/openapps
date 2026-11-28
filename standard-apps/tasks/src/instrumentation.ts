/**
 * Laeuft einmal beim Start des Servers, bevor die erste Anfrage bedient wird:
 * erst die Migrationen, dann die Lieferung der Ereignisse (`events.ts`,
 * ADR 0022) und der Verweise (`refs.ts`, ADR 0023) an die Plattform. Die
 * Lieferung haelt den Start nicht auf und laesst ihn nicht scheitern.
 *
 * Nur in der Node-Runtime: Die Edge-Runtime hat weder Dateisystem noch `pg`,
 * deshalb der dynamische Import.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { migrateOnStart } = await import('./lib/migrate-on-start');
  await migrateOnStart();
  if ((process.env.DATABASE_URL ?? '').trim() === '') return;
  const { taskEvents } = await import('./lib/events');
  taskEvents.start();
  // Verweise an die Plattform (ADR 0023), getrennt von den Ereignissen.
  const { taskRefs } = await import('./lib/refs');
  taskRefs.start();
}
