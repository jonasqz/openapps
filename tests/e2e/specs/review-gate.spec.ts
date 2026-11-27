/**
 * Das Review-Gate ueber den Plattform-MCP, ohne Browser: Ein Deploy mit
 * falschem Manifest wird geblockt, und die laufende Version bleibt dieselbe.
 * Jeder Versuch hinterlaesst einen Deploy-Eintrag mit Status `blocked`; das
 * ist gewollt (Nachweis im Audit-Log) und im lokalen Stapel unschaedlich.
 */

import { expect, test } from '@playwright/test';
import { OperatorMcp, type ListedApp } from '../src/mcp';

test.describe.configure({ mode: 'serial' });
// Das Gate laesst gitleaks und semgrep ueber den Quelltext laufen.
test.setTimeout(240_000);

let mcp: OperatorMcp;
let app: ListedApp;
const stamp = Date.now().toString(36);
const GIT_SHA = 'e2e0'.repeat(10);

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  const apps = await mcp.deployedApps();
  expect(apps.length, 'needs a deployed app').toBeGreaterThanOrEqual(1);
  app = apps[0] as ListedApp;
});

test.afterAll(async () => {
  await mcp?.close();
});

async function liveDeployment(): Promise<string | null> {
  const apps = await mcp.deployedApps();
  return apps.find((a) => a.name === app.name)?.currentDeploymentId ?? null;
}

test('a manifest whose version does not match is blocked', async () => {
  const before = await liveDeployment();
  const result = await mcp.call('request_deploy', {
    app: app.name,
    version: `${app.manifest.version}-e2e.${stamp}`,
    gitSha: GIT_SHA,
    // Das Manifest der laufenden Version, unveraendert: Seine Version passt
    // nicht zur angefragten.
    manifest: app.manifest,
  });
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe('review_blocked');
  // Geblockt aus genau diesem Grund, nicht wegen eines anderen Befunds.
  expect(result.error?.message).toContain('manifest.version_mismatch');
  expect(await liveDeployment()).toBe(before);
});

test('a manifest that does not match the code is blocked', async () => {
  const before = await liveDeployment();
  const version = `${app.manifest.version}-e2e.${stamp}.2`;
  const result = await mcp.call('request_deploy', {
    app: app.name,
    version,
    gitSha: GIT_SHA,
    manifest: { ...app.manifest, version },
    // Der Code bietet ein Tool und nutzt eine Tabelle, die das Manifest nicht
    // nennt.
    codeFacts: {
      tables: ['e2e_undeclared_table'],
      tools: [`${app.name}.e2eUndeclared`],
      envVars: [],
    },
  });
  expect(result.ok).toBe(false);
  expect(result.error?.code).toBe('review_blocked');
  expect(result.error?.message).toContain('manifest.undeclared_tool');
  expect(result.error?.message).toContain('manifest.undeclared_table');
  expect(result.error?.message).not.toContain('manifest.version_mismatch');
  expect(await liveDeployment()).toBe(before);
});

test('a manifest that is not a manifest is rejected before the gate', async () => {
  const before = await liveDeployment();
  const result = await mcp.call('request_deploy', {
    app: app.name,
    version: `9.9.9-e2e.${stamp}`,
    gitSha: GIT_SHA,
    manifest: { name: app.name, version: `9.9.9-e2e.${stamp}` },
  });
  expect(result.ok).toBe(false);
  // Je nachdem, ob das SDK oder `runTool` das Schema zuerst prueft.
  expect(['validation_failed', 'mcp_error']).toContain(result.error?.code);
  expect(await liveDeployment()).toBe(before);
});
