/**
 * Agent-Identitaeten: die riskanten Pfade zuerst (CLAUDE.md, Konventionen).
 *
 * Riskant ist hier:
 *
 *  1. Ohne Freigabe geht nichts — nicht anlegen, nicht sehen, nicht sperren.
 *  2. Anlegen braucht die Wildcard. Wer einen einzelnen Agent verwalten darf,
 *     darf sich damit keinen zweiten machen.
 *  3. Das Secret verlaesst die Control Plane genau einmal. Gespeichert ist nur
 *     der Hash, und im Audit-Log steht es nie.
 *  4. Eine neue Identitaet darf nichts. Anlegen vergibt keine Rechte.
 *  5. Sperren wirkt beim naechsten Aufruf, und der Name bleibt vergeben —
 *     sonst zeigte `agent:<name>` im Audit-Log auf zwei verschiedene Agents.
 */

import { describe, expect, it } from 'vitest';
import {
  agentToken,
  can,
  createAgentIdentity,
  disableAgentIdentity,
  grant,
  hashAgentSecret,
  listAgentIdentities,
  parseAgentToken,
} from '../src/domain';
import {
  ConflictError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../src/domain/errors';
import { admin, createHarness, seedBootstrapGrants } from './helpers';
import type { Actor } from '../src/domain/types';
import type { Harness } from './helpers';

const fremd: Actor = { kind: 'user', id: 'u-niemand', groups: [] };
/** Darf genau einen Agent verwalten, sonst nichts. */
const betreuer: Actor = { kind: 'user', id: 'u-mira', groups: [] };

async function setup(): Promise<Harness> {
  const harness = createHarness();
  await seedBootstrapGrants(harness);
  return harness;
}

describe('Agents: Default-Deny', () => {
  it('laesst niemanden ohne Freigabe anlegen, sehen oder sperren', async () => {
    const harness = await setup();
    await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });

    await expect(
      createAgentIdentity(harness.ctx, { actor: fremd, name: 'eigener' }),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
      disableAgentIdentity(harness.ctx, { actor: fremd, name: 'planer' }),
    ).rejects.toThrow(PermissionDeniedError);
    expect(await listAgentIdentities(harness.ctx, { actor: fremd })).toHaveLength(0);

    // Und nichts davon hat gewirkt.
    expect(await harness.ctx.agents.findByName('eigener')).toBeNull();
    expect((await harness.ctx.agents.findByName('planer'))?.disabledAt).toBeNull();
  });

  it('laesst nur mit der Wildcard anlegen, nicht mit write auf einen einzelnen Agent', async () => {
    const harness = await setup();
    await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });
    for (const verb of ['read', 'write'] as const) {
      await grant(harness.ctx, {
        actor: admin,
        subject: { kind: 'user', id: betreuer.id },
        verb,
        resource: { kind: 'agent', id: 'planer' },
      });
    }

    await expect(
      createAgentIdentity(harness.ctx, { actor: betreuer, name: 'zweiter' }),
    ).rejects.toThrow(PermissionDeniedError);

    // Sehen und sperren darf er genau den einen.
    const sichtbar = await listAgentIdentities(harness.ctx, { actor: betreuer });
    expect(sichtbar.map((agent) => agent.name)).toEqual(['planer']);
    const gesperrt = await disableAgentIdentity(harness.ctx, { actor: betreuer, name: 'planer' });
    expect(gesperrt.disabled).toBe(true);
  });

  it('gibt einer neuen Identitaet kein einziges Recht', async () => {
    const harness = await setup();
    await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });
    const planer: Actor = { kind: 'agent', id: 'planer' };

    for (const verb of ['read', 'write', 'execute'] as const) {
      expect(await can(harness.ctx, planer, verb, { kind: 'app', id: '*' })).toBe(false);
    }
    // Auch nicht auf sich selbst: Ein Agent sperrt sich nicht frei und legt
    // sich keinen Zwilling an.
    expect(await can(harness.ctx, planer, 'write', { kind: 'agent', id: 'planer' })).toBe(false);
    await expect(
      createAgentIdentity(harness.ctx, { actor: planer, name: 'zwilling' }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it('laesst einen Agent ohne agent:* keine Freigaben auf Agents vergeben', async () => {
    const harness = await setup();
    await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });
    const planer: Actor = { kind: 'agent', id: 'planer' };
    // Er darf Apps verwalten — das ist der Normalfall fuer einen Agent.
    for (const verb of ['read', 'write', 'execute'] as const) {
      await grant(harness.ctx, {
        actor: admin,
        subject: planer,
        verb,
        resource: { kind: 'app', id: '*' },
      });
    }
    // Daraus darf kein Recht auf Agent-Identitaeten werden.
    await expect(
      grant(harness.ctx, {
        actor: planer,
        subject: planer,
        verb: 'write',
        resource: { kind: 'agent', id: '*' },
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });
});

describe('Agents: das Secret', () => {
  it('gibt das Secret einmal heraus und speichert nur den Hash', async () => {
    const harness = await setup();
    const created = await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });

    expect(created.clientSecret.length).toBeGreaterThanOrEqual(40);
    expect(created.token).toBe(agentToken(created.agent.oauthClientId, created.clientSecret));

    const stored = await harness.ctx.agents.secretHashOf(created.agent.oauthClientId);
    expect(stored).toBe(hashAgentSecret(created.clientSecret));
    expect(stored).not.toContain(created.clientSecret);

    // Weder die Identitaet noch die Liste tragen das Secret oder den Hash.
    const liste = await listAgentIdentities(harness.ctx, { actor: admin });
    expect(JSON.stringify(liste)).not.toContain(created.clientSecret);
    expect(JSON.stringify(liste)).not.toContain(String(stored));
  });

  it('schreibt das Secret nie ins Audit-Log', async () => {
    const harness = await setup();
    const created = await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });

    const log = JSON.stringify(harness.store.auditEntries);
    expect(log).not.toContain(created.clientSecret);
    expect(log).not.toContain(created.token);
    // Die Client-Id steht drin — sie ist die Spur, nicht das Geheimnis.
    expect(log).toContain(created.agent.oauthClientId);
  });

  it('macht jedes Secret neu', async () => {
    const harness = await setup();
    const a = await createAgentIdentity(harness.ctx, { actor: admin, name: 'agent-a' });
    const b = await createAgentIdentity(harness.ctx, { actor: admin, name: 'agent-b' });
    expect(a.clientSecret).not.toBe(b.clientSecret);
    expect(a.agent.oauthClientId).not.toBe(b.agent.oauthClientId);
  });

  it('zerlegt ein Token am ersten Punkt und weist Unvollstaendiges ab', () => {
    expect(parseAgentToken('oac_abc.geheim')).toEqual({ clientId: 'oac_abc', secret: 'geheim' });
    for (const kaputt of ['', 'ohnepunkt', '.nursecret', 'nurid.']) {
      expect(parseAgentToken(kaputt)).toBeNull();
    }
  });
});

