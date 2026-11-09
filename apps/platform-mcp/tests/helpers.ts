/**
 * Hülle für die MCP-Tests: derselbe `DomainContext` wie in der Control Plane,
 * nur mit Speicher im Prozess und Doubles für Postgres und Deploy-Backend.
 */

import { systemClock, uuidIds, type Actor, type DomainContext } from '@openapps/control-plane/domain';
import { createPipeline } from '@openapps/control-plane/review-gate';
import {
  createRecordingBackend,
  createRecordingProvisioner,
} from '@openapps/control-plane/infra/memory/doubles';
import { createMemoryStore, type MemoryStore } from '@openapps/control-plane/infra/memory';
import type { AppToolInvoker } from '../src/app-tools';

export interface Harness {
  readonly ctx: DomainContext;
  readonly store: MemoryStore;
}

export function createHarness(): Harness {
  const store = createMemoryStore();
  const ctx: DomainContext = {
    apps: store.apps,
    deployments: store.deployments,
    grants: store.grants,
    audit: store.audit,
    agents: store.agents,
    clock: systemClock,
    ids: uuidIds,
    backend: createRecordingBackend(),
    reviewGate: createPipeline([]),
    provisioner: createRecordingProvisioner(),
  };
  return { ctx, store };
}

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

export interface CountingInvoker extends AppToolInvoker {
  readonly calls: readonly { appName: string; toolName: string; actorId: string }[];
}

export function createCountingInvoker(): CountingInvoker {
  const calls: { appName: string; toolName: string; actorId: string }[] = [];
  return {
    calls,
    async invoke({ app, toolName, actor }) {
      calls.push({ appName: app.name, toolName, actorId: actor.id });
      return { rows: [] };
    },
  };
}
