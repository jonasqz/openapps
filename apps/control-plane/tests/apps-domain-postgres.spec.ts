/**
 * Migration 0016: Unter ADR 0007 tragen alle Apps dieselbe Domain. Mit dem
 * UNIQUE aus 0001 scheiterte schon die zweite App an `setPrimaryDomain` — kein
 * Test hatte je zwei Apps in Postgres angelegt.
 *
 * Ohne erreichbare Instanz wird uebersprungen (siehe `pg-helpers.ts`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAppRepository } from '../src/infra/pg';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';
import type { AppRepository } from '../src/domain/ports';
import type { AppManifest } from '../src/domain';

const reachable = await postgresReachable();

const manifest = (name: string): AppManifest =>
  ({
    manifestVersion: 1,
    name,
    displayName: name,
    description: 'Test',
    category: 'test',
    version: '1.0.0',
    requiredTables: [],
    offeredTools: [],
    requestedGrants: [],
    env: [],
    egress: [],
    source: { git: `https://git.test/${name}`, tag: 'v1' },
  }) as AppManifest;

describe.skipIf(!reachable)('gemeinsame App-Domain in Postgres', () => {
  let db: PgFixture;
  let apps: AppRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    apps = createAppRepository(db.pool);
  });

  afterEach(async () => {
    await db.close();
  });

  it('nimmt dieselbe Domain fuer mehrere Apps an', async () => {
    for (const name of ['wiki', 'crm', 'wissen']) {
      const app = await apps.create({
        name,
        displayName: name,
        category: 'test',
        manifest: manifest(name),
        source: { git: `https://git.test/${name}`, tag: 'v1' },
        schemaName: `app_${name}`,
        dbRole: `app_${name}`,
        createdBy: 'user:test',
      });
      await apps.setPrimaryDomain(app.id, 'apps.example.test');
    }
    const all = await apps.listAll();
    expect(all.map((a) => a.primaryDomain)).toEqual([
      'apps.example.test',
      'apps.example.test',
      'apps.example.test',
    ]);
  });

  it('haelt den Namen weiter eindeutig — er ist der Pfad', async () => {
    const input = {
      name: 'crm',
      displayName: 'crm',
      category: 'test',
      manifest: manifest('crm'),
      source: { git: 'https://git.test/crm', tag: 'v1' },
      schemaName: 'app_crm',
      dbRole: 'app_crm',
      createdBy: 'user:test',
    };
    await apps.create(input);
    await expect(apps.create(input)).rejects.toThrow();
  });

  it('schreibt die Domain gleich beim Anlegen mit (ADR 0012)', async () => {
    const app = await apps.create({
      name: 'wiki',
      displayName: 'wiki',
      category: 'test',
      manifest: manifest('wiki'),
      source: { git: 'https://git.test/wiki', tag: 'v1' },
      schemaName: 'app_wiki',
      dbRole: 'app_wiki',
      createdBy: 'user:test',
      primaryDomain: 'apps.example.test',
    });
    expect(app.primaryDomain).toBe('apps.example.test');
    expect((await apps.findByName('wiki'))?.primaryDomain).toBe('apps.example.test');
  });
});
