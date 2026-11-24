/**
 * Nachweis zu DoD 3: blockiert → Freigabe → lesbar → Widerruf → blockiert.
 *
 * Der Test laeuft gegen die Domaenenlogik mit Speicher im Prozess. Er belegt
 * damit die Haelfte, die wir selbst bauen: das Rechtemodell und die
 * Durchsetzung bei jedem Aufruf. Die andere Haelfte — dass Postgres einer
 * fremden Rolle den SELECT wirklich verweigert — braucht eine echte Datenbank
 * und steht unten als `it.todo`.
 */

import { describe, expect, it } from 'vitest';
import { can, createApp, grant, listApps, listGrants, revoke } from '../src/domain';
import { PermissionDeniedError } from '../src/domain/errors';
import { admin, createHarness, manifest, seedBootstrapGrants } from './helpers';
import type { Actor } from '../src/domain/types';

const teamMember: Actor = { kind: 'user', id: 'u-lena', groups: ['team'] };

describe('Rechtemodell: Mensch auf App', () => {
  it('sperrt eine App, bis eine Freigabe sie oeffnet, und sperrt sie nach dem Widerruf wieder', async () => {
    const harness = await setup();
    const { ctx } = harness;

    const app = await createApp(ctx, {
      actor: admin,
      name: 'projektliste',
      manifest: manifest('projektliste'),
    });

    // 1. blockiert
    expect(await can(ctx, teamMember, 'read', { kind: 'app', id: app.id })).toBe(false);
    expect(await listApps(ctx, { actor: teamMember })).toHaveLength(0);

    // 2. Freigabe an die Gruppe
    const granted = await grant(ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: app.id },
    });

    // 3. lesbar
    expect(await can(ctx, teamMember, 'read', { kind: 'app', id: app.id })).toBe(true);
    expect(await listApps(ctx, { actor: teamMember })).toHaveLength(1);

    // 4. Widerruf
    await revoke(ctx, { actor: admin, grantId: granted.id });

    // 5. wieder blockiert — ohne Wartezeit, weil nichts gecacht wird
    expect(await can(ctx, teamMember, 'read', { kind: 'app', id: app.id })).toBe(false);
    expect(await listApps(ctx, { actor: teamMember })).toHaveLength(0);
  });

  it('gibt ein Tool mit Punkt im Namen frei, aber nur dieses (ADR 0011)', async () => {
    const harness = await setup();
    const { ctx } = harness;
    await createApp(ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    const agent: Actor = { kind: 'agent', id: 'vertrieb' };

    await grant(ctx, {
      actor: admin,
      subject: agent,
      verb: 'execute',
      resource: { kind: 'tool', id: 'crm.contacts.list' },
    });

    expect(await can(ctx, agent, 'execute', { kind: 'tool', id: 'crm.contacts.list' })).toBe(true);
    expect(await can(ctx, agent, 'execute', { kind: 'tool', id: 'crm.contacts.create' })).toBe(
      false,
    );
  });

  it('weist Ids ab, die keine App und kein Objekt nennen', async () => {
    const harness = await setup();
    const { ctx } = harness;
    await createApp(ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    for (const id of ['crm', 'crm.', '.contacts', 'crm..list', 'crm.contacts.', 'CRM.x']) {
      await expect(
        grant(ctx, {
          actor: admin,
          subject: { kind: 'agent', id: 'vertrieb' },
          verb: 'execute',
          resource: { kind: 'tool', id },
        }),
      ).rejects.toThrow();
    }
    // Tabellen bleiben ohne Punkt im Namen.
    await expect(
      grant(ctx, {
        actor: admin,
        subject: { kind: 'app', id: 'crm' },
        verb: 'read',
        resource: { kind: 'table', id: 'crm.a.b' },
      }),
    ).rejects.toThrow();
  });

  it('oeffnet mit `read` nicht auch `write`', async () => {
    const harness = await setup();
    const { ctx } = harness;
    const app = await createApp(ctx, {
      actor: admin,
      name: 'kanban',
      manifest: manifest('kanban'),
    });

    await grant(ctx, {
      actor: admin,
      subject: { kind: 'user', id: teamMember.id },
      verb: 'read',
      resource: { kind: 'app', id: app.id },
    });

    expect(await can(ctx, teamMember, 'read', { kind: 'app', id: app.id })).toBe(true);
    expect(await can(ctx, teamMember, 'write', { kind: 'app', id: app.id })).toBe(false);
  });

  it('laesst niemanden ohne eigenes Recht freigeben', async () => {
    const harness = await setup();
    const { ctx } = harness;
    const app = await createApp(ctx, {
      actor: admin,
      name: 'crm',
      manifest: manifest('crm'),
    });

    await expect(
      grant(ctx, {
        actor: teamMember,
        subject: { kind: 'user', id: 'u-fremd' },
        verb: 'read',
        resource: { kind: 'app', id: app.id },
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});

describe('Rechtemodell: App auf Tabelle einer anderen App', () => {
  it('setzt die Freigabe zwischen Apps auch in Postgres und nimmt sie beim Widerruf zurueck', async () => {
    const harness = await setup();
    const { ctx, provisioner } = harness;

    await createApp(ctx, {
      actor: admin,
      name: 'projects',
      manifest: manifest('projects'),
    });
    await createApp(ctx, {
      actor: admin,
      name: 'crm',
      manifest: manifest('crm'),
    });

    // Jede App hat eigenes Schema und eigene Rolle.
    expect(provisioner.provisioned).toEqual(['app_projects@app_projects', 'app_crm@app_crm']);

    const resource = { kind: 'view' as const, id: 'projects.v_active' };

    // 1. blockiert: weder im Rechtemodell noch in Postgres
    expect(await can(ctx, { kind: 'app', id: 'crm' }, 'read', resource)).toBe(false);
    expect(provisioner.selectGrants.has('app_crm@app_projects.v_active')).toBe(false);

    // 2. Freigabe
    const granted = await grant(ctx, {
      actor: admin,
      subject: { kind: 'app', id: 'crm' },
      verb: 'read',
      resource,
    });

    // 3. lesbar: Rechtemodell und Postgres-Grant stimmen ueberein
    expect(await can(ctx, { kind: 'app', id: 'crm' }, 'read', resource)).toBe(true);
    expect(provisioner.selectGrants.has('app_crm@app_projects.v_active')).toBe(true);

    // 4. Widerruf
    await revoke(ctx, { actor: admin, grantId: granted.id });

    // 5. wieder blockiert, in beiden
    expect(await can(ctx, { kind: 'app', id: 'crm' }, 'read', resource)).toBe(false);
    expect(provisioner.selectGrants.has('app_crm@app_projects.v_active')).toBe(false);
  });
});

describe('Audit-Log', () => {
  it('protokolliert jeden Aufruf, auch den abgelehnten', async () => {
    const harness = await setup();
    const { ctx, store } = harness;

    await createApp(ctx, {
      actor: admin,
      name: 'notizen',
      manifest: manifest('notizen'),
    });

    await expect(
      createApp(ctx, {
        actor: { kind: 'user', id: 'u-fremd' },
        name: 'heimlich',
        manifest: manifest('heimlich'),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    const entries = store.auditEntries.filter((e) => e.action === 'create_app');
    expect(entries.map((e) => e.outcome)).toEqual(['allowed', 'denied']);
    expect(entries[1]?.reason).toContain('darf nicht write');
  });

  it('protokolliert auch einen Agenten, der fremde Freigaben lesen will', async () => {
    const { ctx, store } = await setup();
    await expect(
      listGrants(ctx, { actor: { kind: 'agent', id: 'praktikant' } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    const entry = store.auditEntries.find((e) => e.action === 'list_grants');
    expect(entry?.outcome).toBe('denied');
  });
});

// Die Haelfte dieses Kriteriums, die Postgres belegen muss, steht in
// `grants-postgres.spec.ts` — als echte Tests gegen die Instanz aus
// `docker-compose.yml`, nicht als `it.todo`.

async function setup() {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  return harness;
}
