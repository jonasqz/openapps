import { readdirSync, readFileSync } from 'node:fs';
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
import { TASK_EVENT_TYPES } from './events';
import { ACCEPTED_SOURCES } from './refs';
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

  it('nennt jede Tabelle aus den Migrationen', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText));
    const dir = new URL('../../migrations/', import.meta.url);
    const created = readdirSync(dir)
      .filter((name) => name.endsWith('.sql'))
      .flatMap((name) =>
        [...readFileSync(new URL(name, dir), 'utf8').matchAll(/^create table (\w+)/gm)].map((match) => match[1]),
      );
    expect(manifest.requiredTables.map((table) => table.name).sort()).toEqual(created.sort());
  });

  it('steht auf Version 0.5.2 und behaelt die lokale Quelle', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText));
    expect(manifest.version).toBe('0.5.2');
    expect(manifest.source.tag).toBe('lokal');
  });

  it('erklaert genau die Ereignisse, die der Code meldet, und beantragt emit_event fuer sich', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText));
    expect((manifest.events ?? []).map((event) => event.type).sort()).toEqual([...TASK_EVENT_TYPES].sort());
    expect(manifest.requestedGrants).toContainEqual(
      expect.objectContaining({
        subjectKind: 'app',
        subjectId: 'tasks',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'emit_event' },
      }),
    );
    expect(manifest.env.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['OPENAPPS_PLATFORM_URL', 'OPENAPPS_CALL_SECRET']),
    );
    expect(manifest.egress.map((entry) => entry.host)).toEqual(['openapps-control-plane']);
  });

  it('erklaert task und project mit Resolver, die Aktion aus Wiki und CRM und beantragt set_refs', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText));
    expect((manifest.objects ?? []).map((object) => [object.type, object.resolver])).toEqual([
      ['task', 'tasks.resolve'],
      ['project', 'tasks.resolve'],
    ]);
    expect(manifest.actions).toEqual([
      {
        name: 'task_from_ref',
        title: 'Create task',
        accepts: [...ACCEPTED_SOURCES],
        tool: 'tasks.create_from_ref',
        path: '/new',
      },
    ]);
    expect(manifest.requestedGrants).toContainEqual(
      expect.objectContaining({
        subjectKind: 'app',
        subjectId: 'tasks',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'set_refs' },
      }),
    );
  });

  it('haelt jede Tool-Beschreibung englisch und ohne Umlaute', () => {
    const manifest = parseAppManifest(JSON.parse(manifestText));
    for (const tool of manifest.offeredTools) {
      expect(tool.description, tool.name).not.toMatch(/[äöüÄÖÜß]/);
    }
  });
});

