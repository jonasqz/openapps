/**
 * Die Naht zwischen Control Plane und App.
 *
 * Die Control Plane **erzeugt** die Identitaets-Header, `@openapps/sdk`
 * **prueft** sie. Das ist die Stelle, an der beide Seiten leise auseinander
 * laufen koennen: Ein anderes Trennzeichen, eine andere Normalisierung des
 * Hosts, eine andere App-Id — und die Pruefung schlaegt erst fehl, wenn eine
 * E-Mail ein Sonderzeichen hat.
 *
 * Deshalb prueft dieser Test nicht, dass die Signatur „irgendwie stimmt",
 * sondern dass **genau `getUser`** sie annimmt — mit demselben abgeleiteten
 * Secret, derselben App-Id und demselben Host, die die Control Plane auch in
 * die Env der App schreibt (ADR 0004, Spec 3.2).
 */

import { getUser, SIGNATURE_HEADER, UntrustedRequestError, USER_ID_HEADER } from '@openapps/sdk';
import { describe, expect, it } from 'vitest';
import { appAuthSecret, appIdOf, gatewayHost, identityHeadersForApp } from '../src/domain';
import type { App } from '../src/domain/types';
import { TEST_MASTER_SECRET } from './helpers';

/** Nur die Felder, die fuer die Signatur zaehlen. */
const app: Pick<App, 'name' | 'primaryDomain' | 'authSecretGeneration'> = {
  name: 'projektliste',
  primaryDomain: 'projektliste.apps.test',
  authSecretGeneration: 1,
};

/** Genau die drei Env-Werte, die die Control Plane der App setzt. */
function appEnv(of = app) {
  const appId = appIdOf(of);
  return {
    appId,
    appHost: gatewayHost(of.primaryDomain ?? ''),
    secret: appAuthSecret({
      masterSecret: TEST_MASTER_SECRET,
      appId,
      generation: of.authSecretGeneration,
    }),
  };
}

function sign(identity: Parameters<typeof identityHeadersForApp>[0]['identity'], of = app) {
  return identityHeadersForApp({ app: of, identity, masterSecret: TEST_MASTER_SECRET });
}

const nowSeconds = 1_762_680_000;
const now = () => nowSeconds * 1000;

describe('eine Signatur der Control Plane nimmt das SDK an', () => {
  it('liest Nutzer, E-Mail, Gruppen und Zeitpunkt zurueck', () => {
    const headers = sign({
      userId: 'usr_123',
      email: 'jonas@blyck.de',
      groups: ['team', 'admins'],
      issuedAt: nowSeconds,
    });

    const user = getUser(headers, { ...appEnv(), now });

    expect(user.id).toBe('usr_123');
    expect(user.email).toBe('jonas@blyck.de');
    expect(user.groups).toEqual(['team', 'admins']);
    expect(user.issuedAt.getTime()).toBe(nowSeconds * 1000);
  });

  it('haelt auch, wenn E-Mail oder Gruppenname ein Trennzeichen enthalten', () => {
    // Genau der Fall, an dem eine Verkettung mit Trennzeichen scheitern wuerde:
    // dieselbe Zeichenfolge, einmal in der E-Mail, einmal als Feldgrenze.
    const headers = sign({
      userId: 'usr_123',
      email: 'a@b.de,team',
      groups: [],
      issuedAt: nowSeconds,
    });

    const user = getUser(headers, { ...appEnv(), now });

    expect(user.email).toBe('a@b.de,team');
    expect(user.groups).toEqual([]);
  });

  it('setzt alle fuenf Header, auch bei leeren Gruppen', () => {
    const headers = sign({
      userId: 'usr_123',
      email: 'jonas@blyck.de',
      groups: [],
      issuedAt: nowSeconds,
    });

    expect(Object.keys(headers).sort()).toEqual([
      'x-auth-groups',
      'x-auth-issued-at',
      'x-auth-signature',
      'x-auth-user-email',
      'x-auth-user-id',
    ]);
    expect(headers['x-auth-groups']).toBe('');
    // Hex, Kleinbuchstaben, ohne Praefix.
    expect(headers[SIGNATURE_HEADER]).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('was das SDK ablehnen muss', () => {
  const identity = {
    userId: 'usr_123',
    email: 'jonas@blyck.de',
    groups: ['team'],
    issuedAt: nowSeconds,
  };

  it('eine veraenderte Nutzer-Id', () => {
    const headers = { ...sign(identity), [USER_ID_HEADER]: 'usr_eve' };
    expect(() => getUser(headers, { ...appEnv(), now })).toThrow(UntrustedRequestError);
  });

  it('eine Signatur fuer eine andere App', () => {
    // Dieselbe Identitaet, dieselbe Zeit — aber mit dem Secret einer anderen
    // App signiert. Genau das soll ein App-eigenes Secret verhindern.
    const other: typeof app = {
      name: 'crm',
      primaryDomain: 'crm.apps.test',
      authSecretGeneration: 1,
    };
    const headers = sign(identity, other);
    expect(() => getUser(headers, { ...appEnv(), now })).toThrow(UntrustedRequestError);
  });

  it('eine Signatur aus einer anderen Generation des Secrets', () => {
    const rotated: typeof app = { ...app, authSecretGeneration: 2 };
    const headers = sign(identity, rotated);
    // Nach der Rotation gilt die alte Signatur nicht mehr.
    expect(() => getUser(headers, { ...appEnv(), now })).toThrow(UntrustedRequestError);
    // Und die neue gilt, sobald die App ihr neues Secret hat.
    expect(getUser(headers, { ...appEnv(rotated), now }).id).toBe('usr_123');
  });

  it('eine Signatur, die aelter als 60 s ist', () => {
    const headers = sign({ ...identity, issuedAt: nowSeconds - 61 });
    expect(() => getUser(headers, { ...appEnv(), now })).toThrow(UntrustedRequestError);
    // Eine Sekunde juenger passt noch.
    expect(getUser(sign({ ...identity, issuedAt: nowSeconds - 59 }), { ...appEnv(), now }).id).toBe(
      'usr_123',
    );
  });

  it('selbst gesetzte Header ohne Signatur', () => {
    const headers = {
      'x-auth-user-id': 'usr_eve',
      'x-auth-user-email': 'eve@example.com',
      'x-auth-groups': 'admins',
      'x-auth-issued-at': String(nowSeconds),
    };
    expect(() => getUser(headers, { ...appEnv(), now })).toThrow(UntrustedRequestError);
  });
});

describe('Host-Normalisierung auf beiden Seiten', () => {
  it('eine Domain mit Großbuchstaben und Leerzeichen passt trotzdem', () => {
    const messy: typeof app = { ...app, primaryDomain: '  Projektliste.Apps.Test ' };
    const headers = sign(
      { userId: 'usr_123', email: 'jonas@blyck.de', groups: [], issuedAt: nowSeconds },
      messy,
    );

    // Das SDK trimmt und kleinschreibt die Env ebenfalls — beide landen auf
    // demselben Wert, deshalb passt die Signatur.
    expect(getUser(headers, { ...appEnv(messy), now }).id).toBe('usr_123');
    expect(appEnv(messy).appHost).toBe('projektliste.apps.test');
  });
});
