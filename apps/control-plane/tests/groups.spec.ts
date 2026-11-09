/**
 * Gruppenpflege: die riskanten Pfade zuerst (CLAUDE.md, Konventionen).
 *
 * Riskant ist hier nicht „legt eine Gruppe an", sondern:
 *
 *  1. Ohne Freigabe geht nichts — auch nicht lesen, auch nicht fuer jemanden,
 *     der eine andere Gruppe pflegen darf.
 *  2. Anlegen braucht die Wildcard, nicht den eigenen Namen. Sonst koennte
 *     sich jeder, der eine Gruppe pflegt, weitere anlegen.
 *  3. Eine Mitgliedschaft wirkt auf die Freigaben der Gruppe, und ihr Entzug
 *     wirkt **sofort** — das ist DoD 3 fuer Gruppen.
 *  4. Jeder Aufruf steht im Audit-Log, der abgelehnte auch (DoD 6).
 */

import { describe, expect, it } from 'vitest';
import {
  addGroupMember,
  can,
  createApp,
  createGroup,
  grant,
  listGroupMembers,
  listGroups,
  removeGroupMember,
} from '../src/domain';
import { NotFoundError, PermissionDeniedError, ValidationError } from '../src/domain/errors';
import { admin, createHarness, manifest, seedBootstrapGrants } from './helpers';
import type { Actor } from '../src/domain/types';
import type { Harness } from './helpers';

/** Eine Teamleitung: darf genau eine Gruppe pflegen, sonst nichts. */
const teamlead: Actor = { kind: 'user', id: 'u-mira', groups: [] };
/** Jemand ohne jede Freigabe. */
const fremd: Actor = { kind: 'user', id: 'u-niemand', groups: [] };

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  return harness;
}

/** Eine Gruppe plus `write` darauf fuer die Teamleitung. */
async function marketingMitLeitung(harness: Harness): Promise<void> {
  await createGroup(harness.ctx, { actor: admin, name: 'marketing', description: 'Marketing' });
  for (const verb of ['read', 'write'] as const) {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: teamlead.id },
      verb,
      resource: { kind: 'group', id: 'marketing' },
    });
  }
}

