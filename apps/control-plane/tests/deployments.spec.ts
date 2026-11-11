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
import { createCleanScanner, createRecordingRepositoryBackend } from '../src/infra/memory/doubles';
import {
  admin,
  createHarness,
  manifest,
  seedBootstrapGrants,
  testGatewaySettings,
} from './helpers';

describe('Rollback', () => {
  it('setzt auf die Vorversion zurueck und tauscht die Zeiger', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'projektliste',
      manifest: manifest('projektliste'),
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

describe('Deploy ohne Arbeitskopie des Aufrufers', () => {
  it('holt den Commit aus dem Repo im Register und raeumt danach auf', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'headless',
      manifest: manifest('headless'),
    });

    const outcome = await requestDeploy(harness.ctx, {
      actor: admin,
      appIdOrName: app.name,
      version: '1.0.0',
      gitSha: 'aaaaaa1',
      manifest: manifest('headless', '1.0.0'),
      codeFacts: { tables: ['items'], tools: ['headless.list'], envVars: [] },
    });

    expect(outcome.deployment.status).toBe('live');
    // Die URL stammt aus dem Register — der Aufrufer kann keine andere nennen.
    expect(harness.repositories.checkouts).toEqual([{ gitUrl: app.source.git, gitSha: 'aaaaaa1' }]);
    expect(harness.repositories.disposed).toEqual(['/checkout.test/aaaaaa1']);
  });

  it('holt nichts, wenn eine Arbeitskopie mitgegeben ist', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'lokal',
      manifest: manifest('lokal'),
    });
    await deploy(harness, app.name, '1.0.0', 'aaaaaa1');

    expect(harness.repositories.checkouts).toEqual([]);
  });

  it('deployt nicht, wenn der Commit nicht zu holen ist', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'ungepusht',
      manifest: manifest('ungepusht'),
    });
    const ctx = {
      ...harness.ctx,
      repositories: createRecordingRepositoryBackend({ failCheckoutWith: '404 vom Repo-Backend' }),
    };

    await expect(
      requestDeploy(ctx, {
        actor: admin,
        appIdOrName: app.name,
        version: '1.0.0',
        gitSha: 'aaaaaa1',
        manifest: manifest('ungepusht', '1.0.0'),
      }),
    ).rejects.toThrow(/liess sich nicht holen.*404/);

    // Ohne Arbeitskopie hat das Gate nichts geprueft — also laeuft auch nichts.
    expect(harness.backend.calls.filter((call) => call.method === 'deploy')).toEqual([]);
    const [versuch] = await harness.ctx.deployments.listByApp(app.id);
    expect(versuch?.status).toBe('failed');
  });
});

async function setup() {
  const harness = createHarness({
    appsDomain: 'apps.test',
    pipeline: createDefaultPipeline({
      gatewaySettings: testGatewaySettings(),
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
