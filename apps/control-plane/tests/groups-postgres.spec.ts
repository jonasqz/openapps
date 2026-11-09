/**
 * Gruppen gegen echtes Postgres.
 *
 * Das ist nicht derselbe Nachweis wie `groups.spec.ts`: Dort laeuft die
 * Domaenenlogik gegen den Speicher im Prozess. Hier wird geprueft, was nur die
 * Datenbank beantworten kann:
 *
 *  1. Migration 0011 und 0012 laufen durch — und in dieser Reihenfolge. Der
 *     neue Enum-Wert entsteht in 0011, benutzt wird er in 0012. Steht beides
 *     in einer Datei, bricht Postgres mit „unsafe use of new value of enum
 *     type" ab; dieser Test ist die Stelle, an der das auffaellt.
 *  2. `platform-admins` hat nach den Migrationen wirklich `read` und `write`
 *     auf `group:*`. Ohne diese zwei Zeilen koennte niemand eine Gruppe
 *     pflegen, auch kein Administrator.
 *  3. Die CHECKs aus Migration 0009 greifen: kleingeschriebene E-Mail, Form
 *     des Gruppennamens, Fremdschluessel auf die Gruppe. Der Speicher im
 *     Prozess bildet sie nach — hier steht, dass er das Richtige nachbildet.
 *
 * Ohne erreichbare Instanz wird uebersprungen (siehe `pg-helpers.ts`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGroupRepository } from '../src/infra/pg';
import { ConflictError } from '../src/domain/errors';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';
import type { GroupRepository } from '../src/domain/ports';

const reachable = await postgresReachable();

describe.skipIf(!reachable)('Gruppen in Postgres', () => {
  let db: PgFixture;
  let groups: GroupRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    groups = createGroupRepository(db.pool);
  });

  afterEach(async () => {
    await db.close();
  });

  it('legt nach den Migrationen platform-admins an und gibt ihr group:*', async () => {
    const admins = await groups.findByName('platform-admins');
    expect(admins).not.toBeNull();
    // Leer: Mitglieder kommen ueber AUTH_BOOTSTRAP_ADMINS beim ersten Login
    // oder spaeter ueber die Control Plane (Migration 0009).
    expect(await groups.listMembers('platform-admins')).toHaveLength(0);

    const { rows } = await db.pool.query<{ verb: string }>(
      `SELECT verb FROM grants
       WHERE subject_kind = 'group' AND subject_id = 'platform-admins'
         AND resource_kind = 'group' AND resource_id = '*' AND revoked_at IS NULL
       ORDER BY verb`,
    );
    expect(rows.map((row) => row.verb)).toEqual(['read', 'write']);
  });

  it('fuehrt eine Gruppe mit Mitgliedern hin und zurueck', async () => {
    await groups.create({ name: 'marketing', description: 'Marketing' });
    await groups.ensureMembership('marketing', 'Lena@Example.com', 'user:u-admin');
    await groups.ensureMembership('marketing', 'tim@example.com', 'user:u-admin');

    const members = await groups.listMembers('marketing');
    expect(members.map((member) => member.email)).toEqual(['lena@example.com', 'tim@example.com']);
    expect(members[0]?.addedBy).toBe('user:u-admin');

    // Der Lesepfad der Forward-Auth: Gruppen zu einer Adresse, ohne Cache.
    expect(await groups.groupsFor('LENA@example.com')).toEqual(['marketing']);

    await groups.removeMembership('marketing', 'lena@example.com');
    expect(await groups.groupsFor('lena@example.com')).toEqual([]);
  });

  it('nimmt dieselbe Mitgliedschaft zweimal ohne Fehler und ohne zweite Zeile', async () => {
    await groups.create({ name: 'marketing', description: '' });
    await groups.ensureMembership('marketing', 'a@b.de', 'user:u-admin');
    await groups.ensureMembership('marketing', 'a@b.de', 'user:u-anders');

    const members = await groups.listMembers('marketing');
    expect(members).toHaveLength(1);
    // Die erste Zuordnung bleibt stehen: `DO NOTHING`, nicht `DO UPDATE`. Wer
    // jemanden aufgenommen hat, ist Teil der Spur.
    expect(members[0]?.addedBy).toBe('user:u-admin');
  });

  it('meldet eine zweite Gruppe gleichen Namens als Konflikt', async () => {
    await groups.create({ name: 'marketing', description: '' });
    await expect(groups.create({ name: 'marketing', description: 'noch mal' })).rejects.toThrow(
      ConflictError,
    );
  });

  it('weist eine Mitgliedschaft in einer Gruppe ab, die es nicht gibt', async () => {
    // Der Fremdschluessel aus Migration 0009. Eine Mitgliedschaft legt keine
    // Gruppe an — das waere ein Nebeneffekt, der eine Entscheidung ersetzt.
    await expect(groups.ensureMembership('gibtsnicht', 'a@b.de', 'user:u-admin')).rejects.toThrow();
  });

  it('laesst die Datenbank selbst keine grossgeschriebene E-Mail und keinen falschen Namen zu', async () => {
    // Nicht ueber das Repository, sondern daneben vorbei: Hier wird der CHECK
    // geprueft, nicht die Normalisierung in TypeScript. Faellt die eine Seite
    // aus, haelt die andere.
    await groups.create({ name: 'marketing', description: '' });
    await expect(
      db.pool.query(`INSERT INTO group_members (group_name, email, added_by) VALUES ($1, $2, $3)`, [
        'marketing',
        'Lena@Example.com',
        'test',
      ]),
    ).rejects.toThrow();

    await expect(db.pool.query(`INSERT INTO groups (name) VALUES ('Marketing')`)).rejects.toThrow();
    await expect(db.pool.query(`INSERT INTO groups (name) VALUES ('mit,komma')`)).rejects.toThrow();
  });
});
