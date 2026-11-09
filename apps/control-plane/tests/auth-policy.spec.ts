/**
 * Die zwei Regeln, die entscheiden, wer sich ueberhaupt anmelden darf.
 * Zuerst die riskanten Faelle, nicht der glueckliche:
 *
 * - Eine E-Mail ausserhalb von `AUTH_ALLOWED_EMAIL_DOMAINS` wird abgewiesen.
 * - Ist die Variable leer, wird **jede** abgewiesen. Das ist die wichtigste
 *   Zeile: ohne sie kann sich jeder mit einem Google-Konto ein Konto auf der
 *   Plattform anlegen.
 * - Eine Bootstrap-Adresse landet in `platform-admins`, eine andere nicht.
 */

import { describe, expect, it } from 'vitest';
import {
  applyBootstrapMembership,
  assertEmailDomainAllowed,
  BOOTSTRAP_GROUP,
  emailDomainAllowed,
  EmailDomainRejectedError,
  parseDomainList,
  parseEmailList,
} from '../src/lib/auth-policy';
import { readAuthEnv } from '../src/lib/env';

const ALLOWED = ['example.com', 'zweite-domain.de'];

describe('Domain-Schranke', () => {
  it('weist jede Anmeldung ab, wenn AUTH_ALLOWED_EMAIL_DOMAINS leer ist', () => {
    for (const email of ['chef@example.com', 'eve@evil.com', 'a@b.c']) {
      expect(emailDomainAllowed(email, [])).toBe(false);
      expect(() => assertEmailDomainAllowed(email, [])).toThrow(EmailDomainRejectedError);
    }
    // Auch der Weg ueber die Env darf nicht aus "nicht gesetzt" ein "alle"
    // machen.
    expect(parseDomainList(undefined)).toEqual([]);
    expect(parseDomainList('')).toEqual([]);
    expect(parseDomainList('  ,  ')).toEqual([]);
  });

  it('weist eine E-Mail ausserhalb der erlaubten Domains ab', () => {
    expect(emailDomainAllowed('eve@evil.com', ALLOWED)).toBe(false);
    expect(() => assertEmailDomainAllowed('eve@evil.com', ALLOWED)).toThrow(
      /nicht in AUTH_ALLOWED_EMAIL_DOMAINS/,
    );
  });

  it('laesst sich nicht durch ein Suffix, eine Subdomain oder Grossschreibung austricksen', () => {
    expect(emailDomainAllowed('eve@evil-example.com', ALLOWED)).toBe(false);
    expect(emailDomainAllowed('eve@example.com.evil.com', ALLOWED)).toBe(false);
    expect(emailDomainAllowed('eve@sub.example.com', ALLOWED)).toBe(false);
    expect(emailDomainAllowed('eve@examplecom', ALLOWED)).toBe(false);
    // Kein Domain-Teil, mehrere @, leer: alles nein, nichts davon wirft.
    expect(emailDomainAllowed('eve', ALLOWED)).toBe(false);
    expect(emailDomainAllowed('@example.com', ALLOWED)).toBe(false);
    expect(emailDomainAllowed('eve@', ALLOWED)).toBe(false);
    expect(emailDomainAllowed('', ALLOWED)).toBe(false);

    // Gross- und Kleinschreibung darf nicht entscheiden.
    expect(emailDomainAllowed('Chef@Example.COM', ALLOWED)).toBe(true);
    expect(emailDomainAllowed(' chef@example.com ', ALLOWED)).toBe(true);
  });

  it('nimmt die Liste aus der Env entgegen, mit und ohne @', () => {
    expect(parseDomainList('example.com, @zweite-domain.de ,EXAMPLE.ORG')).toEqual([
      'example.com',
      'zweite-domain.de',
      'example.org',
    ]);
  });

  it('liest die Schranke aus den Env-Variablen, die .env.example nennt', () => {
    const env = readAuthEnv({
      // `NODE_ENV` gehoert zu `ProcessEnv`, deshalb steht es hier mit.
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 's'.repeat(32),
      BETTER_AUTH_URL: 'https://control-plane.example.com/',
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'csecret',
      AUTH_ALLOWED_EMAIL_DOMAINS: 'example.com',
      AUTH_BOOTSTRAP_ADMINS: 'Chef@Example.com, nicht-eine-mail',
    });
    expect(env.allowedEmailDomains).toEqual(['example.com']);
    expect(env.bootstrapAdmins).toEqual(['chef@example.com']);
    // Der Slash am Ende wuerde sonst in jeder Callback-URL doppelt stehen.
    expect(env.baseUrl).toBe('https://control-plane.example.com');
  });

  it('wirft, wenn eine der vier Pflicht-Variablen fehlt — halb konfiguriert ist schlimmer', () => {
    const complete: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 's'.repeat(32),
      BETTER_AUTH_URL: 'https://control-plane.example.com',
      GOOGLE_CLIENT_ID: 'cid',
      GOOGLE_CLIENT_SECRET: 'csecret',
    };
    for (const key of Object.keys(complete).filter((key) => key !== 'NODE_ENV')) {
      const broken = { ...complete, [key]: '' };
      expect(() => readAuthEnv(broken), key).toThrow(new RegExp(key));
    }
    // Ein zu kurzes Secret ist kein Secret.
    expect(() => readAuthEnv({ ...complete, BETTER_AUTH_SECRET: 'kurz' })).toThrow(
      /BETTER_AUTH_SECRET ist kuerzer/,
    );
  });
});

describe('Bootstrap in platform-admins', () => {
  function recordingGroups(): {
    calls: { group: string; email: string; addedBy: string }[];
    ensureMembership(group: string, email: string, addedBy: string): Promise<void>;
  } {
    const calls: { group: string; email: string; addedBy: string }[] = [];
    return {
      calls,
      ensureMembership(group, email, addedBy) {
        calls.push({ group, email, addedBy });
        return Promise.resolve();
      },
    };
  }

  it('traegt eine Bootstrap-Adresse in platform-admins ein', async () => {
    const groups = recordingGroups();
    const applied = await applyBootstrapMembership(
      'Chef@example.com',
      parseEmailList('chef@example.com, zweite@example.com'),
      groups,
    );
    expect(applied).toBe(true);
    expect(groups.calls).toEqual([
      { group: BOOTSTRAP_GROUP, email: 'chef@example.com', addedBy: 'system:bootstrap' },
    ]);
  });

  it('traegt jede andere Adresse nicht ein', async () => {
    const groups = recordingGroups();
    expect(await applyBootstrapMembership('lena@example.com', ['chef@example.com'], groups)).toBe(
      false,
    );
    expect(groups.calls).toEqual([]);
  });

  it('traegt niemanden ein, wenn AUTH_BOOTSTRAP_ADMINS fehlt', async () => {
    const groups = recordingGroups();
    expect(
      await applyBootstrapMembership('chef@example.com', parseEmailList(undefined), groups),
    ).toBe(false);
    expect(groups.calls).toEqual([]);
  });
});
