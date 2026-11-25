import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAppManifest } from '@openapps/app-manifest';
import {
  createToolRoute,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type ToolRouteOptions,
} from '@openapps/sdk';
import { ACTIVITY_KINDS, STAGES } from './domain';
import { TOOL_NAMES, toolHandlers } from './tools';

/**
 * Die Tool-Zuordnung: app.json, openapi.yaml und die Route muessen dieselben
 * Tools nennen. Weicht eine Stelle ab, blockiert das Review-Gate ("Manifest
 * passt nicht zum Code") — dieser Test findet es vorher.
 */

const manifestText = readFileSync(new URL('../../app.json', import.meta.url), 'utf8');
const openapiText = readFileSync(new URL('../../openapi.yaml', import.meta.url), 'utf8');

interface SpecOperation {
  path: string;
  operationId?: string;
  verb?: string;
}

/**
 * Liest Pfade, operationId und x-openapps-verb aus openapi.yaml. Bewusst
 * kein YAML-Paket (nur zod ist freigegeben): Die Spec haelt sich an eine
 * feste Einrueckung, und der Test bricht, wenn sie es nicht tut.
 */
function specOperations(text: string): SpecOperation[] {
  const operations: SpecOperation[] = [];
  let current: SpecOperation | undefined;
  let inPaths = false;
  for (const line of text.split('\n')) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (/^\S/.test(line)) inPaths = false;
    if (!inPaths) continue;
    const path = /^ {2}(\/\S+):\s*$/.exec(line);
    if (path?.[1] !== undefined) {
      current = { path: path[1] };
      operations.push(current);
      continue;
    }
    const operationId = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (operationId?.[1] !== undefined && current !== undefined) current.operationId = operationId[1];
    const verb = /^ {6}x-openapps-verb:\s*(\S+)\s*$/.exec(line);
    if (verb?.[1] !== undefined && current !== undefined) current.verb = verb[1];
  }
  return operations;
}

describe('Manifest', () => {
  it('passes the real manifest schema of the platform', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText), 'standard-apps/crm/app.json');
    expect(manifest.name).toBe('crm');
  });

  it('names every table from the migration', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText));
    const sql = readFileSync(new URL('../../migrations/0001_crm.sql', import.meta.url), 'utf8');
    const created = [...sql.matchAll(/^create table (\w+)/gm)].map((match) => match[1]);
    expect(manifest.requiredTables.map((table) => table.name).sort()).toEqual(created.sort());
  });
});

describe('fixed values', () => {
  // Die zuletzt gesetzten Checks stehen in 0002_english_values.sql.
  const sql = readFileSync(new URL('../../migrations/0002_english_values.sql', import.meta.url), 'utf8');
  const checkValues = (column: string): string[] => {
    const match = new RegExp(`check \\(${column} in \\(([^)]*)\\)\\)`).exec(sql);
    return (match?.[1] ?? '').split(',').map((value) => value.trim().replace(/^'|'$/g, ''));
  };
  const enumValues = (schemaName: string): string[] => {
    const match = new RegExp(`\\n    ${schemaName}:[\\s\\S]*?enum: \\[([^\\]]*)\\]`).exec(openapiText);
    return (match?.[1] ?? '').split(',').map((value) => value.trim());
  };

  it('uses the same stages in code, database check and openapi', () => {
    expect(checkValues('stage')).toEqual([...STAGES]);
    expect(enumValues('Stage')).toEqual([...STAGES]);
  });

  it('uses the same activity kinds in code, database check and openapi', () => {
    expect(checkValues('kind')).toEqual([...ACTIVITY_KINDS]);
    expect(enumValues('ActivityKind')).toEqual([...ACTIVITY_KINDS]);
  });
});

