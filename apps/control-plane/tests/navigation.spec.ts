/**
 * Die Navigation der gemeinsamen Leiste (ADR 0017), ohne HTTP. Riskant ist
 * eine App in der Liste, die die Person nicht lesen darf, und ein Header, der
 * so gross wird, dass der Aufruf der App scheitert.
 */

import { decodeNav, encodeNav, type PlatformNav } from '@openapps/sdk';
import { describe, expect, it } from 'vitest';
import {
  createApp,
  fitNav,
  grant,
  NAV_HEADER_BUDGET,
  platformNavFor,
  visibleAppsFor,
  type Actor,
} from '../src/domain';
import { admin, createHarness, manifest, seedBootstrapGrants } from './helpers';

const lena: Actor = { kind: 'user', id: 'u-lena', groups: ['team'] };

describe('visibleAppsFor', () => {
  it('zeigt ohne Freigabe nichts (Default-Deny)', async () => {
    const harness = createHarness({ appsDomain: 'apps.example.com' });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    expect(await visibleAppsFor(harness.ctx, lena)).toEqual([]);
  });

  it('laesst Apps ohne Domain weg, auch mit Freigabe', async () => {
    const harness = createHarness();
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    expect(await visibleAppsFor(harness.ctx, admin)).toEqual([]);
  });

  it('nimmt eine widerrufbare Freigabe ueber die Gruppe', async () => {
    const harness = createHarness({ appsDomain: 'apps.example.com' });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, { actor: admin, name: 'crm', manifest: manifest('crm') });
    await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: manifest('wiki') });
    await grant(harness.ctx, {
      actor: admin,
      subject: { kind: 'group', id: 'team' },
      verb: 'read',
      resource: { kind: 'app', id: 'wiki' },
    });
    const nav = await platformNavFor(harness.ctx, lena, {
      controlPlaneHost: 'admin.example.com',
    });
    expect(nav).toEqual({
      v: 1,
      platformUrl: 'https://admin.example.com',
      apps: [
        { name: 'wiki', title: 'wiki', category: 'test', href: 'https://apps.example.com/wiki' },
      ],
      canCreateApps: false,
      isAdmin: false,
    });
    // Was die Control Plane baut, nimmt das SDK an.
    expect(decodeNav(encodeNav(nav))).toEqual(nav);
  });
});

describe('fitNav', () => {
  const many: PlatformNav = {
    v: 1,
    platformUrl: 'https://admin.example.com',
    apps: Array.from({ length: 200 }, (_, i) => ({
      name: `app-${String(i).padStart(3, '0')}`,
      title: `App number ${String(i)} with a fairly long display name`,
      category: 'Category',
      href: `https://apps.example.com/app-${String(i).padStart(3, '0')}`,
    })),
    canCreateApps: false,
    isAdmin: false,
  };

  it('laesst eine kleine Navigation unveraendert', () => {
    const small = { ...many, apps: many.apps.slice(0, 3) };
    expect(fitNav(small)).toBe(small);
  });

  it('kuerzt auf das Budget und behaelt die aufgerufene App', () => {
    const fitted = fitNav(many, NAV_HEADER_BUDGET, 'app-199');
    expect(fitted).not.toBeNull();
    expect(encodeNav(fitted as PlatformNav).length).toBeLessThanOrEqual(NAV_HEADER_BUDGET);
    expect(fitted?.apps[0]?.name).toBe('app-199');
    expect(fitted?.apps.length).toBeLessThan(200);
    expect(fitted?.apps.length).toBeGreaterThan(10);
  });
});
