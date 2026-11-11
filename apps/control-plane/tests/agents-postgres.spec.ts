/**
 * Agent-Identitaeten gegen echtes Postgres.
 *
 * Was nur die Datenbank beantworten kann:
 *
 *  1. Migration 0014 und 0015 laufen durch, in dieser Reihenfolge: Der
 *     Enum-Wert `agent` entsteht in 0014, benutzt wird er in 0015 (dieselbe
 *     Falle wie bei 0011/0012).
 *  2. `platform-admins` hat danach `read` und `write` auf `agent:*`. Ohne
 *     diese zwei Zeilen koennte niemand den ersten Agent anlegen.
 *  3. Das Audit-Log nimmt `agent` als Ressourcenart an — es benutzt denselben
 *     Enum, und ein abgelehnter Eintrag waere ein verlorener.
 *  4. Sperren wirkt im Lesepfad der Anmeldung und laesst die Zeile stehen.
 *
 * Ohne erreichbare Instanz wird uebersprungen (siehe `pg-helpers.ts`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashAgentSecret } from '../src/domain';
import { createAgentIdentityRepository, createAuditRepository } from '../src/infra/pg';
import { freshDatabase, postgresReachable, type PgFixture } from './pg-helpers';
import type { AgentIdentityRepository } from '../src/domain/ports';

const reachable = await postgresReachable();

describe.skipIf(!reachable)('Agent-Identitaeten in Postgres', () => {
  let db: PgFixture;
  let agents: AgentIdentityRepository;

  beforeEach(async () => {
    db = await freshDatabase();
    agents = createAgentIdentityRepository(db.pool);
  });

  afterEach(async () => {
    await db.close();
  });

  it('gibt platform-admins nach den Migrationen agent:*', async () => {
    const { rows } = await db.pool.query<{ verb: string }>(
      `SELECT verb FROM grants
       WHERE subject_kind = 'group' AND subject_id = 'platform-admins'
         AND resource_kind = 'agent' AND resource_id = '*' AND revoked_at IS NULL
       ORDER BY verb`,
    );
    expect(rows.map((row) => row.verb)).toEqual(['read', 'write']);
  });

  it('nimmt agent als Ressourcenart im Audit-Log an', async () => {
    const audit = createAuditRepository(db.pool);
    await audit.append({
      actor: { kind: 'user', id: 'u-admin' },
      action: 'create_agent',
      resource: { kind: 'agent', id: 'planer' },
      outcome: 'denied',
      reason: 'test',
      detail: {},
      correlationId: null,
      occurredAt: new Date(),
    });
    const { rows } = await db.pool.query<{ resource_kind: string }>(
      `SELECT resource_kind::text FROM audit_log WHERE action = 'create_agent'`,
    );
    expect(rows.map((row) => row.resource_kind)).toEqual(['agent']);
  });

  it('sperrt eine Identitaet: Anmeldung findet sie nicht mehr, die Zeile bleibt', async () => {
    const created = await agents.create({
      name: 'planer',
      displayName: 'Planer',
      ownerUserId: 'user:u-admin',
      oauthClientId: 'oac_test',
      oauthClientSecretHash: hashAgentSecret('geheim'),
    });
    expect(created.disabledAt).toBeNull();
    expect(await agents.secretHashOf('oac_test')).toBe(hashAgentSecret('geheim'));

    const at = new Date('2026-01-02T03:04:05Z');
    const disabled = await agents.disable('planer', at);
    expect(disabled.disabledAt).toEqual(at);

    expect(await agents.findByClientId('oac_test')).toBeNull();
    expect(await agents.secretHashOf('oac_test')).toBeNull();
    expect((await agents.findByName('planer'))?.disabledAt).toEqual(at);

    // Zweimal sperren verschiebt den Zeitpunkt nicht.
    const again = await agents.disable('planer', new Date('2027-01-01T00:00:00Z'));
    expect(again.disabledAt).toEqual(at);

    // Der Name bleibt vergeben: UNIQUE in der Tabelle, nicht nur in TypeScript.
    await expect(
      agents.create({
        name: 'planer',
        displayName: 'Planer zwei',
        ownerUserId: 'user:u-admin',
        oauthClientId: 'oac_test2',
        oauthClientSecretHash: hashAgentSecret('anders'),
      }),
    ).rejects.toThrow();
  });
});
