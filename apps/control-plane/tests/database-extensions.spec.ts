/**
 * ADR 0025 Schritt 1 in der Domaene: Ein Deploy gleicht den Zugang der
 * App-Rolle zum Schema `extensions` mit dem Manifest ab, **vor** dem Start.
 *
 * Riskant und deshalb zuerst:
 *
 * - Fehlt die Erweiterung, startet nichts: Der Deploy endet als `failed`, die
 *   Meldung nennt den einmaligen Schritt, das Backend wird nicht gerufen.
 * - Ohne Bedarf im Manifest bekommt die Rolle nichts, und ein weggefallener
 *   Bedarf nimmt den Zugang beim naechsten Deploy wieder.
 *
 * Was Postgres daraus macht (USAGE ja, CREATE nie), belegt
 * `extensions-postgres.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import { createApp, requestDeploy, type AppManifest } from '../src/domain';
import { MissingDatabaseExtensionError } from '../src/domain/errors';
import { createDefaultPipeline } from '../src/domain/review-gate';
import { createCleanScanner } from '../src/infra/memory/doubles';
import {
  admin,
  createHarness,
  manifest,
  seedBootstrapGrants,
  testGatewaySettings,
  type Harness,
} from './helpers';

async function setup(): Promise<Harness> {
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

function withVector(name: string, version: string): AppManifest {
  return { ...manifest(name, version), databaseExtensions: ['vector'] };
}

function deploy(harness: Harness, app: string, version: string, m: AppManifest) {
  return requestDeploy(harness.ctx, {
    actor: admin,
    appIdOrName: app,
    version,
    gitSha: `sha${version.replaceAll('.', '')}`,
    repoDir: `/tmp/${app}`,
    manifest: m,
    codeFacts: { tables: ['items'], tools: [`${app}.list`], envVars: [] },
  });
}

describe('databaseExtensions beim Deploy (ADR 0025)', () => {
  it('fehlt die Erweiterung, endet der Deploy als failed und startet nichts', async () => {
    const harness = await setup();
    harness.provisioner.installedExtensions.delete('vector');
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'knowledge',
      manifest: manifest('knowledge'),
    });

    const error = await deploy(
      harness,
      'knowledge',
      '0.3.0',
      withVector('knowledge', '0.3.0'),
    ).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MissingDatabaseExtensionError);
    expect((error as Error).message).toMatch(/openapps-vector/);
    expect((error as Error).message).toMatch(/superuser/);

    const [attempt] = await harness.ctx.deployments.listByApp(app.id);
    expect(attempt?.status).toBe('failed');
    expect(harness.backend.calls.filter((call) => call.method === 'deploy')).toEqual([]);
    expect(harness.provisioner.extensionUsage.has(app.dbRole)).toBe(false);
  });

  it('eine laufende Fassung bleibt live, wenn die naechste an der Erweiterung scheitert', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'knowledge',
      manifest: manifest('knowledge'),
    });
    const first = await deploy(harness, 'knowledge', '0.2.5', manifest('knowledge', '0.2.5'));
    expect(first.deployment.status).toBe('live');

    harness.provisioner.installedExtensions.delete('vector');
    await expect(
      deploy(harness, 'knowledge', '0.3.0', withVector('knowledge', '0.3.0')),
    ).rejects.toBeInstanceOf(MissingDatabaseExtensionError);

    const current = await harness.ctx.apps.findById(app.id);
    expect(current?.currentDeploymentId).toBe(first.deployment.id);
    expect(harness.backend.calls.filter((call) => call.method === 'deploy')).toHaveLength(1);
  });

  it('ohne Bedarf kein Zugang; mit Bedarf USAGE; weggefallener Bedarf nimmt es wieder', async () => {
    const harness = await setup();
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'knowledge',
      manifest: manifest('knowledge'),
    });

    await deploy(harness, 'knowledge', '0.2.5', manifest('knowledge', '0.2.5'));
    expect(harness.provisioner.extensionUsage.has(app.dbRole)).toBe(false);

    const second = await deploy(harness, 'knowledge', '0.3.0', withVector('knowledge', '0.3.0'));
    expect(second.deployment.status).toBe('live');
    expect(harness.provisioner.extensionUsage.has(app.dbRole)).toBe(true);

    await deploy(harness, 'knowledge', '0.4.0', manifest('knowledge', '0.4.0'));
    expect(harness.provisioner.extensionUsage.has(app.dbRole)).toBe(false);
  });

  it('eine andere App ohne Bedarf bekommt nichts, auch wenn eine App vector nutzt', async () => {
    const harness = await setup();
    const knowledge = await createApp(harness.ctx, {
      actor: admin,
      name: 'knowledge',
      manifest: manifest('knowledge'),
    });
    const crm = await createApp(harness.ctx, {
      actor: admin,
      name: 'crm',
      manifest: manifest('crm'),
    });
    await deploy(harness, 'knowledge', '0.3.0', withVector('knowledge', '0.3.0'));
    await deploy(harness, 'crm', '1.0.0', manifest('crm', '1.0.0'));
    expect([...harness.provisioner.extensionUsage]).toEqual([knowledge.dbRole]);
    expect(harness.provisioner.extensionUsage.has(crm.dbRole)).toBe(false);
  });
});
