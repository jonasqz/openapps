/**
 * Gemeinsame Hülle für die Tests: ein `DomainContext` ganz im Prozess.
 *
 * Alles, was echte Infrastruktur braucht (Postgres, Coolify, Scanner-Prozesse),
 * steckt hinter einem Anschluss und wird hier durch ein Double ersetzt. Was
 * dabei **nicht** ersetzt wird, ist die Domaenenlogik — und genau sie wird
 * geprueft.
 */

import { systemClock, uuidIds, type DomainContext, type GatewaySettings } from '../src/domain';
import { createPipeline } from '../src/domain/review-gate';
import type { ReviewPipeline, ReviewStep } from '../src/domain/review-gate/types';
import {
  createRecordingAlarmSink,
  createRecordingBackend,
  createRecordingGatewayConfigStore,
  createRecordingProvisioner,
  createRecordingRepositoryBackend,
  type RecordingAlarmSink,
  type RecordingBackend,
  type RecordingBackendOptions,
  type RecordingGatewayConfigStore,
  type RecordingGatewayConfigStoreOptions,
  type RecordingProvisioner,
  type RecordingRepositoryBackend,
} from '../src/infra/memory/doubles';
import { createMemoryStore, type MemoryStore } from '../src/infra/memory/repositories';
import type { Actor, AppManifest, ManifestSource } from '../src/domain/types';

export interface Harness {
  readonly ctx: DomainContext;
  readonly store: MemoryStore;
  readonly backend: RecordingBackend;
  readonly provisioner: RecordingProvisioner;
  readonly repositories: RecordingRepositoryBackend;
  readonly alarms: RecordingAlarmSink;
  readonly gatewayConfig: RecordingGatewayConfigStore;
}

/**
 * Die Werte, mit denen die Gateway-Konfiguration in den Tests erzeugt wird.
 * Absichtlich die echten Defaults und kein Stub: Der Generator ist die Stelle,
 * an der das Default-Deny haengt (ADR 0008) — er soll in den Tests dasselbe
 * rechnen wie im Betrieb.
 */
export const TEST_FORWARD_AUTH_URL = 'http://openapps-control-plane:3000/api/authz/forward';

export function testGatewaySettings(): GatewaySettings {
  return {
    forwardAuthAddress: TEST_FORWARD_AUTH_URL,
    denyBackendUrl: 'http://openapps-deny-backend:8080',
    entryPoint: 'https',
    certResolver: 'letsencrypt',
    controlPlane: {
      host: 'control-plane.apps.test',
      url: 'http://openapps-control-plane:3000',
    },
  };
}

/**
 * Master-Secret der Tests. Lang genug fuer die Mindestlaenge des SDK, und
 * sichtbar ein Testwert — kein echtes Secret im Repo.
 */
export const TEST_MASTER_SECRET = 'test-master-secret-nur-fuer-tests-0123456789';

export function createHarness(options?: {
  steps?: readonly ReviewStep[];
  pipeline?: ReviewPipeline;
  appsDomain?: string;
  repositoryFailsWith?: string;
  /** Was das Backend nach dem Deploy ueber die App selbst sagt. */
  appGatewayFacts?: RecordingBackendOptions['appGatewayFacts'];
  /** Was der Konfigurations-Speicher sagt. Default: er stimmt. */
  gatewayVerification?: RecordingGatewayConfigStoreOptions['verification'];
  /** Soll das Schreiben der Konfiguration scheitern? */
  gatewayPublishFailsWith?: string;
}): Harness {
  const store = createMemoryStore();
  const backend = createRecordingBackend(
    options?.appGatewayFacts === undefined ? {} : { appGatewayFacts: options.appGatewayFacts },
  );
  const gatewayConfig = createRecordingGatewayConfigStore({
    ...(options?.gatewayVerification === undefined
      ? {}
      : { verification: options.gatewayVerification }),
    ...(options?.gatewayPublishFailsWith === undefined
      ? {}
      : { publishFailsWith: options.gatewayPublishFailsWith }),
  });
  const alarms = createRecordingAlarmSink();
  const provisioner = createRecordingProvisioner();
  const repositories = createRecordingRepositoryBackend(
    options?.repositoryFailsWith === undefined ? {} : { failWith: options.repositoryFailsWith },
  );

  const ctx: DomainContext = {
    apps: store.apps,
    deployments: store.deployments,
    grants: store.grants,
    groups: store.groups,
    audit: store.audit,
    agents: store.agents,
    clock: systemClock,
    ids: uuidIds,
    backend,
    gatewayConfig,
    gatewaySettings: testGatewaySettings(),
    repositories,
    reviewGate: options?.pipeline ?? createPipeline(options?.steps ?? []),
    provisioner,
    authMasterSecret: TEST_MASTER_SECRET,
    alarms,
    ...(options?.appsDomain === undefined ? {} : { appsDomain: options.appsDomain }),
  };

  return { ctx, store, backend, provisioner, repositories, alarms, gatewayConfig };
}

