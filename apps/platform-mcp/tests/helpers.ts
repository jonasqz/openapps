/**
 * Hülle für die MCP-Tests: derselbe `DomainContext` wie in der Control Plane,
 * nur mit Speicher im Prozess und Doubles für Postgres und Deploy-Backend.
 */

import {
  systemClock,
  uuidIds,
  type Actor,
  type DomainContext,
} from '@openapps/control-plane/domain';
import { createPipeline } from '@openapps/control-plane/review-gate';
import {
  createRecordingBackend,
  createRecordingGatewayConfigStore,
  createRecordingProvisioner,
  createRecordingRepositoryBackend,
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
    // Die Gateway-Konfiguration gehoert zum Kontext, seit die Control Plane
    // sie selbst schreibt (ADR 0008). Hier ein Double, das sich merkt, was
    // veroeffentlicht wurde.
    gatewayConfig: createRecordingGatewayConfigStore(),
    gatewaySettings: {
      forwardAuthAddress: 'http://openapps-control-plane:3000/api/authz/forward',
      denyBackendUrl: 'http://openapps-deny-backend:8080',
      entryPoint: 'https',
      certResolver: 'letsencrypt',
    },
    repositories: createRecordingRepositoryBackend(),
    reviewGate: createPipeline([]),
    provisioner: createRecordingProvisioner(),
    authMasterSecret: TEST_MASTER_SECRET,
  };
  return { ctx, store };
}

export const TEST_MASTER_SECRET = 'test-master-secret-nur-fuer-tests-0123456789';

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
