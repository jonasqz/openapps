/**
 * Der Label-Lint, vor und nach dem Deploy (Spec `docs/specs/woche-1-forward-auth.md`,
 * Abschnitt 1 Bausteintabelle, Abschnitt 2 Fehlerfalltabelle, Abschnitt 3.3).
 *
 * Geprueft werden die riskanten Pfade, nicht der gluecklich verlaufende:
 *
 * - **Vor** dem Deploy: was passiert, wenn die Ableitung scheitert oder der
 *   Label-Satz seine Bedeutung verloren hat. Dass ein vollstaendiger Satz
 *   freigibt, steht als ein Fall dabei — mehr Gewicht hat er nicht, denn diese
 *   Pruefung ist zum Teil eine gegen sich selbst (Kommentar in
 *   `steps/gateway-labels.ts`).
 * - **Nach** dem Deploy: der Teil, der messen kann. Hier liegt der Fall, der
 *   im Gateway-Lauf wirklich eingetreten ist (alle Traefik-Labels weg), und
 *   die Unterscheidung „Backend nicht erreichbar" gegen „gelesen und falsch".
 */

import { describe, expect, it } from 'vitest';
import { parseCoolifyLabels } from '../src/adapters/coolify';
import { createApp, requestDeploy } from '../src/domain';
import { ReviewBlockedError } from '../src/domain/errors';
import type { GatewayLabelLint, GatewayLabelPlan, GatewayTarget } from '../src/domain/ports';
import {
  createDefaultPipeline,
  createPipeline,
  gatewayLabelsStep,
  GATEWAY_LABELS_STEP,
} from '../src/domain/review-gate';
import type { ReviewInput } from '../src/domain/review-gate/types';
import type { AppManifest } from '../src/domain/types';
import { createCleanScanner } from '../src/infra/memory/doubles';
import {
  admin,
  createHarness,
  emptyManifest,
  manifest,
  seedBootstrapGrants,
  testLabelLint,
} from './helpers';

const APP = 'projektliste';
const DOMAIN = `${APP}.apps.test`;

const baseInput: ReviewInput = {
  appId: 'app-1',
  deploymentId: 'dep-1',
  version: '1.0.0',
  gitSha: 'abcdef1',
  repoDir: '/tmp/does-not-matter',
  manifest: emptyManifest(APP),
  uiActions: [],
  // Erhoben und leer — das ist die Aussage „kein veroeffentlichter Port, nur
  // das Gateway-Netz" und nicht „nicht nachgesehen".
  codeFacts: { tables: [], tools: [], envVars: [], publishedPorts: [], dockerNetworks: [] },
  gateway: { appName: APP, domain: DOMAIN },
};

/** Ein Lint, dessen Plan an einer Stelle seine Bedeutung verloren hat. */
function brokenLint(
  part: 'port' | 'auth' | 'strip' | 'host' | 'chain' | 'throws',
): GatewayLabelLint {
  const real = testLabelLint();
  return {
    plan(target: GatewayTarget): GatewayLabelPlan {
      const plan = real.plan(target);
      switch (part) {
        case 'port':
          return { ...plan, servicePort: undefined };
        case 'auth':
          return { ...plan, forwardsAuth: false, forwardAuthAddress: undefined };
        case 'strip':
          return { ...plan, stripsIdentityHeaders: false };
        case 'host':
          return { ...plan, hostRule: 'Host(`fremde.domain.test`)' };
        case 'chain':
          return { ...plan, middlewares: [...plan.middlewares, 'fremde-middleware@docker'] };
        case 'throws':
          throw new Error('Label-Setter kaputt');
      }
    },
    missing: (actual, target) => real.missing(actual, target),
  };
}

function withPortEnv(value: string): AppManifest {
  const base = emptyManifest(APP);
  return {
    ...base,
    env: [
      { name: 'PORT', secret: false, description: 'Port der App', required: true, default: value },
    ],
  };
}

async function findingsOf(input: ReviewInput, lint: GatewayLabelLint = testLabelLint()) {
  const result = await gatewayLabelsStep(lint).run(input);
  return result;
}

