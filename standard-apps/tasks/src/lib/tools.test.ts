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
  it('besteht das echte Manifest-Schema der Plattform', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText), 'standard-apps/tasks/app.json');
    expect(manifest.name).toBe('tasks');
  });

  it('nennt jede Tabelle aus der Migration', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText));
    const sql = readFileSync(new URL('../../migrations/0001_tasks.sql', import.meta.url), 'utf8');
    const created = [...sql.matchAll(/^create table (\w+)/gm)].map((match) => match[1]);
    expect(manifest.requiredTables.map((table) => table.name).sort()).toEqual(created.sort());
  });
});

describe('Tool-Zuordnung', () => {
  const manifest = parseAppManifest(JSON.parse(manifestText));
  const operations = specOperations(openapiText);

  it('nutzt genau die verlangten Tool-Namen, auch im Manifest', () => {
    const expected = ['tasks.complete', 'tasks.create', 'tasks.list'];
    expect([...TOOL_NAMES].sort()).toEqual(expected);
    expect(manifest.offeredTools.map((tool) => tool.name).sort()).toEqual(expected);
  });

  it('hat für jedes Tool eine Operation /tools/<name> mit gleicher operationId und gleichem Verb', () => {
    for (const tool of manifest.offeredTools) {
      const operation = operations.find((op) => op.path === `/tools/${tool.name}`);
      expect(operation, `openapi.yaml: /tools/${tool.name} fehlt`).toBeDefined();
      expect(operation?.operationId, tool.name).toBe(tool.operationId);
      expect(operation?.verb, tool.name).toBe(tool.verb);
    }
    expect(operations.length).toBe(manifest.offeredTools.length);
  });

  it('beschreibt nur list als read, alles andere als write', () => {
    for (const tool of manifest.offeredTools) {
      expect(tool.verb, tool.name).toBe(tool.name.endsWith('.list') ? 'read' : 'write');
    }
  });
});

/**
 * Die riskanten Pfade an der echten Handler-Tabelle: ohne Signatur läuft
 * nichts, und falsche Argumente erreichen die Datenbank nie. Ohne
 * DATABASE_URL würde jeder DB-Zugriff mit 500 scheitern — eine 400 belegt
 * also, dass vorher abgewiesen wurde.
 */
describe('Tool-Route mit den Handlern von tasks', () => {
  const SECRET = 'k'.repeat(48);
  const APP_ID = 'tasks';
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
    const values = {
      userId: 'agent:operations',
      email: 'operations@agents.invalid',
      groups: '',
      issuedAt: String(NOW),
    };
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
      new Request(`http://tasks:3000/tasks/api/tools/${tool}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ tool }) },
    );

  it('weist jeden Aufruf ohne Signatur mit 401 ab, auch Schreibzugriffe', async () => {
    for (const tool of TOOL_NAMES) {
      expect((await call(tool, {}, {})).status, tool).toBe(401);
    }
  });

  it('weist eine gefälschte Signatur ab', async () => {
    const headers = { ...signed(), [USER_ID_HEADER]: 'admin' };
    const response = await call('tasks.complete', { id: '0d000000-0000-4000-8000-000000000001' }, headers);
    expect(response.status).toBe(401);
  });

  it('antwortet auf falsche Argumente mit 400 und Hinweis, bevor die Datenbank gefragt wird', async () => {
    const cases: [string, unknown][] = [
      ['tasks.create', { title: 'X' }],
      ['tasks.create', { title: '   ', assignee: 'Alex' }],
      ['tasks.create', { title: 'X', assignee: 'Alex', dueDate: '01.12.2026' }],
      ['tasks.create', { title: 'X', assignee: 'Alex', dueDate: '2026-02-30' }],
      ['tasks.create', { title: 'X', assignee: 'Alex', createdBy: 'someone' }],
      ['tasks.complete', { id: 'not-a-uuid' }],
      ['tasks.complete', {}],
      ['tasks.list', { completed: 'yes' }],
      ['tasks.list', { limit: 1000 }],
    ];
    for (const [tool, args] of cases) {
      const response = await call(tool, args);
      expect(response.status, `${tool} ${JSON.stringify(args)}`).toBe(400);
      const body = (await response.json()) as { error: string; issues: unknown[] };
      expect(body.error).toBe('invalid');
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });

  it('nennt in der 400 das Feld und eine englische Meldung', async () => {
    const response = await call('tasks.create', { title: 'X', assignee: 'Alex', dueDate: '01.12.2026' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path?: unknown[]; message?: string }[] };
    const issue = body.issues.find((candidate) => candidate.path?.[0] === 'dueDate');
    expect(issue?.message).toBe('Enter the date as YYYY-MM-DD, e.g. 2026-12-01.');
  });

  it('kennt kein Tool außerhalb der Tabelle', async () => {
    expect((await call('tasks.delete', {})).status).toBe(404);
  });
});
