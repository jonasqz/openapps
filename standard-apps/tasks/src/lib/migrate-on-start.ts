import { join } from 'node:path';
import { createAppPool, runMigrations, runSeeds } from '@openapps/sdk';

/**
 * Migrationen beim Start, danach Beispieldaten aus `seeds/` (nur wenn die
 * Plattform `OPENAPPS_SAMPLE_DATA=1` setzt, also lokal). Scheitert eine
 * Migration, startet die App nicht: Ein halbes Schema ist schlimmer als keins.
 */
export async function migrateOnStart(): Promise<void> {
  if ((process.env.DATABASE_URL ?? '').trim() === '') {
    console.warn('[tasks] DATABASE_URL is not set — migrations skipped.');
    return;
  }
  const pool = createAppPool();
  try {
    const result = await runMigrations(pool, join(process.cwd(), 'migrations'));
    if (result.applied.length > 0) {
      console.info(`[tasks] Migrations applied: ${result.applied.join(', ')}`);
    }
    const seeded = await runSeeds(pool, join(process.cwd(), 'seeds'));
    if (seeded !== null && seeded.applied.length > 0) {
      console.info(`[tasks] Sample data loaded: ${seeded.applied.join(', ')}`);
    }
  } finally {
    await pool.end();
  }
}
