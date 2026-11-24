/**
 * Migrationen und Beispieldaten gegen ein echtes Postgres (die Test-Instanz
 * aus `apps/control-plane/docker-compose.yml`). Ohne Instanz wird
 * uebersprungen.
 *
 * Riskant ist hier: dass Beispieldaten auf einem Server landen, dass eine
 * geaenderte Datei still uebergangen wird, und dass Seeds und Migrationen
 * gleichen Namens sich gegenseitig fuer erledigt halten.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_TABLE, runMigrations, runSeeds, SdkConfigurationError } from '../src/index.js';

const URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://openapps_owner:openapps_test@localhost:55432/openapps_test';

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: URL, connectionTimeoutMillis: 1500 });
  try {
    await probe.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const ok = await reachable();

describe.skipIf(!ok)('runMigrations und runSeeds', () => {
  const schema = `sdk_migrate_${process.pid}`;
  let pool: pg.Pool;
  let root: string;
  let migrations: string;
  let seeds: string;

  beforeAll(async () => {
    const admin = new pg.Pool({ connectionString: URL });
    await admin.query(`drop schema if exists ${schema} cascade; create schema ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: URL, options: `-c search_path=${schema}` });
  });

  afterAll(async () => {
    await pool.query(`drop schema if exists ${schema} cascade`);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`drop table if exists ${MIGRATIONS_TABLE}, notiz`);
    root = mkdtempSync(join(tmpdir(), 'sdk-migrate-'));
    migrations = join(root, 'migrations');
    seeds = join(root, 'seeds');
    mkdirSync(migrations);
    mkdirSync(seeds);
    writeFileSync(join(migrations, '0001_notiz.sql'), 'create table notiz (text text not null);');
    writeFileSync(join(seeds, '0001_notiz.sql'), "insert into notiz values ('beispiel');");
    return () => rmSync(root, { recursive: true, force: true });
  });

  const count = async (): Promise<number> =>
    Number((await pool.query<{ n: string }>('select count(*) as n from notiz')).rows[0]?.n);

  it('spielt ohne OPENAPPS_SAMPLE_DATA=1 keine Beispieldaten ein', async () => {
    await runMigrations(pool, migrations);
    expect(await runSeeds(pool, seeds, {})).toBeNull();
    expect(await runSeeds(pool, seeds, { OPENAPPS_SAMPLE_DATA: 'true' })).toBeNull();
    expect(await count()).toBe(0);
  });

  it('spielt sie mit OPENAPPS_SAMPLE_DATA=1 genau einmal ein', async () => {
    await runMigrations(pool, migrations);
    const first = await runSeeds(pool, seeds, { OPENAPPS_SAMPLE_DATA: '1' });
    const second = await runSeeds(pool, seeds, { OPENAPPS_SAMPLE_DATA: '1' });
    expect(first?.applied).toEqual(['seed/0001_notiz.sql']);
    expect(second?.skipped).toEqual(['seed/0001_notiz.sql']);
    expect(await count()).toBe(1);
  });

  it('haelt Seed und Migration gleichen Dateinamens auseinander', async () => {
    const m = await runMigrations(pool, migrations);
    const s = await runSeeds(pool, seeds, { OPENAPPS_SAMPLE_DATA: '1' });
    expect(m.applied).toEqual(['0001_notiz.sql']);
    expect(s?.applied).toEqual(['seed/0001_notiz.sql']);
  });

  it('bricht ab, wenn eine angewendete Datei geaendert wurde', async () => {
    await runMigrations(pool, migrations);
    writeFileSync(join(migrations, '0001_notiz.sql'), 'create table notiz (anders text);');
    await expect(runMigrations(pool, migrations)).rejects.toBeInstanceOf(SdkConfigurationError);
  });
});