describe('tool mapping', () => {
  const manifest = parseAppManifest(JSON.parse(manifestText));
  const operations = specOperations(openapiText);

  it('has exactly the tools of the manifest as handlers, no more and no fewer', () => {
    expect([...TOOL_NAMES].sort()).toEqual(manifest.offeredTools.map((tool) => tool.name).sort());
  });

  it('has an operation /tools/<name> with the same operationId and verb for every tool', () => {
    for (const tool of manifest.offeredTools) {
      const operation = operations.find((op) => op.path === `/tools/${tool.name}`);
      expect(operation, `openapi.yaml: /tools/${tool.name} is missing`).toBeDefined();
      expect(operation?.operationId, tool.name).toBe(tool.operationId);
      expect(operation?.verb, tool.name).toBe(tool.verb);
    }
  });

  it('has no operation without a tool in the manifest', () => {
    const names = new Set(manifest.offeredTools.map((tool) => `/tools/${tool.name}`));
    for (const operation of operations) expect(names.has(operation.path), operation.path).toBe(true);
    expect(operations.length).toBe(manifest.offeredTools.length);
  });

  it('uses each operationId only once', () => {
    const ids = operations.map((op) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses exactly the required tool names', () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      [
        'activities.list',
        'activities.log',
        'companies.create',
        'companies.get',
        'companies.list',
        'contacts.create',
        'contacts.get',
        'contacts.list',
        'contacts.update',
        'deals.create',
        'deals.list',
        'deals.update_stage',
        'pipeline.summary',
      ].sort(),
    );
  });

  it('declares reads as read and everything that writes as write', () => {
    for (const tool of manifest.offeredTools) {
      const reads = /\.(list|get|summary)$/.test(tool.name);
      expect(tool.verb, tool.name).toBe(reads ? 'read' : 'write');
    }
  });
});

/**
 * Die riskanten Pfade an der echten Handler-Tabelle: ohne Signatur laeuft
 * nichts, und falsche Argumente erreichen die Datenbank nie. Ohne
 * DATABASE_URL wuerde jeder DB-Zugriff mit 500 scheitern — eine 400 belegt
 * also, dass vorher abgewiesen wurde.
 */
describe('tool route with the CRM handlers', () => {
  const SECRET = 'k'.repeat(48);
  const APP_ID = 'crm';
  const APP_HOST = 'apps.example.test';
  const NOW = 1_794_387_600;
  const OPTIONS: ToolRouteOptions = {
    secret: SECRET,
    appId: APP_ID,
    appHost: APP_HOST,
    now: () => NOW * 1000,
    onError: () => undefined,
  };
  const route = createToolRoute(toolHandlers, OPTIONS);

  function signed(): Record<string, string> {
    const values = { userId: 'agent:sales', email: 'sales@agents.invalid', groups: '', issuedAt: String(NOW) };
    return {
      [USER_ID_HEADER]: values.userId,
      [USER_EMAIL_HEADER]: values.email,
      [GROUPS_HEADER]: values.groups,
      [ISSUED_AT_HEADER]: values.issuedAt,
      [SIGNATURE_HEADER]: signatureFor({ secret: SECRET, appId: APP_ID, host: APP_HOST, ...values }),
    };
  }

  const call = (tool: string, body: unknown, headers: Record<string, string> = signed()) =>
    route(
      new Request(`http://crm:3000/crm/api/tools/${tool}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ tool }) },
    );

  it('rejects every call without a signature with 401, writes included', async () => {
    for (const tool of TOOL_NAMES) {
      expect((await call(tool, {}, {})).status, tool).toBe(401);
    }
  });

  it('rejects a forged signature', async () => {
    const headers = { ...signed(), [USER_ID_HEADER]: 'admin' };
    expect((await call('contacts.create', { name: 'X' }, headers)).status).toBe(401);
  });

  it('answers wrong arguments with 400 and a hint before asking the database', async () => {
    const cases: [string, unknown][] = [
      ['deals.update_stage', { id: '0d000000-0000-4000-8000-000000000001', stage: 'won!' }],
      ['deals.create', { title: 'X', companyId: 'not-a-uuid', valueCents: 1 }],
      ['deals.create', { title: 'X', company_id: '0a000000-0000-4000-8000-000000000001', valueCents: 1 }],
      ['activities.log', { kind: 'note', subject: 'no reference' }],
      ['contacts.update', { id: '0b000000-0000-4000-8000-000000000001' }],
      ['companies.get', {}],
      ['pipeline.summary', { stage: 'lead' }],
    ];
    for (const [tool, args] of cases) {
      const response = await call(tool, args);
      expect(response.status, `${tool} ${JSON.stringify(args)}`).toBe(400);
      const body = (await response.json()) as { error: string; issues: unknown[] };
      expect(body.error).toBe('invalid');
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });

  it('knows no tool outside the table', async () => {
    expect((await call('contacts.delete', {})).status).toBe(404);
  });
});
