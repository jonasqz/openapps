/**
 * Der Ansehen-Proxy des lokalen Betriebs (ADR 0013). Riskant ist, dass er
 * Identitaet erfindet. Geprueft wird deshalb, dass er nur seine eigene,
 * feste Identitaet signiert, und nie eine, die der Browser mitschickt; dass
 * die App die Signatur wirklich annimmt; und dass er ausserhalb des lokalen
 * Betriebs gar nicht erst startet.
 */

import { getNavigation, getUser, NAV_HEADER, NAV_SIGNATURE_HEADER } from '@openapps/sdk';
import { describe, expect, it } from 'vitest';
import { appAuthSecret, gatewayHost } from '../src/domain';
import {
  ANSICHT_IDENTITY,
  ansichtNav,
  appNameFromPath,
  buildForward,
  indexPage,
  type AnsichtApp,
} from '../src/infra/lokal-ansehen';

const MASTER = 'm'.repeat(48);

const app = (name: string, deployed = true): AnsichtApp =>
  ({
    name,
    displayName: name.toUpperCase(),
    primaryDomain: deployed ? 'apps.local.test' : null,
    authSecretGeneration: 1,
    manifest: { env: [] },
  }) as unknown as AnsichtApp;

describe('lokal-ansehen', () => {
  it('signiert als fester lokaler Nutzer, und die App nimmt die Signatur an', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const forward = buildForward({
      app: app('crm'),
      path: '/crm/deals',
      incoming: {},
      masterSecret: MASTER,
      now,
    });

    const user = getUser(forward.headers, {
      secret: appAuthSecret({ masterSecret: MASTER, appId: 'crm', generation: 1 }),
      appId: 'crm',
      appHost: gatewayHost('apps.local.test'),
      now: () => now.getTime(),
    });
    expect(user.id).toBe(ANSICHT_IDENTITY.userId);
    expect(user.email).toBe(ANSICHT_IDENTITY.email);
    expect(forward.url).toBe('http://openapps-crm:3000/crm/deals');
  });

  it('verwirft Identitaet, Host und Cookies aus dem Browser', () => {
    const forward = buildForward({
      app: app('crm'),
      path: '/crm',
      incoming: {
        'X-Auth-User-Id': 'admin',
        'x-auth-signature': 'gefaelscht',
        cookie: 'session=abc',
        host: 'boese.test',
        'x-forwarded-host': 'boese.test',
        accept: 'text/html',
      },
      masterSecret: MASTER,
    });
    const lower = Object.fromEntries(
      Object.entries(forward.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(lower['x-auth-user-id']).toBe(ANSICHT_IDENTITY.userId);
    expect(lower['x-auth-signature']).not.toBe('gefaelscht');
    expect(lower.cookie).toBeUndefined();
    expect(lower.host).toBeUndefined();
    expect(lower['x-forwarded-host']).toBe(gatewayHost('apps.local.test'));
    expect(lower.accept).toBe('text/html');
  });

  it('signiert die Navigation der Leiste, und die App nimmt sie an (ADR 0017)', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    const nav = ansichtNav({
      apps: [app('crm'), app('wiki'), app('entwurf', false)],
      platformUrl: 'http://127.0.0.1:8091',
    });
    const forward = buildForward({
      app: app('crm'),
      path: '/crm',
      incoming: {
        // Was der Browser an Navigation mitschickt, faellt weg.
        'X-Auth-Nav': 'eyJ2IjoxfQ',
        'x-auth-nav-signature': 'gefaelscht',
      },
      masterSecret: MASTER,
      now,
      nav,
    });

    const read = getNavigation(forward.headers, {
      secret: appAuthSecret({ masterSecret: MASTER, appId: 'crm', generation: 1 }),
      appId: 'crm',
      appHost: gatewayHost('apps.local.test'),
      now: () => now.getTime(),
    });
    expect(read).toEqual({
      v: 1,
      platformUrl: 'http://127.0.0.1:8091',
      apps: [
        { name: 'crm', title: 'CRM', category: null, href: 'http://127.0.0.1:8090/crm' },
        { name: 'wiki', title: 'WIKI', category: null, href: 'http://127.0.0.1:8090/wiki' },
      ],
      canCreateApps: true,
      isAdmin: false,
    });
  });

  it('setzt beide Nav-Header leer, wenn es keine Navigation gibt', () => {
    const forward = buildForward({
      app: app('crm'),
      path: '/crm',
      incoming: { 'x-auth-nav': 'eyJ2IjoxfQ', 'x-auth-nav-signature': 'gefaelscht' },
      masterSecret: MASTER,
    });
    expect(forward.headers[NAV_HEADER]).toBe('');
    expect(forward.headers[NAV_SIGNATURE_HEADER]).toBe('');
    expect(forward.headers['x-auth-nav']).toBeUndefined();
    expect(forward.headers['x-auth-nav-signature']).toBeUndefined();
  });

  it('gibt nur eigenen Anfragen die Origin der App, fremde bleiben fremd', () => {
    const own = buildForward({
      app: app('wiki'),
      path: '/wiki/new',
      incoming: { origin: 'http://127.0.0.1:8090' },
      masterSecret: MASTER,
    });
    expect(own.headers.origin).toBe(`https://${gatewayHost('apps.local.test')}`);

    // Eine fremde Seite im selben Browser: Next sieht die fremde Origin und
    // lehnt die Server Action ab, wie hinter dem echten Gateway.
    const foreign = buildForward({
      app: app('wiki'),
      path: '/wiki/new',
      incoming: { origin: 'https://boese.example' },
      masterSecret: MASTER,
    });
    expect(foreign.headers.origin).toBe('https://boese.example');
  });

  it('leitet nur in den Pfad der eigenen App und nur deployte Apps', () => {
    expect(() =>
      buildForward({ app: app('crm'), path: '/wiki/x', incoming: {}, masterSecret: MASTER }),
    ).toThrow(/does not belong/);
    expect(() =>
      buildForward({ app: app('crm', false), path: '/crm', incoming: {}, masterSecret: MASTER }),
    ).toThrow(/is not deployed/);
  });

  it('liest den App-Namen nur aus dem ersten Pfadsegment', () => {
    expect(appNameFromPath('/crm/deals?x=1')).toBe('crm');
    expect(appNameFromPath('/crm')).toBe('crm');
    expect(appNameFromPath('/../etc')).toBeNull();
    expect(appNameFromPath('/')).toBeNull();
  });

  it('zeigt einen leeren Zustand und keine undeployten Apps', () => {
    expect(indexPage([])).toMatch(/No app deployed yet/);
    const html = indexPage([app('wiki'), app('crm', false)]);
    expect(html).toMatch(/href="\/wiki"/);
    expect(html).not.toMatch(/href="\/crm"/);
  });

  it('startet ausserhalb des lokalen Betriebs nicht', async () => {
    const { execFileSync } = await import('node:child_process');
    expect(() =>
      execFileSync('node_modules/.bin/tsx', ['src/infra/lokal-ansehen.ts'], {
        env: { ...process.env, OPENAPPS_BACKEND: 'coolify' },
        stdio: 'pipe',
      }),
    ).toThrow(/only runs with OPENAPPS_BACKEND=lokal/);
  });
});
