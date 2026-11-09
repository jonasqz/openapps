/**
 * Nachweis zu DoD 4: Deploy nur nach Review-Gate, ein eingebautes Secret wird
 * blockiert — und ein Claude-Report allein gibt nie frei.
 *
 * Gestubbt ist nur der Prozessaufruf der Scanner. Das Lesen ihrer Berichte und
 * die Zusammenfuehrung der Ergebnisse sind echt; genau daran haengt die
 * Entscheidung.
 */

import { describe, expect, it } from 'vitest';
import { requestDeploy, createApp } from '../src/domain';
import { ReviewBlockedError } from '../src/domain/errors';
import {
  claudeReportStep,
  createDefaultPipeline,
  createPipeline,
  gitleaksStep,
  mergeReview,
  semgrepStep,
} from '../src/domain/review-gate';
import type { ClaudeReviewer, ReviewInput, StepResult } from '../src/domain/review-gate/types';
import {
  createBrokenScanner,
  createCleanScanner,
  createFixedScanner,
} from '../src/infra/memory/doubles';
import {
  admin,
  createHarness,
  emptyManifest,
  manifest,
  seedBootstrapGrants,
  testLabelLint,
} from './helpers';

/** Ein gitleaks-Bericht, wie er bei einem eingebauten Secret aussieht. */
const GITLEAKS_SECRET_REPORT = JSON.stringify([
  {
    RuleID: 'generic-api-key',
    Description: 'Generic API Key im Quelltext',
    File: 'src/lib/client.ts',
    StartLine: 12,
  },
]);

const reviewInput: ReviewInput = {
  appId: 'app-1',
  deploymentId: 'dep-1',
  version: '1.0.0',
  gitSha: 'abcdef1',
  repoDir: '/tmp/does-not-matter',
  manifest: emptyManifest('demo'),
  uiActions: [],
  codeFacts: { tables: [], tools: [], envVars: [], publishedPorts: [], dockerNetworks: [] },
  // Ohne Gateway-Ziel blockiert der Label-Lint — das ist Absicht und steht als
  // eigener Fall in tests/gateway-label-lint.spec.ts.
  gateway: { appName: 'demo', domain: 'demo.apps.test' },
};

describe('Review-Gate: deterministische Scanner', () => {
  it('blockiert ein eingebautes Secret', async () => {
    const pipeline = createDefaultPipeline({
      gatewayLint: testLabelLint(),
      gitleaks: createFixedScanner({ exitCode: 1, stdout: GITLEAKS_SECRET_REPORT }),
      semgrep: createCleanScanner('semgrep'),
    });

    const result = await pipeline.run(reviewInput);

    expect(result.decision).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.code)).toContain('gitleaks.generic-api-key');
    expect(result.summary).toContain('blockiert');
  });

  it('gibt frei, wenn beide Scanner sauber sind', async () => {
    const pipeline = createDefaultPipeline({
      gatewayLint: testLabelLint(),
      gitleaks: createCleanScanner('gitleaks'),
      semgrep: createCleanScanner('semgrep'),
    });

    const result = await pipeline.run(reviewInput);

    expect(result.decision).toBe('pass');
    expect(result.blockingFindings).toHaveLength(0);
  });

  it('blockiert, wenn ein Scanner nicht lief — fehlende Pruefung ist keine bestandene Pruefung', async () => {
    const pipeline = createDefaultPipeline({
      gatewayLint: testLabelLint(),
      gitleaks: createBrokenScanner(),
      semgrep: createCleanScanner('semgrep'),
    });

    const result = await pipeline.run(reviewInput);

    expect(result.decision).toBe('blocked');
    expect(result.summary).toContain('gitleaks');
  });

  it('laeuft alle Schritte, auch wenn einer blockiert', async () => {
    const pipeline = createDefaultPipeline({
      gatewayLint: testLabelLint(),
      gitleaks: createFixedScanner({ exitCode: 1, stdout: GITLEAKS_SECRET_REPORT }),
      semgrep: createFixedScanner({
        exitCode: 1,
        stdout: JSON.stringify({
          results: [
            {
              check_id: 'javascript.lang.security.eval',
              path: 'src/run.ts',
              start: { line: 4 },
              extra: { message: 'eval auf Nutzereingabe', severity: 'ERROR' },
            },
          ],
        }),
      }),
    });

    const result = await pipeline.run(reviewInput);

    expect(result.steps.map((s) => s.step)).toEqual([
      'gitleaks',
      'semgrep',
      'ui-lint',
      'gateway-labels',
      'app-base-path',
      'tool-parity',
      'manifest-match',
      'claude-report',
    ]);
    expect(result.blockingFindings).toHaveLength(2);
  });

  it('ueberspringt den UI-Linter, solange es keine Regeln gibt, und blockiert deshalb nicht', async () => {
    const pipeline = createDefaultPipeline({
      gatewayLint: testLabelLint(),
      gitleaks: createCleanScanner('gitleaks'),
      semgrep: createCleanScanner('semgrep'),
    });

    const result = await pipeline.run(reviewInput);
    const uiLint = result.steps.find((s) => s.step === 'ui-lint');

    expect(uiLint?.skipped).toBe(true);
    expect(uiLint?.error).toBeUndefined();
    expect(result.decision).toBe('pass');
  });
});

