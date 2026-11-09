/**
 * Der Konfigurations-Lint, vor und nach dem Deploy (ADR 0008; vorher der
 * Label-Lint aus Spec Woche 1, Abschnitt 1).
 *
 * Geprueft werden die riskanten Pfade, nicht der gluecklich verlaufende:
 *
 * - **Vor** dem Deploy: was passiert, wenn die Ableitung scheitert oder die
 *   erzeugte Konfiguration ihre Bedeutung verloren hat. Dass eine saubere
 *   Konfiguration freigibt, steht als ein Fall dabei — mehr Gewicht hat er
 *   nicht, denn diese Pruefung ist zum Teil eine gegen sich selbst (Kommentar
 *   in `steps/gateway-config.ts`). Dass **kein** Router ohne Middlewares
 *   entstehen kann, steht in `gateway-config.spec.ts`.
 * - **Nach** dem Deploy: der Teil, der messen kann. Zwei Richtungen: die Datei
 *   auf dem Host und die Frage, ob Coolify der App einen eigenen Router
 *   gegeben hat (ADR 0008 — der gefaehrliche Fall, seit der Schutz nicht mehr
 *   am Entrypoint haengt).
 */

import { describe, expect, it } from 'vitest';
import { parseCoolifyLabels } from '../src/adapters/coolify';
import { createApp, ownRouterProblems, requestDeploy } from '../src/domain';
import { ReviewBlockedError } from '../src/domain/errors';
import {
  createDefaultPipeline,
  createPipeline,
  gatewayConfigStep,
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
  testGatewaySettings,
} from './helpers';

const APP = 'projektliste';
const DOMAIN = 'apps.test';

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

function withPortEnv(value: string): AppManifest {
  const base = emptyManifest(APP);
  return {
    ...base,
    env: [
      { name: 'PORT', secret: false, description: 'Port der App', required: true, default: value },
    ],
  };
}

async function findingsOf(input: ReviewInput) {
  return gatewayConfigStep(testGatewaySettings()).run(input);
}

