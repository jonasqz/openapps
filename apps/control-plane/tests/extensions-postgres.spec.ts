/**
 * ADR 0025 Schritt 1, die Haelfte, die nur eine echte Datenbank belegen
 * kann: pgvector liegt im Schema `extensions`, und eine App-Rolle bekommt
 * dort genau `USAGE`, wenn ihr Manifest es verlangt, sonst nichts, nie
 * `CREATE`. Die Control Plane bleibt dabei ohne Superuser.
 *
 * Laeuft gegen die Test-Instanz aus `docker-compose.yml`. Ist sie nicht
 * erreichbar, ueberspringen sich alle Tests. Bringt sie pgvector nicht mit,
 * ueberspringen sich nur die Tests, die es brauchen; der Pfad „Erweiterung
 * fehlt“ laeuft trotzdem.
 */

import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, systemClock, uuidIds } from '../src/domain';
import type { DomainContext } from '../src/domain';
import { MissingDatabaseExtensionError } from '../src/domain/errors';
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
  installVector,
  vectorAvailable,
  OWNER_DATABASE_URL,
  postgresReachable,
  sqlError,
  superuserOnOwnerDatabase,
  TEST_OWNER_ROLE,
  vectorSetupSql,
  type PgFixture,
} from './pg-helpers';
import { admin, manifest, testGatewaySettings, TEST_MASTER_SECRET } from './helpers';

const reachable = await postgresReachable();
const vector = reachable && (await vectorAvailable());

const appDatabaseHost = (() => {
  const url = new URL(OWNER_DATABASE_URL);
  return `${url.host}${url.pathname}`;
})();

interface Snapshot {
  readonly extensions: unknown[];
  readonly schema: unknown[];
}

/** Was der Schritt anlegt: Erweiterung, Schema mit Eigentuemer und Rechten. */
async function snapshot(pool: Pool): Promise<Snapshot> {
  const extensions = await pool.query(
    `SELECT e.extname, e.extversion, n.nspname FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace ORDER BY e.extname`,
  );
  const schema = await pool.query(
    `SELECT n.nspname, r.rolname AS owner, n.nspacl::text AS acl
       FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = 'extensions'`,
  );
  return { extensions: extensions.rows, schema: schema.rows };
}

