/**
 * Settings fuer die Person (ADR 0017): `describeActor` und `GET /api/me`.
 * Riskant ist, dass jemand mehr sieht, als ihm gehoert — fremde Freigaben,
 * Apps ohne Freigabe — oder dass die Route ohne Session antwortet.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createApp,
  describeActor,
  grant,
  revoke,
  type ActorDescription,
  type Actor,
  type DomainContext,
} from '../src/domain';
import { GET } from '../src/app/api/me/route';
import { resetSessionReader, setSessionReader } from '../src/lib/actor';
import { setDomainContext } from '../src/lib/runtime';
import { denyAllSessions } from '../src/lib/session';
import { admin, createHarness, manifest, seedBootstrapGrants, type Harness } from './helpers';

const APPS_DOMAIN = 'apps.example.com';
const lena: Actor = { kind: 'user', id: 'u-lena', groups: ['team'] };
const tom: Actor = { kind: 'user', id: 'u-tom', groups: [] };

async function setup(): Promise<Harness> {
  const harness = createHarness({ appsDomain: APPS_DOMAIN });
  await seedBootstrapGrants(harness);
  await createApp(harness.ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
  await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: manifest('wiki') });
  return harness;
}

describe('describeActor', () => {
  it('zeigt einem Nutzer ohne Freigabe nichts (Default-Deny)', async () => {
    const harness = await setup();
    const me = await describeActor(harness.ctx, tom, { email: 'tom@example.com' });
    expect(me).toEqual({
      kind: 'user',
      id: 'u-tom',
      email: 'tom@example.com',
      groups: [],
      isAdmin: false,
      canCreateApps: false,
      apps: [],
      grants: [],
      agent: null,
    });
  });

  it('zeigt eigene Freigaben und Apps, keine fremden', async () => {
    const harness = await setup();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    // Eine fremde Freigabe, die nicht auftauchen darf.
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-tom' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    const me = await describeActor(harness.ctx, lena, { email: 'lena@example.com' });
    expect(me.groups).toEqual(['team']);
    expect(me.apps).toEqual([
      { name: 'wiki', title: 'wiki', category: 'test', href: `https://${APPS_DOMAIN}/wiki` },
    ]);
    expect(me.grants.map((g) => `${g.subject.id} ${g.verb} ${g.resource.id}`)).toEqual([
      'u-lena read wiki',
    ]);
    expect(me.isAdmin).toBe(false);
  });

  it('zeigt eine Freigabe ueber die eigene Gruppe, mit der Gruppe als Herkunft', async () => {
    const harness = await setup();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    const me = await describeActor(harness.ctx, lena);
    expect(me.apps.map((a) => a.name)).toEqual(['crm']);
    expect(me.grants).toHaveLength(1);
    expect(me.grants[0]).toMatchObject({
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
      via: { kind: 'group', group: 'team' },
    });
    expect(me.email).toBeNull();
  });

  it('zeigt keine Freigabe einer fremden Gruppe und keine eines anderen Nutzers', async () => {
    const harness = await setup();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'sales' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-tom' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    // Ein Agent mit demselben Namen wie die Person ist ein anderes Subjekt.
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'agent', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    const me = await describeActor(harness.ctx, lena);
    expect(me.grants).toEqual([]);
    expect(me.apps).toEqual([]);
  });

  it('verschluckt nichts: dasselbe Recht direkt und ueber Gruppen steht je einmal da', async () => {
    const harness = await setup();
    const both: Actor = { kind: 'user', id: 'u-lena', groups: ['team', 'sales'] };
    for (const subject of [
      { kind: 'user', id: 'u-lena' },
      { kind: 'group', id: 'team' },
      { kind: 'group', id: 'sales' },
    ] as const) {
      await grant(harness.ctx, {
        actor: admin,
        subject,
        verb: 'read',
        resource: { kind: 'app', id: 'wiki' },
      });
    }
    const me = await describeActor(harness.ctx, both);
    expect(me.grants.map((g) => g.via)).toEqual([
      { kind: 'direct' },
      { kind: 'group', group: 'team' },
      { kind: 'group', group: 'sales' },
    ]);
    expect(new Set(me.grants.map((g) => g.id)).size).toBe(3);
    // Die App selbst steht trotzdem nur einmal in der Liste.
    expect(me.apps.map((a) => a.name)).toEqual(['wiki']);
  });

  it('zeigt eine Gruppe nur einmal, auch wenn sie doppelt in der Session steht', async () => {
    const harness = await setup();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    const twice: Actor = { kind: 'user', id: 'u-lena', groups: ['team', 'team'] };
    const me = await describeActor(harness.ctx, twice);
    expect(me.grants).toHaveLength(1);
  });

  it('zeigt widerrufene Freigaben nicht als Zugang, weder direkt noch ueber die Gruppe', async () => {
    const harness = await setup();
    const direct = await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    const viaGroup = await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    await revoke(harness.ctx, { actor: admin, grantId: direct.id });
    await revoke(harness.ctx, { actor: admin, grantId: viaGroup.id });
    const me = await describeActor(harness.ctx, lena);
    expect(me.grants).toEqual([]);
  });

  it('meldet Mitglieder von platform-admins als Admin mit allen Apps', async () => {
    const harness = await setup();
    const me = await describeActor(harness.ctx, admin, { email: 'admin@example.com' });
    expect(me.isAdmin).toBe(true);
    expect(me.canCreateApps).toBe(true);
    expect(me.apps.map((a) => a.name).sort()).toEqual(['crm', 'wiki']);
  });

  it('gibt einem Agent nie eine Adresse, auch wenn eine mitkommt', async () => {
    const harness = await setup();
    const me = await describeActor(
      harness.ctx,
      { kind: 'agent', id: 'nobody' },
      { email: 'spoof@example.com' },
    );
    expect(me.email).toBeNull();
    expect(me.agent).toBeNull();
  });

  it('schreibt genau einen Audit-Eintrag pro Aufruf, als whoami und nicht als list_grants', async () => {
    const harness = await setup();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    const before = harness.store.auditEntries.length;
    await describeActor(harness.ctx, lena, { correlationId: 'req-1' });
    const added = harness.store.auditEntries.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      actor: { kind: 'user', id: 'u-lena' },
      action: 'whoami',
      resource: null,
      outcome: 'allowed',
      correlationId: 'req-1',
      detail: { grants: 1, direct: 0, viaGroup: 1, apps: 1 },
    });
    expect(added.some((e) => e.action === 'list_grants')).toBe(false);
  });

  it('protokolliert einen Fehler beim Lesen als whoami mit outcome error und wirft weiter', async () => {
    const harness = await setup();
    const broken: DomainContext = {
      ...harness.ctx,
      grants: {
        ...harness.ctx.grants,
        listForSubjects: () => Promise.reject(new Error('database unavailable')),
      },
    };
    const before = harness.store.auditEntries.length;
    await expect(describeActor(broken, lena)).rejects.toThrow('database unavailable');
    const added = harness.store.auditEntries.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      action: 'whoami',
      outcome: 'error',
      reason: 'database unavailable',
    });
  });
});

describe('GET /api/me', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await setup();
    setDomainContext(harness.ctx);
    setSessionReader(denyAllSessions);
  });

  afterEach(() => {
    setDomainContext(undefined);
    resetSessionReader();
  });

  it('sperrt ohne Session mit 403', async () => {
    const response = await GET(new Request('https://control-plane.example.com/api/me'));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'permission_denied' });
  });

  it('liefert die Person aus der Session, mit Adresse und Gruppen', async () => {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'user', id: 'u-lena' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    setSessionReader({
      read: () =>
        Promise.resolve({ userId: 'u-lena', email: 'lena@example.com', groups: ['team'] }),
    });
    const response = await GET(new Request('https://control-plane.example.com/api/me'));
    expect(response.status).toBe(200);
    const { me } = (await response.json()) as { me: ActorDescription };
    expect(me).toMatchObject({
      kind: 'user',
      id: 'u-lena',
      email: 'lena@example.com',
      groups: ['team'],
      isAdmin: false,
      canCreateApps: false,
    });
    expect(me.apps.map((a) => a.name)).toEqual(['wiki']);
    expect(me.grants).toHaveLength(1);
    expect(me.grants[0]?.via).toEqual({ kind: 'direct' });
  });

  it('liefert Freigaben ueber die Gruppen der Session mit, fremde nicht', async () => {
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'sales' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    setSessionReader({
      read: () =>
        Promise.resolve({ userId: 'u-lena', email: 'lena@example.com', groups: ['team'] }),
    });
    const response = await GET(new Request('https://control-plane.example.com/api/me'));
    expect(response.status).toBe(200);
    const { me } = (await response.json()) as { me: ActorDescription };
    expect(me.grants.map((g) => `${g.verb} ${g.resource.kind}:${g.resource.id}`)).toEqual([
      'read app:crm',
    ]);
    expect(me.grants[0]?.via).toEqual({ kind: 'group', group: 'team' });
    expect(me.apps.map((a) => a.name)).toEqual(['crm']);
  });
});