describe('Label-Lint vor dem Deploy: der Schritt im Review-Gate', () => {
  it('gibt den vollstaendigen Satz frei', async () => {
    const result = await findingsOf(baseInput);

    expect(result.findings).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(result.kind).toBe('deterministic');
  });

  it('blockiert, wenn das Port-Label fehlt', async () => {
    const result = await findingsOf(baseInput, brokenLint('port'));

    expect(result.findings.map((f) => f.code)).toContain('gateway.missing_port_label');
    expect(result.findings.every((f) => f.severity === 'blocking')).toBe(true);
  });

  it('blockiert, wenn die Forward-Auth-Middleware fehlt', async () => {
    const result = await findingsOf(baseInput, brokenLint('auth'));

    expect(result.findings.map((f) => f.code)).toContain('gateway.missing_forward_auth');
  });

  it('blockiert, wenn die Strip-Middleware fehlt — sonst schickt der Client seine Identitaet selbst', async () => {
    const result = await findingsOf(baseInput, brokenLint('strip'));

    expect(result.findings.map((f) => f.code)).toContain('gateway.missing_strip');
  });

  it('blockiert eine Host-Regel, die nicht die Domain dieser App nennt', async () => {
    const result = await findingsOf(baseInput, brokenLint('host'));

    expect(result.findings.map((f) => f.code)).toContain('gateway.missing_host_rule');
  });

  it('blockiert eine fremde Middleware am Router — Spec 2, "Middleware-Reihenfolge vertauscht"', async () => {
    const result = await findingsOf(baseInput, brokenLint('chain'));

    expect(result.findings.map((f) => f.code)).toContain('gateway.unexpected_middlewares');
  });

  it('blockiert einen unbrauchbaren Port aus dem Manifest', async () => {
    const result = await findingsOf({ ...baseInput, manifest: withPortEnv('dreitausend') });

    expect(result.findings.map((f) => f.code)).toEqual(['gateway.invalid_port']);
  });

  it('nimmt einen gueltigen Port aus dem Manifest an', async () => {
    const result = await findingsOf({ ...baseInput, manifest: withPortEnv('8080') });

    expect(result.findings).toEqual([]);
  });

  it('blockiert, wenn die App keine Domain hat', async () => {
    const result = await findingsOf({ ...baseInput, gateway: { appName: APP, domain: null } });

    expect(result.findings.map((f) => f.code)).toEqual(['gateway.missing_domain']);
  });

  it('blockiert eine Domain, die die Host-Regel verlassen koennte', async () => {
    const result = await findingsOf({
      ...baseInput,
      gateway: { appName: APP, domain: 'a.test`) || Host(`fremd.test' },
    });

    expect(result.findings.map((f) => f.code)).toEqual(['gateway.unsafe_domain']);
  });

  it('blockiert einen veroeffentlichten Host-Port (Spec 3.3)', async () => {
    const result = await findingsOf({
      ...baseInput,
      codeFacts: { ...baseInput.codeFacts, publishedPorts: ['8080:3000'] },
    });

    expect(result.findings.map((f) => f.code)).toContain('gateway.published_port');
  });

  it('blockiert ein zweites Docker-Netz neben dem Gateway-Netz (Spec 3.3)', async () => {
    const step = gatewayLabelsStep(testLabelLint(), { gatewayNetwork: 'coolify' });
    const result = await step.run({
      ...baseInput,
      codeFacts: { ...baseInput.codeFacts, dockerNetworks: ['coolify', 'eigenes-netz'] },
    });

    expect(result.findings.map((f) => f.code)).toEqual(['gateway.extra_network']);
  });

  it('blockiert ein Manifest, das Labels oder Ports selbst setzen will', async () => {
    const result = await findingsOf({
      ...baseInput,
      manifest: {
        ...emptyManifest(APP),
        env: [
          {
            name: 'TRAEFIK_HTTP_ROUTERS_EIGEN_RULE',
            secret: false,
            description: 'eigener Router',
            required: true,
          },
        ],
      },
    });

    expect(result.findings.map((f) => f.code)).toContain('gateway.manifest_sets_infrastructure');
  });

  it('meldet nicht erhobene Container-Tatsachen als Hinweis, nicht als Sperre', async () => {
    const result = await findingsOf({
      ...baseInput,
      codeFacts: { tables: [], tools: [], envVars: [] },
    });

    const facts = result.findings.filter((f) => f.code === 'gateway.container_facts_unknown');
    expect(facts).toHaveLength(1);
    expect(facts[0]?.severity).toBe('warning');
    expect(result.findings.some((f) => f.severity === 'blocking')).toBe(false);
  });

  it('blockiert, wenn der Schritt selbst scheitert — und ueberspringt ihn nicht', async () => {
    const pipeline = createPipeline([gatewayLabelsStep(brokenLint('throws'))]);

    const result = await pipeline.run(baseInput);
    const step = result.steps.find((s) => s.step === GATEWAY_LABELS_STEP);

    expect(step?.error).toContain('Label-Setter kaputt');
    expect(step?.skipped).toBeUndefined();
    expect(result.decision).toBe('blocked');
    expect(result.summary).toContain(GATEWAY_LABELS_STEP);
  });

  it('blockiert, wenn gar kein Gateway-Ziel im Review-Eingang steht', async () => {
    const pipeline = createPipeline([gatewayLabelsStep(testLabelLint())]);
    const { gateway: _ignored, ...withoutTarget } = baseInput;

    const result = await pipeline.run(withoutTarget);

    expect(result.decision).toBe('blocked');
    expect(result.steps[0]?.error).toContain('kein Gateway-Ziel');
    expect(result.steps[0]?.skipped).toBeUndefined();
  });

  it('merge.ts ordnet den Schritt als deterministisch ein — ein Befund blockiert', async () => {
    const pipeline = createDefaultPipeline({
      gitleaks: createCleanScanner('gitleaks'),
      semgrep: createCleanScanner('semgrep'),
      gatewayLint: brokenLint('strip'),
    });

    const result = await pipeline.run(baseInput);

    expect(result.decision).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.code)).toContain('gateway.missing_strip');
  });

  it('ein blockierter Deploy ruft das Backend nie', async () => {
    const harness = createHarness({
      appsDomain: 'apps.test',
      pipeline: createDefaultPipeline({
        gitleaks: createCleanScanner('gitleaks'),
        semgrep: createCleanScanner('semgrep'),
        gatewayLint: brokenLint('auth'),
      }),
    });
    await seedBootstrapGrants(harness);

    const app = await createApp(harness.ctx, {
      actor: admin,
      name: APP,
      manifest: manifest(APP),
    });

    await expect(
      requestDeploy(harness.ctx, {
        actor: admin,
        appIdOrName: app.name,
        version: '1.0.0',
        gitSha: 'abcdef1',
        repoDir: `/tmp/${APP}`,
        codeFacts: { tables: ['items'], tools: [`${APP}.list`], envVars: [] },
      }),
    ).rejects.toBeInstanceOf(ReviewBlockedError);

    expect(harness.backend.calls).toEqual([]);
    const deployments = await harness.ctx.deployments.listByApp(app.id);
    expect(deployments[0]?.status).toBe('blocked');
  });
});

