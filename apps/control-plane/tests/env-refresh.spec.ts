/**
 * Die Env einer bestehenden App wird bei jedem Deploy nachgezogen (ADR 0020).
 *
 * Gefunden beim lokalen Rollout: Die Env wurde nur beim ersten Anlegen des
 * Backends gesetzt. Eine App, die vor einem neuen Plattform-Schluessel
 * angelegt war (OPENAPPS_CALL_SECRET, OPENAPPS_PLATFORM_URL), bekam ihn nie.
 *
 * Riskant und deshalb geprueft: Die DSN wird dabei nicht neu gezogen (das
 * rotierte das Passwort der laufenden App), und ein Fehler beim Nachziehen
 * startet nichts.
 */

import { describe, expect, it } from 'vitest';
import { createApp, requestDeploy } from '../src/domain';
import { createDefaultPipeline } from '../src/domain/review-gate';
import { createCleanScanner, createRecordingBackend } from '../src/infra/memory/doubles';
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
  await createApp(harness.ctx, { actor: admin, name: 'wiki', manifest: manifest('wiki') });
  return harness;
}

function deploy(harness: Harness, version: string, gitSha: string, ctx = harness.ctx) {
  return requestDeploy(ctx, {
    actor: admin,
    appIdOrName: 'wiki',
    version,
    gitSha,
    repoDir: '/tmp/wiki',
    manifest: manifest('wiki', version),
    codeFacts: { tables: ['items'], tools: ['wiki.list'], envVars: [] },
  });
}

describe('Env einer bestehenden App bei jedem Deploy', () => {
  it('zieht beim zweiten Deploy die Plattform-Schluessel nach, ohne DATABASE_URL', async () => {
    const harness = await setup();
    await deploy(harness, '1.0.0', 'aaaaaa1');
    // Anlegen und erster Deploy ziehen je eine DSN; danach keine mehr.
    const drawn = harness.provisioner.provisioned.length;

    const second = await deploy(harness, '1.1.0', 'bbbbbb2');
    expect(second.deployment.status).toBe('live');

    const merges = harness.backend.calls.filter((c) => c.method === 'mergeEnv');
    expect(merges).toHaveLength(1);
    const keys = merges[0]?.args[1] as string[];
    expect(keys).toContain('OPENAPPS_CALL_SECRET');
    expect(keys).toContain('OPENAPPS_PLATFORM_URL');
    expect(keys).toContain('OPENAPPS_AUTH_SECRET');
    expect(keys).not.toContain('DATABASE_URL');
    // Die DSN wurde nicht neu gezogen: das Passwort der laufenden App bleibt.
    expect(harness.provisioner.provisioned).toHaveLength(drawn);
    // Nachgezogen wird vor dem Start der neuen Fassung.
    const methods = harness.backend.calls.map((c) => c.method);
    expect(methods.lastIndexOf('mergeEnv')).toBeLessThan(methods.lastIndexOf('deploy'));
  });

  it('der erste Deploy setzt die ganze Env einmal, mit DATABASE_URL, und zieht nichts nach', async () => {
    const harness = await setup();
    await deploy(harness, '1.0.0', 'aaaaaa1');
    expect(harness.backend.calls.filter((c) => c.method === 'setEnv')).toHaveLength(1);
    expect(harness.backend.calls.filter((c) => c.method === 'mergeEnv')).toHaveLength(0);
    expect(harness.backend.calls.find((c) => c.method === 'setEnv')?.args[1]).toContain(
      'DATABASE_URL',
    );
  });

  it('bricht den Deploy ab, wenn das Nachziehen scheitert: nichts startet, die alte Fassung bleibt', async () => {
    const harness = await setup();
    const first = await deploy(harness, '1.0.0', 'aaaaaa1');
    const drawn = harness.provisioner.provisioned.length;

    const failing = createRecordingBackend({ mergeEnvFailsWith: 'backend down' });
    const ctx = { ...harness.ctx, backend: failing };
    await expect(deploy(harness, '1.1.0', 'bbbbbb2', ctx)).rejects.toThrow('backend down');

    expect(failing.calls.map((c) => c.method)).toEqual(['mergeEnv']);
    const app = await harness.ctx.apps.findByName('wiki');
    expect(app?.currentDeploymentId).toBe(first.deployment.id);
    const attempts = await harness.ctx.deployments.listByApp(app?.id ?? '');
    expect(attempts.find((d) => d.version === '1.1.0')?.status).toBe('failed');
    expect(harness.provisioner.provisioned).toHaveLength(drawn);
  });
});
