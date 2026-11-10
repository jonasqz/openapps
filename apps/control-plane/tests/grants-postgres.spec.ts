/**
 * DoD 3, die Haelfte, die nur eine echte Datenbank belegen kann:
 * **Postgres** verweigert App A den Zugriff auf das Schema von App B, und eine
 * Freigabe wirkt genau so weit, wie sie reicht.
 *
 * Diese Tests laufen gegen die Instanz aus `docker-compose.yml`:
 *
 *     docker compose -f apps/control-plane/docker-compose.yml up -d
 *
 * Ist sie nicht erreichbar, ueberspringen sie sich. Ein fehlender Container ist
 * ein fehlender Nachweis, kein fehlgeschlagener.
 *
 * Gegenstueck: `grants.spec.ts` prueft dieselbe Abfolge im Rechtemodell, ohne
 * Datenbank. Beides zusammen ist der Nachweis — das Modell sagt „nein", und
 * Postgres sagt es auch, wenn sich eine App nicht an das Modell haelt.
 */

import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, grant, revoke, systemClock, uuidIds } from '../src/domain';
import type { DomainContext } from '../src/domain';
import { createPipeline } from '../src/domain/review-gate';
import {
  createRecordingBackend,
  createRecordingGatewayConfigStore,
  createRecordingRepositoryBackend,
} from '../src/infra/memory/doubles';
import {
  createAgentIdentityRepository,
  createAppRepository,
  createAuditRepository,
  createDeploymentRepository,
  createGrantRepository,
  createGroupRepository,
  createPgProvisioner,
} from '../src/infra/pg';
import {
  freshDatabase,
  postgresReachable,
  sqlError,
  OWNER_DATABASE_URL,
  TEST_DATABASE_URL,
  type PgFixture,
} from './pg-helpers';
import { admin, manifest, testGatewaySettings, TEST_MASTER_SECRET } from './helpers';

const reachable = await postgresReachable();

/** Host-Teil der DSN, die eine App bekommt — aus der Test-URL abgeleitet. */
const appDatabaseHost = (() => {
  const url = new URL(OWNER_DATABASE_URL);
  return `${url.host}${url.pathname}`;
})();

