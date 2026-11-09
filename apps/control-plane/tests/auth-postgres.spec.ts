/**
 * Better Auth gegen eine echte Datenbank: die Haelfte, die nur Postgres
 * belegen kann.
 *
 * - Die Tabellen von Better Auth liegen im Schema `control_plane`, nicht in
 *   `public` (Migration 0008), und Better Auth findet sie dort.
 * - Eine E-Mail ausserhalb von `AUTH_ALLOWED_EMAIL_DOMAINS` bekommt **kein
 *   Konto** — abgewiesen, nicht nur ohne Freigabe gelassen. Bei leerer
 *   Variable gilt das fuer jede.
 * - Eine Bootstrap-Adresse landet in `platform-admins`, eine andere nicht.
 * - Die Gruppen des Session-Lesers kommen aus `group_members`: aendert sich die
 *   Mitgliedschaft, aendert sich die naechste Antwort. Kein Cache.
 *
 * Laeuft gegen die Instanz aus `docker-compose.yml`:
 *
 *     docker compose -f apps/control-plane/docker-compose.yml up -d
 *
 * Ist sie nicht erreichbar, ueberspringen sich diese Tests. Ein fehlender
 * Container ist ein fehlender Nachweis, kein fehlgeschlagener.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGroupMembershipRepository } from '../src/infra/pg';
import { createAuth } from '../src/lib/auth';
import { BOOTSTRAP_GROUP } from '../src/lib/auth-policy';
import { createBetterAuthSessionReader } from '../src/lib/session';
import type { AuthEnv } from '../src/lib/env';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';

const reachable = await postgresReachable();

function authEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return {
    secret: 'test-better-auth-secret-0123456789abcdef',
    baseUrl: 'http://localhost:3000',
    googleClientId: 'test-client-id',
    googleClientSecret: 'test-client-secret',
    allowedEmailDomains: ['example.com'],
    bootstrapAdmins: ['chef@example.com'],
    ...overrides,
  };
}

describe.skipIf(!reachable)('Better Auth gegen Postgres', () => {
  let db: PgFixture;

  beforeEach(async () => {
    db = await freshDatabase();
  });

  afterEach(async () => {
    await db.close();
  });

  it('legt die Tabellen von Better Auth in control_plane an, nicht in public', async () => {
    const { rows } = await db.pool.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_name IN ('user', 'session', 'account', 'verification')
        ORDER BY table_name`,
    );
    expect(rows).toEqual([
      { table_schema: 'control_plane', table_name: 'account' },
      { table_schema: 'control_plane', table_name: 'session' },
      { table_schema: 'control_plane', table_name: 'user' },
      { table_schema: 'control_plane', table_name: 'verification' },
    ]);

    // Das Rechtemodell bleibt, wo es war: in public, neben den Gruppen.
    const modell = await db.pool.query<{ table_schema: string; table_name: string }>(
      `SELECT table_schema, table_name FROM information_schema.tables
        WHERE table_name IN ('grants', 'groups', 'group_members') ORDER BY table_name`,
    );
    expect(modell.rows).toEqual([
      { table_schema: 'public', table_name: 'grants' },
      { table_schema: 'public', table_name: 'group_members' },
      { table_schema: 'public', table_name: 'groups' },
    ]);
  });

  it('weist eine E-Mail ausserhalb der erlaubten Domains ab, bevor ein Konto entsteht', async () => {
    const auth = createAuth({ pool: db.pool, env: authEnv() });
    const ctx = await auth.$context;

    await expect(
      ctx.internalAdapter.createUser({
        email: 'eve@evil.com',
        name: 'Eve',
        emailVerified: true,
      }),
    ).rejects.toThrow(/AUTH_ALLOWED_EMAIL_DOMAINS/);

    const { rows } = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM control_plane."user"`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('weist bei leerer Domain-Liste jede Anmeldung ab, auch die eigene Domain', async () => {
    const auth = createAuth({ pool: db.pool, env: authEnv({ allowedEmailDomains: [] }) });
    const ctx = await auth.$context;

    await expect(
      ctx.internalAdapter.createUser({
        email: 'chef@example.com',
        name: 'Chef',
        emailVerified: true,
      }),
    ).rejects.toThrow(/AUTH_ALLOWED_EMAIL_DOMAINS/);
  });

  it('traegt eine Bootstrap-Adresse in platform-admins ein, eine andere nicht', async () => {
    const auth = createAuth({ pool: db.pool, env: authEnv() });
    const ctx = await auth.$context;

    await ctx.internalAdapter.createUser({
      email: 'chef@example.com',
      name: 'Chef',
      emailVerified: true,
    });
    await ctx.internalAdapter.createUser({
      email: 'lena@example.com',
      name: 'Lena',
      emailVerified: true,
    });

    const { rows } = await db.pool.query<{ group_name: string; email: string }>(
      `SELECT group_name, email FROM group_members ORDER BY email`,
    );
    expect(rows).toEqual([{ group_name: BOOTSTRAP_GROUP, email: 'chef@example.com' }]);
  });

  it('weist auch die Anmeldung eines bestehenden Kontos ab, wenn die Domain gestrichen wurde', async () => {
    // Konto entsteht, solange die Domain erlaubt ist.
    const offen = createAuth({ pool: db.pool, env: authEnv() });
    const user = await (
      await offen.$context
    ).internalAdapter.createUser({
      email: 'lena@example.com',
      name: 'Lena',
      emailVerified: true,
    });

    // Danach wird die Domain gestrichen. Das Konto bleibt, der Login nicht:
    // die Schranke haengt auch am Anlegen der Session, nicht nur des Kontos.
    const zu = createAuth({ pool: db.pool, env: authEnv({ allowedEmailDomains: [] }) });
    await expect(
      (await zu.$context).internalAdapter.createSession(user.id, undefined),
    ).rejects.toThrow(/AUTH_ALLOWED_EMAIL_DOMAINS/);

    const { rows } = await db.pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM control_plane."session"`,
    );
    expect(rows[0]?.count).toBe('0');
  });

  it('traegt eine spaeter ergaenzte Bootstrap-Adresse beim naechsten Login ein', async () => {
    const ohne = createAuth({ pool: db.pool, env: authEnv({ bootstrapAdmins: [] }) });
    const user = await (
      await ohne.$context
    ).internalAdapter.createUser({
      email: 'chef@example.com',
      name: 'Chef',
      emailVerified: true,
    });
    expect((await db.pool.query(`SELECT 1 FROM group_members`)).rowCount).toBe(0);

    // AUTH_BOOTSTRAP_ADMINS wird ergaenzt, der Nutzer meldet sich erneut an.
    const mit = createAuth({ pool: db.pool, env: authEnv() });
    await (await mit.$context).internalAdapter.createSession(user.id, undefined);

    const { rows } = await db.pool.query<{ group_name: string; email: string }>(
      `SELECT group_name, email FROM group_members`,
    );
    expect(rows).toEqual([{ group_name: BOOTSTRAP_GROUP, email: 'chef@example.com' }]);
  });

  it('liest die Gruppen bei jedem Aufruf neu — eine Aenderung wirkt sofort', async () => {
    const auth = createAuth({ pool: db.pool, env: authEnv() });
    const ctx = await auth.$context;
    const groups = createGroupMembershipRepository(db.pool);

    const user = await ctx.internalAdapter.createUser({
      email: 'lena@example.com',
      name: 'Lena',
      emailVerified: true,
    });

    const reader = createBetterAuthSessionReader({
      // Eine feste Session, damit dieser Test die Gruppen prueft und nicht den
      // OAuth-Rueckweg (der braucht Google).
      auth: {
        api: {
          getSession: () => Promise.resolve({ user: { id: user.id, email: user.email } }),
        },
      },
      groups,
    });
    const request = new Request('https://control-plane.example.com/grants', {
      headers: { cookie: 'better-auth.session_token=egal' },
    });

    expect(await reader.read(request)).toEqual({
      userId: user.id,
      email: 'lena@example.com',
      groups: [],
    });

    await db.pool.query(`INSERT INTO groups (name) VALUES ('team')`);
    await groups.ensureMembership('team', 'Lena@Example.com', 'user:u-chef');
    // Zweimal dasselbe ist keine Aenderung.
    await groups.ensureMembership('team', 'lena@example.com', 'user:u-chef');

    expect((await reader.read(request))?.groups).toEqual(['team']);

    await groups.removeMembership('team', 'lena@example.com');
    expect((await reader.read(request))?.groups).toEqual([]);
  });

  it('kennt platform-admins als Gruppe und haengt den Wildcard-Grant aus 0006 daran', async () => {
    const { rows } = await db.pool.query<{ name: string }>(
      `SELECT g.name FROM groups g
         JOIN grants gr ON gr.subject_kind = 'group' AND gr.subject_id = g.name
        WHERE gr.revoked_at IS NULL AND gr.resource_id = '*'
        GROUP BY g.name`,
    );
    expect(rows.map((row) => row.name)).toEqual([BOOTSTRAP_GROUP]);
  });

  it('nimmt keine Mitgliedschaft mit Grossbuchstaben oder ohne @ an', async () => {
    await expect(
      db.pool.query(
        `INSERT INTO group_members (group_name, email, added_by)
         VALUES ('platform-admins', 'Chef@Example.com', 'test')`,
      ),
    ).rejects.toThrow(/group_members_email_check|violates check constraint/);

    await expect(
      db.pool.query(
        `INSERT INTO group_members (group_name, email, added_by)
         VALUES ('platform-admins', 'ohne-at-zeichen', 'test')`,
      ),
    ).rejects.toThrow(/violates check constraint/);

    // Und keine Mitgliedschaft in einer Gruppe, die es nicht gibt.
    await expect(
      db.pool.query(
        `INSERT INTO group_members (group_name, email, added_by)
         VALUES ('gibt-es-nicht', 'chef@example.com', 'test')`,
      ),
    ).rejects.toThrow(/foreign key constraint/);
  });
});

describe.skipIf(reachable)('ohne Test-Postgres', () => {
  it('uebersprungen: docker compose -f apps/control-plane/docker-compose.yml up -d', () => {
    expect(reachable).toBe(false);
  });
});
