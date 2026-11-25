/**
 * Settings fuer die Person (ADR 0017): `describeActor` und `GET /api/me`.
 * Riskant ist, dass jemand mehr sieht, als ihm gehoert — fremde Freigaben,
 * Apps ohne Freigabe — oder dass die Route ohne Session antwortet.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, describeActor, grant, type ActorDescription, type Actor } from '../src/domain';
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

  it('nimmt Apps ueber eine Gruppen-Freigabe mit, ohne sie als eigene Freigabe zu zeigen', async () => {
    const harness = await setup();
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'crm' },
    });
    const me = await describeActor(harness.ctx, lena);
    expect(me.apps.map((a) => a.name)).toEqual(['crm']);
    expect(me.grants).toEqual([]);
    expect(me.email).toBeNull();
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

  it('schreibt genau einen Audit-Eintrag pro Aufruf, auf den Aufrufer', async () => {
    const harness = await setup();
    const before = harness.store.auditEntries.length;
    await describeActor(harness.ctx, lena);
    const added = harness.store.auditEntries.slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ actor: { kind: 'user', id: 'u-lena' }, outcome: 'allowed' });
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
  });
});