/** Der Plattform-Administrator: die eine Freigabe aus Migration 0006. */
export const admin: Actor = { kind: 'user', id: 'u-admin', groups: ['platform-admins'] };

export async function seedBootstrapGrants(harness: Harness): Promise<void> {
  for (const verb of ['read', 'write', 'execute'] as const) {
    await harness.store.grants.insert({
      subject: { kind: 'group', id: 'platform-admins' },
      verb,
      resource: { kind: 'app', id: '*' },
      grantedBy: 'system:bootstrap',
    });
  }
  // Migration 0012: dieselbe Gruppe darf Gruppen lesen und pflegen. Kein
  // `execute` — eine Gruppe wird nicht ausgefuehrt.
  for (const verb of ['read', 'write'] as const) {
    await harness.store.grants.insert({
      subject: { kind: 'group', id: 'platform-admins' },
      verb,
      resource: { kind: 'group', id: '*' },
      grantedBy: 'system:bootstrap',
    });
  }
  // Migration 0015: und Agent-Identitaeten anlegen und sperren.
  for (const verb of ['read', 'write'] as const) {
    await harness.store.grants.insert({
      subject: { kind: 'group', id: 'platform-admins' },
      verb,
      resource: { kind: 'agent', id: '*' },
      grantedBy: 'system:bootstrap',
    });
  }
  // Migration 0009 legt diese Gruppe als Zeile an, leer.
  await harness.store.groups.create({
    name: 'platform-admins',
    description: 'Plattform-Administration. Wildcard-Grant aus Migration 0006.',
  });
}

/**
 * Ein gueltiges Manifest nach dem Schema aus `@openapps/app-manifest`. Es wird
 * absichtlich nicht durch `appManifestSchema` geschickt: die Tests sollen an
 * der Domaenenlogik scheitern, nicht an einem Tippfehler im Fixture — und wenn
 * sich das Schema aendert, soll der Typcheck hier anschlagen.
 */
export function manifest(name: string, version = '1.0.0'): AppManifest {
  return {
    manifestVersion: 1,
    name,
    displayName: name,
    description: `Test-App ${name}`,
    category: 'test',
    version,
    requiredTables: [{ name: 'items', description: 'Testtabelle' }],
    offeredTools: [
      {
        name: `${name}.list`,
        description: 'Liste',
        verb: 'read',
        operationId: 'list',
      },
    ],
    requestedGrants: [],
    env: [],
    egress: [],
    source: gitSource(name),
  };
}

/** Ein Manifest ohne Tabellen und ohne Tools — fuer die Pipeline-Tests. */
export function emptyManifest(name: string, version = '1.0.0'): AppManifest {
  return {
    ...manifest(name, version),
    requiredTables: [],
    offeredTools: [],
  };
}

export function gitSource(name: string): ManifestSource {
  return { git: `https://example.invalid/${name}.git`, tag: 'v1.0.0' };
}