describe('Tool-Zuordnung', () => {
  const manifest = parseAppManifest(JSON.parse(manifestText));
  const operations = specOperations(openapiText);

  it('nutzt genau die verlangten Tool-Namen, auch im Manifest', () => {
    const expected = [
      'projects.create',
      'projects.list',
      'search',
      'tasks.assign',
      'tasks.comment',
      'tasks.complete',
      'tasks.create',
      'tasks.create_from_ref',
      'tasks.get',
      'tasks.list',
      'tasks.resolve',
      'tasks.update',
    ];
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

  it('beschreibt nur list, get, resolve und search als read, alles, was schreibt, als write', () => {
    for (const tool of manifest.offeredTools) {
      const reads =
        tool.name.endsWith('.list') ||
        tool.name.endsWith('.get') ||
        tool.name.endsWith('.resolve') ||
        tool.name === 'search';
      expect(tool.verb, tool.name).toBe(reads ? 'read' : 'write');
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

  const ID = '0d000000-0000-4000-8000-000000000001';

  it('antwortet auf falsche Argumente mit 400 und Hinweis, bevor die Datenbank gefragt wird', async () => {
    const cases: [string, unknown][] = [
      // create
      ['tasks.create', {}],
      ['tasks.create', { title: '   ' }],
      ['tasks.create', { title: 'x'.repeat(201) }],
      ['tasks.create', { title: 'X', dueDate: '01.12.2026' }],
      ['tasks.create', { title: 'X', dueDate: '2026-02-30' }],
      ['tasks.create', { title: 'X', assignee: 'Alex' }],
      ['tasks.create', { title: 'X', status: 'finished' }],
      ['tasks.create', { title: 'X', priority: 'urgent' }],
      ['tasks.create', { title: 'X', projectId: 'website' }],
      ['tasks.create', { title: 'X', createdBy: 'someone' }],
      ['tasks.create', { title: 'X', description: 'x'.repeat(10001) }],
      // update: Statuswechsel nur auf bekannte Werte, und mindestens ein Feld
      ['tasks.update', { id: ID }],
      ['tasks.update', { id: ID, expectedStatus: 'done' }],
      ['tasks.update', { id: ID, status: 'completed' }],
      ['tasks.update', { id: ID, status: 'done', expectedStatus: 'closed' }],
      ['tasks.update', { id: ID, title: '' }],
      ['tasks.update', { id: ID, title: null }],
      ['tasks.update', { id: ID, assignee: 'not an email' }],
      ['tasks.update', { id: ID, completedBy: 'someone', status: 'done' }],
      ['tasks.update', { id: 'not-a-uuid', status: 'done' }],
      // assign
      ['tasks.assign', { id: ID }],
      ['tasks.assign', { id: ID, assignee: 'Alex' }],
      ['tasks.assign', { id: ID, assignee: '' }],
      // complete
      ['tasks.complete', { id: 'not-a-uuid' }],
      ['tasks.complete', {}],
      ['tasks.complete', { id: ID, status: 'todo' }],
      // comment
      ['tasks.comment', { id: ID }],
      ['tasks.comment', { id: ID, body: '   ' }],
      ['tasks.comment', { id: ID, body: 'x'.repeat(5001) }],
      ['tasks.comment', { id: ID, body: 'Hi', author: 'someone' }],
      // get und list
      ['tasks.get', {}],
      ['tasks.list', { completed: 'yes' }],
      ['tasks.list', { limit: 1000 }],
      ['tasks.list', { status: 'open' }],
      ['tasks.list', { mine: true, assignee: 'sam@example.com' }],
      ['tasks.list', { status: 'done', completed: true }],
      ['tasks.list', { projectId: 'website' }],
      // create_from_ref: nur Verweise auf Wiki-Seiten und Deals
      ['tasks.create_from_ref', {}],
      ['tasks.create_from_ref', { sourceRef: 'nonsense' }],
      ['tasks.create_from_ref', { sourceRef: 'tasks:task:1' }],
      ['tasks.create_from_ref', { sourceRef: 'human:anna@example.com' }],
      ['tasks.create_from_ref', { sourceRef: 'wiki:page:p1', createdBy: 'someone' }],
      ['tasks.create_from_ref', { sourceRef: 'wiki:page:p1', excerpt: 'x'.repeat(2001) }],
      // resolve: das feste Format der Plattform
      ['tasks.resolve', {}],
      ['tasks.resolve', { type: 'comment', ids: ['1'] }],
      ['tasks.resolve', { type: 'task', ids: [] }],
      ['tasks.resolve', { type: 'task', ids: Array.from({ length: 51 }, (_, i) => String(i)) }],
      // projects
      ['projects.create', {}],
      ['projects.create', { name: '  ' }],
      ['projects.create', { name: 'x'.repeat(101) }],
      ['projects.list', { all: true }],
    ];
    for (const [tool, args] of cases) {
      const response = await call(tool, args);
      expect(response.status, `${tool} ${JSON.stringify(args)}`).toBe(400);
      const body = (await response.json()) as { error: string; issues: unknown[] };
      expect(body.error).toBe('invalid');
      expect(body.issues.length, `${tool} ${JSON.stringify(args)}`).toBeGreaterThan(0);
    }
  });

  it('sagt einem Agenten, wie es richtig geht', async () => {
    const expectations: [string, unknown, string, string][] = [
      ['tasks.create', { title: 'X', assignee: 'Alex' }, 'assignee', 'Assignee must be an email address, e.g. alex@example.com.'],
      ['tasks.update', { id: ID, status: 'completed' }, 'status', 'status must be one of todo, in_progress, done.'],
      ['tasks.comment', { id: ID, body: ' ' }, 'body', 'Comment is empty.'],
      ['tasks.complete', { id: 'x' }, 'id', 'id must be the UUID of a task from tasks.list.'],
    ];
    for (const [tool, args, field, message] of expectations) {
      const body = (await (await call(tool, args)).json()) as { issues: { path?: unknown[]; message?: string }[] };
      const issue = body.issues.find((candidate) => candidate.path?.[0] === field);
      expect(issue?.message, `${tool} ${field}`).toBe(message);
    }
    const empty = (await (await call('tasks.update', { id: ID })).json()) as { issues: { message?: string }[] };
    expect(empty.issues[0]?.message).toMatch(/^Nothing to change\./);
  });

  it('nennt in der 400 das Feld und eine englische Meldung', async () => {
    const response = await call('tasks.create', { title: 'X', assignee: 'alex@example.com', dueDate: '01.12.2026' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { issues: { path?: unknown[]; message?: string }[] };
    const issue = body.issues.find((candidate) => candidate.path?.[0] === 'dueDate');
    expect(issue?.message).toBe('Enter the date as YYYY-MM-DD, e.g. 2026-12-01.');
  });

  it('kennt kein Tool außerhalb der Tabelle', async () => {
    for (const tool of ['tasks.delete', 'comments.delete', 'projects.delete', '__proto__', 'toString']) {
      expect((await call(tool, {})).status, tool).toBe(404);
    }
  });
});