describe.skipIf(!reachable)('pgvector im Schema extensions (ADR 0025)', () => {
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
      provisioner: createPgProvisioner(db.pool, {
        appDsnTemplate: ({ role, password }) =>
          `postgres://${role}:${encodeURIComponent(password)}@${appDatabaseHost}`,
      }),
      authMasterSecret: TEST_MASTER_SECRET,
    };
  });

  afterEach(async () => {
    await db.close();
  });

  async function setupApp(name: string): Promise<{ db: Pool; role: string }> {
    await createApp(ctx, { actor: admin, name, manifest: manifest(name) });
    const app = await ctx.apps.findByName(name);
    if (app === null) throw new Error(`App ${name} wurde nicht angelegt`);
    const { dsn } = await ctx.provisioner.provision({
      schemaName: app.schemaName,
      dbRole: app.dbRole,
    });
    return { db: db.connectAs(dsn), role: app.dbRole };
  }

  it('ohne Erweiterung endet syncExtensions mit dem Hinweis auf den einmaligen Schritt', async () => {
    const knowledge = await setupApp('knowledge');
    const error = await ctx.provisioner
      .syncExtensions({ dbRole: knowledge.role, extensions: ['vector'] })
      .then(
        () => null,
        (caught: unknown) => caught,
      );
    expect(error).toBeInstanceOf(MissingDatabaseExtensionError);
    expect((error as Error).message).toMatch(/openapps-vector/);
    // Ohne Bedarf geht es ohne Erweiterung weiter wie bisher.
    await expect(
      ctx.provisioner.syncExtensions({ dbRole: knowledge.role, extensions: [] }),
    ).resolves.toBeUndefined();
  });

  it.skipIf(!vector)(
    'der Schritt legt vector an, und ein zweiter Lauf aendert nichts',
    async () => {
      await installVector();
      const superuser = superuserOnOwnerDatabase();
      try {
        const first = await snapshot(superuser);
        expect(first.extensions).toContainEqual(
          expect.objectContaining({ extname: 'vector', nspname: 'extensions' }),
        );
        await superuser.query(vectorSetupSql(TEST_OWNER_ROLE));
        expect(await snapshot(superuser)).toEqual(first);
      } finally {
        await superuser.end();
      }
    },
  );

  it.skipIf(!vector)(
    'eine App-Rolle mit Bedarf nutzt extensions.vector, legt dort aber nichts an',
    async () => {
      await installVector();
      const knowledge = await setupApp('knowledge');
      await ctx.provisioner.syncExtensions({ dbRole: knowledge.role, extensions: ['vector'] });

      // Typ und Operator voll qualifiziert, der search_path bleibt das eigene Schema.
      const distance = await knowledge.db.query<{ d: number }>(
        `SELECT ('[1,0]'::extensions.vector OPERATOR(extensions.<=>) '[0,1]'::extensions.vector) AS d`,
      );
      expect(Number(distance.rows[0]?.d)).toBeCloseTo(1, 5);
      await knowledge.db.query('CREATE TABLE emb (id int primary key, v extensions.vector)');

      expect(await sqlError(knowledge.db, 'CREATE TABLE extensions.boese (id int)')).toMatch(
        /permission denied for schema extensions/,
      );
      expect(
        await sqlError(
          knowledge.db,
          'CREATE FUNCTION extensions.boese() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
        ),
      ).toMatch(/permission denied for schema extensions/);

      const { rows } = await db.pool.query<{ usage: boolean; create: boolean }>(
        `SELECT has_schema_privilege($1, 'extensions', 'USAGE') AS usage,
              has_schema_privilege($1, 'extensions', 'CREATE') AS create`,
        [knowledge.role],
      );
      expect(rows[0]).toEqual({ usage: true, create: false });
    },
  );

  it.skipIf(!vector)(
    'ohne Bedarf kein USAGE, und ein weggefallener Bedarf nimmt es wieder',
    async () => {
      await installVector();
      const crm = await setupApp('crm');
      await ctx.provisioner.syncExtensions({ dbRole: crm.role, extensions: [] });
      expect(await sqlError(crm.db, `SELECT '[1]'::extensions.vector`)).toMatch(
        /permission denied for schema extensions/,
      );

      await ctx.provisioner.syncExtensions({ dbRole: crm.role, extensions: ['vector'] });
      expect(await sqlError(crm.db, `SELECT '[1]'::extensions.vector`)).toBeNull();

      await ctx.provisioner.syncExtensions({ dbRole: crm.role, extensions: [] });
      expect(await sqlError(crm.db, `SELECT '[1]'::extensions.vector`)).toMatch(
        /permission denied for schema extensions/,
      );
    },
  );

  it.skipIf(!vector)(
    'bricht ab, wenn eine Rolle von Hand CREATE auf extensions bekam',
    async () => {
      await installVector();
      const knowledge = await setupApp('knowledge');
      const superuser = superuserOnOwnerDatabase();
      try {
        await superuser.query(`GRANT CREATE ON SCHEMA extensions TO "${knowledge.role}"`);
      } finally {
        await superuser.end();
      }
      await expect(
        ctx.provisioner.syncExtensions({ dbRole: knowledge.role, extensions: ['vector'] }),
      ).rejects.toThrow(/CREATE/);
    },
  );

  it('die Control Plane selbst bleibt ohne Superuser und ohne BYPASSRLS', async () => {
    const { rows } = await db.pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe.skipIf(reachable)('ohne Test-Postgres (Erweiterungen)', () => {
  it('uebersprungen: docker compose -f apps/control-plane/docker-compose.yml up -d', () => {
    expect(reachable).toBe(false);
  });
});
