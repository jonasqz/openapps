/**
 * Gemeinsame Hülle für die Tests: ein `DomainContext` ganz im Prozess.
 *
 * Alles, was echte Infrastruktur braucht (Postgres, Coolify, Scanner-Prozesse),
 * steckt hinter einem Anschluss und wird hier durch ein Double ersetzt. Was
 * dabei **nicht** ersetzt wird, ist die Domaenenlogik — und genau sie wird
 * geprueft.
 */

import { createTraefikLabelLint } from '../src/adapters/coolify';
import { systemClock, uuidIds, type DomainContext } from '../src/domain';
import type { GatewayLabelLint } from '../src/domain/ports';
import { createPipeline } from '../src/domain/review-gate';
import type { ReviewPipeline, ReviewStep } from '../src/domain/review-gate/types';
import {
  createRecordingAlarmSink,
  createRecordingBackend,
  createRecordingProvisioner,
  createRecordingRepositoryBackend,
  type RecordingAlarmSink,
  type RecordingBackend,
  type RecordingBackendOptions,
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
}

/**
 * Der echte Label-Lint des Adapters. Absichtlich nicht gestubbt: Was
 * „vollstaendig" heisst, soll in den Tests dasselbe heissen wie im Betrieb.
 * Die Adresse ist dieselbe wie in `.env.example`.
 */
export const TEST_FORWARD_AUTH_URL = 'http://127.0.0.1:8090/api/authz/forward';

export function testLabelLint(): GatewayLabelLint {
  return createTraefikLabelLint(TEST_FORWARD_AUTH_URL);
}

/**
 * Master-Secret der Tests. Lang genug fuer die Mindestlaenge des SDK, und
 * sichtbar ein Testwert — kein echtes Secret im Repo.
 */
export const TEST_MASTER_SECRET = 'test-master-secret-nur-fuer-tests-0123456789';

export function createHarness(options?: {
  steps?: readonly ReviewStep[];
  pipeline?: ReviewPipeline;
  baseDomain?: string;
  repositoryFailsWith?: string;
  /** Was das Backend nach dem Deploy zurueckliest. Default: der echte Satz. */
  gatewayLabels?: RecordingBackendOptions['gatewayLabels'];
}): Harness {
  const store = createMemoryStore();
  const lint = testLabelLint();
  const backend = createRecordingBackend({
    lint,
    ...(options?.gatewayLabels === undefined ? {} : { gatewayLabels: options.gatewayLabels }),
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
    audit: store.audit,
    agents: store.agents,
    clock: systemClock,
    ids: uuidIds,
    backend,
    gatewayLint: lint,
    repositories,
    reviewGate: options?.pipeline ?? createPipeline(options?.steps ?? []),
    provisioner,
    authMasterSecret: TEST_MASTER_SECRET,
    alarms,
    ...(options?.baseDomain === undefined ? {} : { baseDomain: options.baseDomain }),
  };

  return { ctx, store, backend, provisioner, repositories, alarms };
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