describe('Agents: Name und Sperre', () => {
  it('weist Namen ab, die nicht ins Subjekt passen', async () => {
    const harness = await setup();
    for (const name of ['Planer', 'mit,komma', 'a', '-vorn', 'mit leer', 'agent:x', '*']) {
      await expect(createAgentIdentity(harness.ctx, { actor: admin, name })).rejects.toThrow(
        ValidationError,
      );
    }
  });

  it('sperrt sofort, bleibt dabei idempotent und haelt den Namen fest', async () => {
    const harness = await setup();
    const created = await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });
    const clientId = created.agent.oauthClientId;

    expect(await harness.ctx.agents.findByClientId(clientId)).not.toBeNull();

    const erste = await disableAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });
    expect(erste.disabled).toBe(true);
    expect(erste.agent.disabledAt).not.toBeNull();

    // Der Lesepfad der Anmeldung findet ihn nicht mehr — weder Identitaet
    // noch Hash. Damit ist das Token beim naechsten Aufruf wertlos.
    expect(await harness.ctx.agents.findByClientId(clientId)).toBeNull();
    expect(await harness.ctx.agents.secretHashOf(clientId)).toBeNull();

    const zweite = await disableAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });
    expect(zweite.disabled).toBe(false);
    // Der erste Zeitpunkt bleibt stehen: Er ist die Spur.
    expect(zweite.agent.disabledAt).toEqual(erste.agent.disabledAt);

    await expect(
      createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' }),
    ).rejects.toThrow(ConflictError);
  });

  it('meldet einen Agent, den es nicht gibt, mit 404', async () => {
    const harness = await setup();
    await expect(
      disableAgentIdentity(harness.ctx, { actor: admin, name: 'gibtsnicht' }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('Agents: Audit-Log', () => {
  it('schreibt Anlegen und Sperren mit, auch den abgelehnten Versuch', async () => {
    const harness = await setup();
    await createAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });
    await expect(
      createAgentIdentity(harness.ctx, { actor: fremd, name: 'eigener' }),
    ).rejects.toThrow(PermissionDeniedError);
    await disableAgentIdentity(harness.ctx, { actor: admin, name: 'planer' });

    const angelegt = harness.store.auditEntries.filter((entry) => entry.action === 'create_agent');
    expect(angelegt.map((entry) => entry.outcome)).toEqual(['allowed', 'denied']);
    expect(angelegt[0]?.resource).toEqual({ kind: 'agent', id: 'planer' });
    expect(angelegt[1]?.resource).toEqual({ kind: 'agent', id: 'eigener' });

    const gesperrt = harness.store.auditEntries.filter((entry) => entry.action === 'disable_agent');
    expect(gesperrt).toHaveLength(1);
    expect(gesperrt[0]?.outcome).toBe('allowed');
  });
});
