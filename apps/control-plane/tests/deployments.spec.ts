/**
 * Nachweis zu DoD 5: Rollback auf die Vorversion mit einem Befehl.
 *
 * Geprueft wird, was wir selbst verantworten: dass der Zeiger-Tausch stimmt,
 * dass das Backend genau einmal gerufen wird und dass ein zweiter Rollback
 * zurueckfuehrt statt im Kreis. Die Stoppuhr-Haelfte ("unter 2 Minuten")
 * braucht eine Demo und steht als `it.todo`.
 */

import { describe, expect, it } from 'vitest';
import { createApp, requestDeploy, rollback } from '../src/domain';
import { ConflictError } from '../src/domain/errors';
import { createDefaultPipeline } from '../src/domain/review-gate';
import { createCleanScanner } from '../src/infra/memory/doubles';
import { admin, createHarness, gitSource, manifest, seedBootstrapGrants } from './helpers';

describe('Rollback', () => {
  it('setzt auf die Vorversion zurueck und tauscht die Zeiger', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'projektliste',
      manifest: manifest('projektliste'),
      source: gitSource('projektliste'),
    });

    const erste = await deploy(harness, app.name, '1.0.0', 'aaaaaa1');
    const zweite = await deploy(harness, app.name, '1.1.0', 'bbbbbb2');

    const vorher = await harness.ctx.apps.findById(app.id);
    expect(vorher?.currentDeploymentId).toBe(zweite.deployment.id);
    expect(vorher?.previousDeploymentId).toBe(erste.deployment.id);

    const restored = await rollback(harness.ctx, { actor: admin, appIdOrName: app.name });

    expect(restored.id).toBe(erste.deployment.id);
    expect(restored.status).toBe('live');

    const nachher = await harness.ctx.apps.findById(app.id);
    expect(nachher?.currentDeploymentId).toBe(erste.deployment.id);
    // Die abgeloeste Version ist jetzt die Vorversion: ein zweiter Rollback
    // fuehrt zurueck, nicht im Kreis.
    expect(nachher?.previousDeploymentId).toBe(zweite.deployment.id);

    const abgeloest = await harness.ctx.deployments.findById(zweite.deployment.id);
    expect(abgeloest?.status).toBe('rolled_back');

    expect(harness.backend.calls.filter((c) => c.method === 'rollback')).toHaveLength(1);
  });

  it('lehnt den Rollback ab, wenn es keine Vorversion gibt', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'einmalig',
      manifest: manifest('einmalig'),
      source: gitSource('einmalig'),
    });
    await deploy(harness, app.name, '1.0.0', 'aaaaaa1');

    await expect(
      rollback(harness.ctx, { actor: admin, appIdOrName: app.name }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('protokolliert den Rollback', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'notizen',
      manifest: manifest('notizen'),
      source: gitSource('notizen'),
    });
    await deploy(harness, app.name, '1.0.0', 'aaaaaa1');
    await deploy(harness, app.name, '1.1.0', 'bbbbbb2');
    await rollback(harness.ctx, { actor: admin, appIdOrName: app.name });

    const eintrag = harness.store.auditEntries.find((e) => e.action === 'rollback');
    expect(eintrag?.outcome).toBe('allowed');
    expect(eintrag?.detail.version).toBe('1.0.0');
  });

  it.todo('Rollback dauert auf einer echten Instanz unter 2 Minuten (Demo mit Mitschnitt)');
});

async function setup() {
  const harness = createHarness({
    baseDomain: 'apps.test',
    pipeline: createDefaultPipeline({
      gitleaks: createCleanScanner('gitleaks'),
      semgrep: createCleanScanner('semgrep'),
    }),
  });
  await seedBootstrapGrants(harness);
  return harness;
}

async function deploy(
  harness: Awaited<ReturnType<typeof setup>>,
  appName: string,
  version: string,
  gitSha: string,
) {
  return requestDeploy(harness.ctx, {
    actor: admin,
    appIdOrName: appName,
    version,
    gitSha,
    repoDir: `/tmp/${appName}`,
    manifest: manifest(appName, version),
    codeFacts: { tables: ['items'], tools: [`${appName}.list`], envVars: [] },
  });
}