describe('Label-Lint nach dem Deploy: gemessen, nicht abgeleitet', () => {
  async function deploy(harness: ReturnType<typeof createHarness>) {
    await seedBootstrapGrants(harness);
    const app = await createApp(harness.ctx, {
      actor: admin,
      name: APP,
      manifest: manifest(APP),
    });
    const outcome = await requestDeploy(harness.ctx, {
      actor: admin,
      appIdOrName: app.name,
      version: '1.0.0',
      gitSha: 'abcdef1',
      repoDir: `/tmp/${APP}`,
      codeFacts: { tables: ['items'], tools: [`${APP}.list`], envVars: [] },
    });
    return { app, outcome };
  }

  function cleanHarness(
    gatewayLabels?: Parameters<typeof createHarness>[0] extends undefined
      ? never
      : NonNullable<Parameters<typeof createHarness>[0]>['gatewayLabels'],
  ) {
    return createHarness({
      appsDomain: 'apps.test',
      pipeline: createDefaultPipeline({
        gitleaks: createCleanScanner('gitleaks'),
        semgrep: createCleanScanner('semgrep'),
        gatewayLint: testLabelLint(),
      }),
      ...(gatewayLabels === undefined ? {} : { gatewayLabels }),
    });
  }

  it('Labels wie erwartet: das Deployment ist sauber und kein Alarm steht offen', async () => {
    const harness = cleanHarness();
    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('clean');
    expect(outcome.deployment.status).toBe('live');
    expect(harness.alarms.open()).toEqual([]);

    const entry = harness.store.auditEntries.find((e) => e.action === 'gateway_label_lint');
    expect(entry?.outcome).toBe('allowed');
    expect(entry?.detail.state).toBe('clean');
  });

  it('eine Middleware fehlt am Container: Befund, Audit-Eintrag, nicht als sauber markiert', async () => {
    const authAddress = `traefik.http.middlewares.openapps-auth-${APP}.forwardauth.address`;
    const harness = cleanHarness((set) => {
      const copy = { ...set };
      delete copy[authAddress];
      return copy;
    });

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('finding');
    expect(outcome.gateway).toMatchObject({ missing: [authAddress] });
    // Der Deploy ist gelaufen und laesst sich nicht ungeschehen machen — aber
    // er gilt nicht als sauber.
    expect(outcome.deployment.status).toBe('degraded');

    const entry = harness.store.auditEntries.find((e) => e.action === 'gateway_label_lint');
    expect(entry?.outcome).toBe('error');
    expect(entry?.reason).toContain(authAddress);
    expect(entry?.detail.missing).toEqual([authAddress]);

    // Und er ist sichtbar, ohne das Audit-Log zu lesen (/healthz).
    expect(harness.alarms.open()).toHaveLength(1);
    expect(harness.alarms.open()[0]?.kind).toBe('gateway_labels');
    expect(harness.alarms.open()[0]?.subject).toBe(`app:${APP}`);
  });

  it('alle Traefik-Labels weg — der Fall aus dem Gateway-Lauf: Befund', async () => {
    const harness = cleanHarness({});

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('finding');
    if (outcome.gateway.state === 'finding') {
      // Jedes erwartete Label fehlt, nicht nur eines.
      expect(outcome.gateway.missing.length).toBeGreaterThan(5);
    }
    expect(outcome.deployment.status).toBe('degraded');
    expect(harness.alarms.open()).toHaveLength(1);
  });

  it('Backend nicht erreichbar: kein Befund, aber sichtbar', async () => {
    const harness = cleanHarness('unreachable');

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('unreachable');
    // „Wir wissen nichts" ist kein Befund: Das Deployment bleibt live und es
    // geht kein Alarm los (dasselbe Muster wie in gateway-guard.ts).
    expect(outcome.deployment.status).toBe('live');
    expect(harness.alarms.open()).toEqual([]);

    const entry = harness.store.auditEntries.find((e) => e.action === 'gateway_label_lint');
    expect(entry?.outcome).toBe('allowed');
    expect(entry?.detail.state).toBe('unreachable');
    expect(String(entry?.detail.reason)).toContain('nicht erreichbar');
  });
});