describe('Review-Gate: der Claude-Report kann nicht freigeben', () => {
  const enthusiastic: ClaudeReviewer = {
    async review() {
      return { summary: 'sieht sauber aus, kann deployen', findings: [] };
    },
  };

  it('gibt nicht frei, wenn nur der Claude-Report gelaufen ist', async () => {
    const pipeline = createPipeline([claudeReportStep(enthusiastic)]);

    const result = await pipeline.run(reviewInput);

    expect(result.decision).toBe('blocked');
    expect(result.summary).toContain('kein deterministischer Schritt');
  });

  it('gibt nicht frei, wenn die Scanner scheitern und der Report begeistert ist', async () => {
    const pipeline = createPipeline([
      gitleaksStep(createBrokenScanner()),
      semgrepStep(createBrokenScanner()),
      claudeReportStep(enthusiastic),
    ]);

    const result = await pipeline.run(reviewInput);

    expect(result.decision).toBe('blocked');
  });

  it('kann auch nicht blockieren: ein alarmierter Report wird zu einem Hinweis', async () => {
    const alarmed: ClaudeReviewer = {
      async review() {
        return {
          summary: 'ich halte das fuer unsicher',
          findings: [
            {
              step: 'claude-report',
              severity: 'blocking',
              code: 'claude.vibe',
              message: 'fuehlt sich falsch an',
            },
          ],
        };
      },
    };

    const pipeline = createPipeline([
      gitleaksStep(createCleanScanner('gitleaks')),
      semgrepStep(createCleanScanner('semgrep')),
      claudeReportStep(alarmed),
    ]);

    const result = await pipeline.run(reviewInput);

    expect(result.decision).toBe('pass');
    expect(result.findings.map((f) => f.severity)).toContain('warning');
    expect(result.blockingFindings).toHaveLength(0);
  });

  it('zaehlt einen advisory-Befund auch dann nicht als blockierend, wenn er so gemeldet wird', () => {
    const steps: readonly StepResult[] = [
      { step: 'gitleaks', kind: 'deterministic', findings: [] },
      {
        step: 'claude-report',
        kind: 'advisory',
        findings: [
          {
            step: 'claude-report',
            severity: 'blocking',
            code: 'claude.vibe',
            message: 'fuehlt sich falsch an',
          },
        ],
      },
    ];

    const result = mergeReview(steps, '2026-11-09T00:00:00.000Z');

    expect(result.decision).toBe('pass');
    expect(result.blockingFindings).toHaveLength(0);
  });
});

describe('Review-Gate: Tool-Paritaet und Manifest-Abgleich', () => {
  it('blockiert eine UI-Aktion ohne MCP-Tool', async () => {
    const pipeline = createDefaultPipeline({
      gatewayLint: testLabelLint(),
      gitleaks: createCleanScanner('gitleaks'),
      semgrep: createCleanScanner('semgrep'),
    });

    const result = await pipeline.run({ ...reviewInput, uiActions: ['projects.delete'] });

    expect(result.decision).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.code)).toContain('parity.missing_tool');
  });

  it('blockiert eine Tabelle, die im Code steht und nicht im Manifest', async () => {
    const pipeline = createDefaultPipeline({
      gatewayLint: testLabelLint(),
      gitleaks: createCleanScanner('gitleaks'),
      semgrep: createCleanScanner('semgrep'),
    });

    const result = await pipeline.run({
      ...reviewInput,
      codeFacts: { tables: ['heimliche_tabelle'], tools: [], envVars: [] },
    });

    expect(result.decision).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.code)).toContain('manifest.undeclared_table');
  });
});