describe.skipIf(!reachable)('Postgres setzt die Schema-Trennung durch', () => {
  let db: PgFixture;
  let ctx: DomainContext;

  beforeEach(async () => {
    db = await freshDatabase();
    ctx = {
      apps: createAppRepository(db.pool),
      deployments: createDeploymentRepository(db.pool),
      grants: createGrantRepository(db.pool),
      groups: createGroupRepository(db.pool),
      audit: createAuditRepository(db.pool),
      agents: createAgentIdentityRepository(db.pool),
      clock: systemClock,
      ids: uuidIds,
      backend: createRecordingBackend(),
      gatewayConfig: createRecordingGatewayConfigStore(),
      gatewaySettings: testGatewaySettings(),
      repositories: createRecordingRepositoryBackend(),
      reviewGate: createPipeline([]),
      // Der echte Provisioner: er ruft provision_app_schema (0006, ersetzt in 0013).
      provisioner: createPgProvisioner(db.pool, {
        appDsnTemplate: ({ role, password }) =>
          `postgres://${role}:${encodeURIComponent(password)}@${appDatabaseHost}`,
      }),
      authMasterSecret: TEST_MASTER_SECRET,
    };
    // Der Bootstrap-Grant steht in Migration 0006, also ist er schon da.
  });

  afterEach(async () => {
    await db.close();
  });

  it('legt Schema und Rolle an, und die Rolle ist weder SUPERUSER noch BYPASSRLS', async () => {
    await createApp(ctx, { actor: admin, name: 'projects', manifest: manifest('projects') });
    await createApp(ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });

    const { rows } = await db.pool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolinherit: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit
         FROM pg_roles WHERE rolname LIKE 'app\\_%' ORDER BY rolname`,
    );

    expect(rows.map((r) => r.rolname)).toEqual(['app_crm', 'app_projects']);
    for (const role of rows) {
      // Die Regel aus CLAUDE.md, hier gemessen statt behauptet.
      expect(role.rolsuper, `${role.rolname} ist SUPERUSER`).toBe(false);
      expect(role.rolbypassrls, `${role.rolname} hat BYPASSRLS`).toBe(false);
      expect(role.rolcreatedb).toBe(false);
      expect(role.rolcreaterole).toBe(false);
      expect(role.rolinherit).toBe(false);
    }

    const schemas = await db.pool.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'app\\_%' ORDER BY nspname`,
    );
    expect(schemas.rows.map((r) => r.nspname)).toEqual(['app_crm', 'app_projects']);
  });

  it('laeuft selbst ohne Superuser — so wie im Betrieb', async () => {
    // Die Rolle, mit der die Control Plane hier arbeitet. Liefe sie als
    // Superuser, waeren die Befunde aus Migration 0013 wieder unsichtbar.
    const { rows } = await db.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('legt eine App zweimal an (zweiter Deploy) und bricht ab, wenn ihre Rolle aufgeweicht wurde', async () => {
    const projects = await setupApp('projects');
    expect(projects).toBeDefined();
    const app = await ctx.apps.findByName('projects');
    if (app === null) throw new Error('App fehlt');

    // Zweiter Deploy: setzt das Passwort neu. Ohne Superuser ging genau das
    // vor 0013 schief.
    await expect(
      ctx.provisioner.provision({ schemaName: app.schemaName, dbRole: app.dbRole }),
    ).resolves.toBeDefined();

    // Jemand hat der Rolle von Hand BYPASSRLS gegeben. Die Control Plane
    // kann das nicht zuruecknehmen (nur ein Superuser darf es) — also darf
    // sie die Rolle auch nicht weiter ausgeben.
    const superuser = db.connectAs(TEST_DATABASE_URL);
    await superuser.query(`ALTER ROLE "${app.dbRole}" BYPASSRLS`);
    await expect(
      ctx.provisioner.provision({ schemaName: app.schemaName, dbRole: app.dbRole }),
    ).rejects.toThrow(/BYPASSRLS/);
  });

  it('blockiert → Freigabe → lesbar → Widerruf → blockiert, in Postgres selbst', async () => {
    const projects = await setupApp('projects');
    const crm = await setupApp('crm');

    // App B legt ihre eigenen Tabellen an — mit ihrer eigenen Rolle, in ihrem
    // eigenen Schema. Mehr kann sie nicht, und mehr braucht sie nicht.
    await projects.db.query('CREATE TABLE items (id int primary key, titel text)');
    await projects.db.query("INSERT INTO items VALUES (1, 'erstes Projekt')");
    await projects.db.query('CREATE TABLE geheim (id int primary key)');

    // 1. blockiert
    expect(await sqlError(crm.db, 'SELECT * FROM app_projects.items')).toContain(
      'permission denied for schema app_projects',
    );

    // 2. Freigabe über das Rechtemodell — dieselbe Funktion wie in der UI.
    const granted = await grant(ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'crm' },
      verb: 'read',
      resource: { kind: 'table', id: 'projects.items' },
    });

    // 3. lesbar — und nur das Freigegebene.
    const read = await crm.db.query<{ titel: string }>('SELECT titel FROM app_projects.items');
    expect(read.rows[0]?.titel).toBe('erstes Projekt');
    expect(await sqlError(crm.db, 'SELECT * FROM app_projects.geheim')).toContain(
      'permission denied for table geheim',
    );
    // Lesen heisst lesen: kein Schreiben.
    expect(await sqlError(crm.db, 'INSERT INTO app_projects.items VALUES (2, 1)')).toMatch(
      /permission denied/,
    );

    // 4. Widerruf
    await revoke(ctx, { actor: admin, grantId: granted.id });

    // 5. wieder blockiert — in derselben, offenen Verbindung, ohne Neuaufbau.
    //    Genau das ist „Widerruf wirkt sofort".
    expect(await sqlError(crm.db, 'SELECT * FROM app_projects.items')).toMatch(/permission denied/);
  });

  it('laesst den search_path-Trick scheitern', async () => {
    const projects = await setupApp('projects');
    const crm = await setupApp('crm');
    await projects.db.query('CREATE TABLE items (id int primary key)');

    // Der Versuch aus AGENTS.md Regel 2: den search_path umbiegen und so in
    // ein fremdes Schema greifen. Das Setzen gelingt — es ist eine
    // Sitzungseinstellung —, der Zugriff nicht.
    await crm.db.query('SET search_path TO app_projects');
    expect(await sqlError(crm.db, 'SELECT * FROM items')).toMatch(
      /permission denied for schema app_projects|relation "items" does not exist/,
    );

    // Auch die Suche im Katalog hilft nicht weiter.
    const visible = await crm.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM information_schema.tables
        WHERE table_schema = 'app_projects'`,
    );
    expect(visible.rows[0]?.count).toBe('0');
  });

  it('gibt der App kein Recht auf public und keines auf die Tabellen der Control Plane', async () => {
    const crm = await setupApp('crm');

    expect(await sqlError(crm.db, 'SELECT * FROM public.apps')).toMatch(
      /permission denied|does not exist/,
    );
    expect(await sqlError(crm.db, 'SELECT * FROM public.grants')).toMatch(
      /permission denied|does not exist/,
    );
    expect(await sqlError(crm.db, 'CREATE TABLE public.fremd (id int)')).toMatch(
      /permission denied/,
    );
  });

  /** Legt eine App an und gibt eine Verbindung mit ihrer eigenen Rolle zurueck. */
  async function setupApp(name: string): Promise<{ db: Pool }> {
    await createApp(ctx, { actor: admin, name, manifest: manifest(name) });
    const app = await ctx.apps.findByName(name);
    if (app === null) throw new Error(`App ${name} wurde nicht angelegt`);
    // Die DSN wird neu gezogen, weil das Passwort nirgends gespeichert wird.
    const { dsn } = await ctx.provisioner.provision({
      schemaName: app.schemaName,
      dbRole: app.dbRole,
    });
    return { db: db.connectAs(dsn) };
  }
});

describe.skipIf(reachable)('ohne Test-Postgres', () => {
  it('uebersprungen: docker compose -f apps/control-plane/docker-compose.yml up -d', () => {
    // Dieser Test macht das Ueberspringen sichtbar, statt es zu verschweigen.
    expect(reachable).toBe(false);
  });
});