describe('Labels zurueckgelesen: das Format des Deploy-Backends', () => {
  it('liest key=value je Zeile', () => {
    expect(
      parseCoolifyLabels('traefik.enable=true\ntraefik.http.routers.a.rule=Host(`a.test`)'),
    ).toEqual({
      'traefik.enable': 'true',
      'traefik.http.routers.a.rule': 'Host(`a.test`)',
    });
  });

  it('liest denselben Satz auch base64-kodiert, wie manche Version ihn liefert', () => {
    const plain = 'traefik.enable=true\ntraefik.http.services.a.loadbalancer.server.port=3000';
    const encoded = Buffer.from(plain, 'utf8').toString('base64');

    expect(parseCoolifyLabels(encoded)).toEqual(parseCoolifyLabels(plain));
  });

  it('behaelt einen leeren Wert — er loescht einen mitgeschickten Header', () => {
    expect(
      parseCoolifyLabels('traefik.http.middlewares.s.headers.customrequestheaders.X-Auth-User-Id='),
    ).toEqual({ 'traefik.http.middlewares.s.headers.customrequestheaders.X-Auth-User-Id': '' });
  });

  it('macht aus einem leeren Satz keinen Fehler, sondern einen leeren Satz', () => {
    expect(parseCoolifyLabels('')).toEqual({});
  });
});
