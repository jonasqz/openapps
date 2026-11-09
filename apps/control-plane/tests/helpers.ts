/**
 * Gemeinsame Hülle für die Tests: ein `DomainContext` ganz im Prozess.
 *
 * Alles, was echte Infrastruktur braucht (Postgres, Coolify, Scanner-Prozesse),
 * steckt hinter einem Anschluss und wird hier durch ein Double ersetzt. Was
 * dabei **nicht** ersetzt wird, ist die Domaenenlogik — und genau sie wird
 * geprueft.
 */

import { systemClock, uuidIds, type DomainContext } from '../src/domain';
import { createPipeline } from '../src/domain/review-gate';
import type { ReviewPipeline, ReviewStep } from '../src/domain/review-gate/types';
import {
  createRecordingBackend,
  createRecordingProvisioner,
  createRecordingRepositoryBackend,
  type RecordingBackend,
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
}): Harness {
  const store = createMemoryStore();
  const backend = createRecordingBackend();
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
    repositories,
    reviewGate: options?.pipeline ?? createPipeline(options?.steps ?? []),
    provisioner,
    authMasterSecret: TEST_MASTER_SECRET,
    ...(options?.baseDomain === undefined ? {} : { baseDomain: options.baseDomain }),
  };

  return { ctx, store, backend, provisioner, repositories };
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