describe('Gruppen: Default-Deny', () => {
  it('laesst niemanden ohne Freigabe Mitglieder sehen oder pflegen', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);

    await expect(
      listGroupMembers(harness.ctx, { actor: fremd, group: 'marketing' }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
      addGroupMember(harness.ctx, { actor: fremd, group: 'marketing', email: 'x@example.com' }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
      removeGroupMember(harness.ctx, { actor: fremd, group: 'marketing', email: 'x@example.com' }),
    ).rejects.toThrow(PermissionDeniedError);

    // Und die Liste ist leer, nicht gefuellt-aber-gefiltert-beim-Anzeigen.
    expect(await listGroups(harness.ctx, { actor: fremd })).toHaveLength(0);
  });

  it('zeigt jedem nur die Gruppen, die er lesen darf', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);
    await createGroup(harness.ctx, { actor: admin, name: 'finanzen', description: '' });

    const fuerLeitung = await listGroups(harness.ctx, { actor: teamlead });
    expect(fuerLeitung.map((group) => group.name)).toEqual(['marketing']);

    // Der Administrator hat `group:*` und sieht alles, auch `platform-admins`.
    const fuerAdmin = await listGroups(harness.ctx, { actor: admin });
    expect(fuerAdmin.map((group) => group.name)).toEqual([
      'finanzen',
      'marketing',
      'platform-admins',
    ]);
  });

  it('laesst eine Gruppe nur mit der Wildcard anlegen, nicht mit write auf eine einzelne', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);

    // Die Teamleitung darf `marketing` pflegen — aber keine zweite Gruppe
    // aufmachen. Sonst waere die Wildcard ueber einen Umweg erreichbar.
    await expect(
      createGroup(harness.ctx, { actor: teamlead, name: 'marketing-intern' }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('weist eine Gruppe ab, die es nicht gibt — mit 404, nicht mit 403', async () => {
    const harness = await setup();
    // Die Unterscheidung zaehlt: Ein 403 auf eine nicht existierende Gruppe
    // waere eine Aussage darueber, dass sie existiert.
    await expect(
      addGroupMember(harness.ctx, { actor: admin, group: 'gibtsnicht', email: 'a@example.com' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('Gruppen: Mitgliedschaft wirkt und ihr Entzug wirkt sofort', () => {
  it('oeffnet eine App ueber die Gruppe und schliesst sie beim Entzug wieder', async () => {
    const harness = await setup();
    const { ctx } = harness;
    await marketingMitLeitung(harness);

    const app = await createApp(ctx, {
      actor: admin,
      name: 'projektliste',
      manifest: manifest('projektliste'),
    });
    await grant(ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'marketing' },
      verb: 'read',
      resource: { kind: 'app', id: app.id },
    });

    // Der Aufrufer, wie ihn die Forward-Auth baut: Gruppen aus der Datenbank,
    // nicht aus einem Token.
    const mitgliedsAktor = async (email: string, id: string): Promise<Actor> => ({
      kind: 'user',
      id,
      groups: await ctx.groups.groupsFor(email),
    });

    // 1. blockiert
    expect(
      await can(ctx, await mitgliedsAktor('lena@example.com', 'u-lena'), 'read', {
        kind: 'app',
        id: app.id,
      }),
    ).toBe(false);

    // 2. Mitgliedschaft — von der Teamleitung, nicht vom Administrator
    const aufgenommen = await addGroupMember(ctx, {
      actor: teamlead,
      group: 'marketing',
      email: 'Lena@Example.com',
    });
    expect(aufgenommen).toEqual({ group: 'marketing', email: 'lena@example.com', added: true });

    // 3. offen
    expect(
      await can(ctx, await mitgliedsAktor('lena@example.com', 'u-lena'), 'read', {
        kind: 'app',
        id: app.id,
      }),
    ).toBe(true);

    // 4. Entzug
    const entfernt = await removeGroupMember(ctx, {
      actor: teamlead,
      group: 'marketing',
      email: 'lena@example.com',
    });
    expect(entfernt.removed).toBe(true);

    // 5. wieder blockiert, ohne Wartezeit und ohne neuen Login
    expect(
      await can(ctx, await mitgliedsAktor('lena@example.com', 'u-lena'), 'read', {
        kind: 'app',
        id: app.id,
      }),
    ).toBe(false);
  });

  it('ist idempotent: zweimal aufnehmen aendert nichts, zweimal entfernen auch nicht', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);

    expect(
      (await addGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'a@b.de' }))
        .added,
    ).toBe(true);
    expect(
      (await addGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'a@b.de' }))
        .added,
    ).toBe(false);
    expect(await listGroupMembers(harness.ctx, { actor: admin, group: 'marketing' })).toHaveLength(
      1,
    );

    expect(
      (await removeGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'a@b.de' }))
        .removed,
    ).toBe(true);
    expect(
      (await removeGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'a@b.de' }))
        .removed,
    ).toBe(false);
  });

  it('speichert E-Mails kleingeschrieben — sonst haette dieselbe Person zwei Mitgliedschaften', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);

    await addGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'Lena@B.de' });
    await addGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'LENA@b.de' });

    const members = await listGroupMembers(harness.ctx, { actor: admin, group: 'marketing' });
    expect(members.map((member) => member.email)).toEqual(['lena@b.de']);
  });

  it('weist eine Adresse mit Komma ab — sie wuerde den X-Auth-Groups-Header zerlegen', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);

    await expect(
      addGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'a,b@example.com' }),
    ).rejects.toThrow(ValidationError);
  });

  it('weist einen Gruppennamen ab, der nicht in den Header passt', async () => {
    const harness = await setup();
    for (const name of ['Marketing', 'mit,komma', 'zu', '-vorn', 'hinten-']) {
      await expect(createGroup(harness.ctx, { actor: admin, name })).rejects.toThrow(
        ValidationError,
      );
    }
  });
});

describe('Gruppen: Audit-Log', () => {
  it('schreibt jeden Aufruf mit, auch den abgelehnten', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);

    await addGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'a@b.de' });
    await expect(
      addGroupMember(harness.ctx, { actor: fremd, group: 'marketing', email: 'c@d.de' }),
    ).rejects.toThrow(PermissionDeniedError);

    const relevant = harness.store.auditEntries.filter(
      (entry) => entry.action === 'grant_group_member',
    );
    expect(relevant).toHaveLength(2);
    expect(relevant[0]?.outcome).toBe('allowed');
    expect(relevant[0]?.resource).toEqual({ kind: 'group', id: 'marketing' });
    expect(relevant[1]?.outcome).toBe('denied');
    // Die abgelehnte Zeile nennt, worum es ging — sonst ist sie als Spur
    // wertlos.
    expect(relevant[1]?.detail.email).toBe('c@d.de');
  });

  it('protokolliert eine unbrauchbare Adresse als Fehler, nicht als Ablehnung', async () => {
    const harness = await setup();
    await marketingMitLeitung(harness);

    await expect(
      addGroupMember(harness.ctx, { actor: admin, group: 'marketing', email: 'kein-at-zeichen' }),
    ).rejects.toThrow(ValidationError);

    const letzter = harness.store.auditEntries.at(-1);
    expect(letzter?.action).toBe('grant_group_member');
    expect(letzter?.outcome).toBe('error');
  });
});
