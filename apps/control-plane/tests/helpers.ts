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
  type RecordingBackend,
  type RecordingProvisioner,
} from '../src/infra/memory/doubles';
import { createMemoryStore, type MemoryStore } from '../src/infra/memory/repositories';
import type { Actor, AppManifest, CatalogSource } from '../src/domain/types';

export interface Harness {
  readonly ctx: DomainContext;
  readonly store: MemoryStore;
  readonly backend: RecordingBackend;
  readonly provisioner: RecordingProvisioner;
}

export function createHarness(options?: {
  steps?: readonly ReviewStep[];
  pipeline?: ReviewPipeline;
  baseDomain?: string;
}): Harness {
  const store = createMemoryStore();
  const backend = createRecordingBackend();
  const provisioner = createRecordingProvisioner();

  const ctx: DomainContext = {
    apps: store.apps,
    deployments: store.deployments,
    grants: store.grants,
    audit: store.audit,
    agents: store.agents,
    clock: systemClock,
    ids: uuidIds,
    backend,
    reviewGate: options?.pipeline ?? createPipeline(options?.steps ?? []),
    provisioner,
    ...(options?.baseDomain === undefined ? {} : { baseDomain: options.baseDomain }),
  };

  return { ctx, store, backend, provisioner };
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

export function manifest(name: string, version = '1.0.0'): AppManifest {
  return {
    name,
    displayName: name,
    version,
    tables: [{ name: 'items' }],
    tools: [{ name: `${name}.list` }],
    env: [],
  };
}

export function gitSource(name: string): CatalogSource {
  return { kind: 'git', url: `https://example.invalid/${name}.git`, ref: 'main' };
}