describe('Deploy kommt nicht am Gate vorbei', () => {
  it('deployt nicht, wenn das Gate blockiert, und haelt den Befund am Deployment fest', async () => {
    const harness = createHarness({
      pipeline: createDefaultPipeline({
        gatewayLint: testLabelLint(),
        gitleaks: createFixedScanner({ exitCode: 1, stdout: GITLEAKS_SECRET_REPORT }),
        semgrep: createCleanScanner('semgrep'),
      }),
    });
    await seedBootstrapGrants(harness);

    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'mit-secret',
      manifest: manifest('mit-secret'),
    });

    await expect(
      requestDeploy(harness.ctx, {
        actor: admin,
        appIdOrName: app.name,
        version: '1.0.0',
        gitSha: 'abcdef1',
        repoDir: '/tmp/mit-secret',
        codeFacts: { tables: ['items'], tools: ['mit-secret.list'], envVars: [] },
      }),
    ).rejects.toBeInstanceOf(ReviewBlockedError);

    // Das Backend wurde nie gerufen.
    expect(harness.backend.calls.filter((c) => c.method === 'deploy')).toHaveLength(0);

    const deployments = await harness.ctx.deployments.listByApp(app.id);
    expect(deployments[0]?.status).toBe('blocked');
    expect(deployments[0]?.reviewDecision).toBe('blocked');
  });

  it('deployt, wenn das Gate freigibt, und setzt die Deployment-Zeiger', async () => {
    const harness = createHarness({
      appsDomain: 'apps.test',
      pipeline: createDefaultPipeline({
        gatewayLint: testLabelLint(),
        gitleaks: createCleanScanner('gitleaks'),
        semgrep: createCleanScanner('semgrep'),
      }),
    });
    await seedBootstrapGrants(harness);

    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'sauber',
      manifest: manifest('sauber'),
    });

    const outcome = await requestDeploy(harness.ctx, {
      actor: admin,
      appIdOrName: app.name,
      version: '1.0.0',
      gitSha: 'abcdef1',
      repoDir: '/tmp/sauber',
      uiActions: ['sauber.list'],
      codeFacts: { tables: ['items'], tools: ['sauber.list'], envVars: [] },
    });

    expect(outcome.review.decision).toBe('pass');
    expect(outcome.deployment.status).toBe('live');

    const stored = await harness.ctx.apps.findById(app.id);
    expect(stored?.currentDeploymentId).toBe(outcome.deployment.id);

    // Die App wurde im Backend angelegt, bekam ihre Env und wurde hinter das
    // Gateway gestellt — in dieser Reihenfolge, und erst danach deployt. Zum
    // Schluss liest der Label-Lint zurueck, was wirklich an ihr steht.
    expect(harness.backend.calls.map((c) => c.method)).toEqual([
      'createApp',
      'setEnv',
      'ensureGateway',
      'deploy',
      'readGatewayLabels',
    ]);
    expect(outcome.gateway.state).toBe('clean');

    // Die Env traegt genau das, womit @openapps/sdk rechnet (ADR 0004).
    const envKeys = harness.backend.calls.find((c) => c.method === 'setEnv')?.args[1];
    expect(envKeys).toEqual([
      'DATABASE_URL',
      'DATABASE_SCHEMA',
      'OPENAPPS_APP_ID',
      'OPENAPPS_APP_HOST',
      'OPENAPPS_APP_BASE_PATH',
      'OPENAPPS_AUTH_SECRET',
    ]);
  });
});

describe('mit echten Scannern', () => {
  // Diese Faelle brauchen gitleaks und semgrep als Prozess plus das Test-Repo
  // mit dem absichtlich eingebauten Secret (docs/03-dod.md, Regel zu DoD 4).
  it.todo('gitleaks findet das Secret im Test-Repo und das Gate blockiert');
  it.todo('semgrep findet den eingebauten Befund der Sicherheits-Regelmenge');
  it.todo('der UI-Linter des UI-Agents blockiert einen eigenen Farbwert');
  it.todo('der Claude-Report laeuft gegen einen echten Schluessel und bleibt advisory');
});