describe('Konfigurations-Lint vor dem Deploy: der Schritt im Review-Gate', () => {
  it('gibt eine saubere Konfiguration frei', async () => {
    const result = await findingsOf(baseInput);

    expect(result.findings).toEqual([]);
    expect(result.error).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(result.kind).toBe('deterministic');
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

    // Der Generator weist sie ab, statt sie zu schreiben — der Schritt macht
    // daraus einen Befund und keinen Fehler.
    expect(result.findings.map((f) => f.code)).toEqual(['gateway.config_rejected']);
    expect(result.error).toBeUndefined();
  });

  it('blockiert einen App-Namen, der als Router-Name nicht traegt', async () => {
    const result = await findingsOf({
      ...baseInput,
      gateway: { appName: 'nicht gueltig!', domain: DOMAIN },
    });

    expect(result.findings.map((f) => f.code)).toEqual(['gateway.unsafe_app_name']);
  });

  it('blockiert eine Forward-Auth-Adresse, die keine Adresse ist', async () => {
    const step = gatewayConfigStep({ ...testGatewaySettings(), forwardAuthAddress: 'nirgendwo' });
    const result = await step.run(baseInput);

    expect(result.findings.map((f) => f.code)).toEqual(['gateway.config_rejected']);
  });

  it('blockiert einen veroeffentlichten Host-Port (Spec 3.3)', async () => {
    const result = await findingsOf({
      ...baseInput,
      codeFacts: { ...baseInput.codeFacts, publishedPorts: ['8080:3000'] },
    });

    expect(result.findings.map((f) => f.code)).toContain('gateway.published_port');
  });

  it('blockiert ein zweites Docker-Netz neben dem Gateway-Netz (Spec 3.3)', async () => {
    const step = gatewayConfigStep(testGatewaySettings(), { gatewayNetwork: 'coolify' });
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

  it('blockiert, wenn gar kein Gateway-Ziel im Review-Eingang steht', async () => {
    const pipeline = createPipeline([gatewayConfigStep(testGatewaySettings())]);
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
      gatewaySettings: { ...testGatewaySettings(), denyBackendUrl: 'kein-backend' },
    });

    const result = await pipeline.run(baseInput);

    expect(result.decision).toBe('blocked');
    expect(result.blockingFindings.map((f) => f.code)).toContain('gateway.config_rejected');
  });

  it('ein blockierter Deploy ruft das Backend nie und schreibt keine Konfiguration', async () => {
    const harness = createHarness({
      appsDomain: DOMAIN,
      pipeline: createDefaultPipeline({
        gitleaks: createCleanScanner('gitleaks'),
        semgrep: createCleanScanner('semgrep'),
        gatewaySettings: { ...testGatewaySettings(), forwardAuthAddress: 'nirgendwo' },
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
    expect(harness.gatewayConfig.published).toEqual([]);
    const deployments = await harness.ctx.deployments.listByApp(app.id);
    expect(deployments[0]?.status).toBe('blocked');
  });
});

/* -------------------------------------------------------------------------- */

describe('Konfigurations-Lint nach dem Deploy: gemessen, nicht abgeleitet', () => {
  function cleanHarness(options: Parameters<typeof createHarness>[0] = {}) {
    return createHarness({
      appsDomain: DOMAIN,
      pipeline: createDefaultPipeline({
        gitleaks: createCleanScanner('gitleaks'),
        semgrep: createCleanScanner('semgrep'),
        gatewaySettings: testGatewaySettings(),
      }),
      ...options,
    });
  }

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

  it('alles stimmt: das Deployment ist sauber und kein Alarm steht offen', async () => {
    const harness = cleanHarness();
    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('clean');
    expect(outcome.deployment.status).toBe('live');
    expect(harness.alarms.open()).toEqual([]);

    const entry = harness.store.auditEntries.find((e) => e.action === 'gateway_config_lint');
    expect(entry?.outcome).toBe('allowed');
    expect(entry?.detail.state).toBe('clean');
  });

  it('die Datei auf dem Host weicht ab: Befund, Audit-Eintrag, degraded, Alarm', async () => {
    const harness = cleanHarness({
      gatewayVerification: {
        state: 'mismatch',
        problems: ['openapps.yaml weicht in Zeile 12 ab'],
      },
    });

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('finding');
    expect(outcome.gateway).toMatchObject({ problems: ['openapps.yaml weicht in Zeile 12 ab'] });
    // Der Deploy ist gelaufen und laesst sich nicht ungeschehen machen — aber
    // er gilt nicht als sauber.
    expect(outcome.deployment.status).toBe('degraded');

    const entry = harness.store.auditEntries.find((e) => e.action === 'gateway_config_lint');
    expect(entry?.outcome).toBe('error');
    expect(entry?.reason).toContain('Zeile 12');

    // Und er ist sichtbar, ohne das Audit-Log zu lesen (/healthz).
    expect(harness.alarms.open()).toHaveLength(1);
    expect(harness.alarms.open()[0]?.kind).toBe('gateway_config');
    expect(harness.alarms.open()[0]?.subject).toBe(`app:${APP}`);
  });

  it('Coolify hat der App eigene Traefik-Labels gegeben: Befund', async () => {
    const harness = cleanHarness({
      appGatewayFacts: {
        labels: { 'traefik.http.routers.fremd.rule': 'Host(`sslip.io`)' },
      },
    });

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('finding');
    if (outcome.gateway.state === 'finding') {
      expect(outcome.gateway.problems.join(' ')).toContain('eigene Traefik-Labels');
    }
    expect(outcome.deployment.status).toBe('degraded');
    expect(harness.alarms.open()).toHaveLength(1);
  });

  it('Coolify hat der App eine Domain oder einen Host-Port gegeben: Befund', async () => {
    const harness = cleanHarness({
      appGatewayFacts: { portsMappings: '8080:3000', domains: 'http://1.2.3.4.sslip.io' },
    });

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('finding');
    if (outcome.gateway.state === 'finding') {
      expect(outcome.gateway.problems).toHaveLength(2);
      expect(outcome.gateway.problems.join(' ')).toContain('Host-Port');
      expect(outcome.gateway.problems.join(' ')).toContain('Domain');
    }
  });

  it('Backend nicht erreichbar: kein Befund, aber sichtbar', async () => {
    const harness = cleanHarness({ appGatewayFacts: 'unreachable' });

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('unreachable');
    // „Wir wissen nichts" ist kein Befund: Das Deployment bleibt live und es
    // geht kein Alarm los (dasselbe Muster wie in gateway-guard.ts).
    expect(outcome.deployment.status).toBe('live');
    expect(harness.alarms.open()).toEqual([]);

    const entry = harness.store.auditEntries.find((e) => e.action === 'gateway_config_lint');
    expect(entry?.outcome).toBe('allowed');
    expect(entry?.detail.state).toBe('unreachable');
  });

  it('Datei nicht lesbar: kein Befund', async () => {
    const harness = cleanHarness({
      gatewayVerification: { state: 'unreachable', reason: 'openapps.yaml nicht lesbar' },
    });

    const { outcome } = await deploy(harness);

    expect(outcome.gateway.state).toBe('unreachable');
    expect(outcome.deployment.status).toBe('live');
    expect(harness.alarms.open()).toEqual([]);
  });

  it('Datei nicht schreibbar: der Deploy laeuft nicht an', async () => {
    const harness = createHarness({
      appsDomain: DOMAIN,
      pipeline: createDefaultPipeline({
        gitleaks: createCleanScanner('gitleaks'),
        semgrep: createCleanScanner('semgrep'),
        gatewaySettings: testGatewaySettings(),
      }),
      gatewayPublishFailsWith: 'EACCES: /traefik/dynamic ist nicht beschreibbar',
    });

    await expect(deploy(harness)).rejects.toThrow('EACCES');
    // Kein Deploy ohne Router: Die App waere sonst im Backend, aber nicht am
    // Gateway — und ein Redeploy wuerde sie dort finden.
    expect(harness.backend.calls.map((c) => c.method)).not.toContain('deploy');
  });
});

/* -------------------------------------------------------------------------- */

describe('was Coolify der App selbst gegeben hat', () => {
  const app = { name: APP };

  it('nichts: kein Befund', () => {
    expect(ownRouterProblems(app, { labels: {}, portsMappings: '', domains: '' })).toEqual([]);
  });

  it('fremde Labels, die nichts mit Traefik zu tun haben, sind kein Befund', () => {
    expect(
      ownRouterProblems(app, {
        labels: { 'coolify.managed': 'true', 'org.opencontainers.image.title': 'x' },
        portsMappings: '',
        domains: '',
      }),
    ).toEqual([]);
  });

  it('eine Traefik-Label in beliebiger Schreibweise ist ein Befund', () => {
    expect(
      ownRouterProblems(app, {
        labels: { ' TRAEFIK.enable': 'true' },
        portsMappings: '',
        domains: '',
      }),
    ).toHaveLength(1);
  });

  it('Leerzeichen als ports_mappings ist kein Port', () => {
    expect(ownRouterProblems(app, { labels: {}, portsMappings: '  ', domains: '' })).toEqual([]);
  });
});

describe('Labels zurueckgelesen: das Format des Deploy-Backends', () => {
  it('liest key=value je Zeile', () => {
    expect(parseCoolifyLabels('coolify.managed=true\ntraefik.enable=true')).toEqual({
      'coolify.managed': 'true',
      'traefik.enable': 'true',
    });
  });

  it('liest denselben Satz auch base64-kodiert, wie manche Version ihn liefert', () => {
    const plain = 'traefik.enable=true\ntraefik.http.services.a.loadbalancer.server.port=3000';
    const encoded = Buffer.from(plain, 'utf8').toString('base64');

    expect(parseCoolifyLabels(encoded)).toEqual(parseCoolifyLabels(plain));
  });

  it('macht aus einem leeren Satz keinen Fehler, sondern einen leeren Satz', () => {
    expect(parseCoolifyLabels('')).toEqual({});
  });
});
