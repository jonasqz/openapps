import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appManifestSchema } from '@openapps/app-manifest';
import {
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  normalizeSearchResult,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
} from '@openapps/sdk';
import { POST } from '@/app/api/tools/[tool]/route';
import { toSearchHit } from './pages';
import { toolHandlers, toolSchemas } from './tools';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const manifest = appManifestSchema.parse(JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')));
const openapi = readFileSync(join(ROOT, 'openapi.yaml'), 'utf8');

/**
 * Die Operationen aus `openapi.yaml`, ohne YAML-Bibliothek: Pfad, operationId
 * und Verb je Operation. Reicht fuer die flache Form, die diese Datei hat, und
 * scheitert laut, wenn eine Operation unvollstaendig ist.
 */
function operations(): Map<string, { path: string; verb: string }> {
  const result = new Map<string, { path: string; verb: string }>();
  let path: string | undefined;
  let operationId: string | undefined;
  for (const line of openapi.split('\n')) {
    const pathMatch = /^ {2}(\/\S+):\s*$/.exec(line);
    if (pathMatch !== null) {
      path = pathMatch[1];
      operationId = undefined;
      continue;
    }
    const idMatch = /^ {6}operationId:\s*(\S+)\s*$/.exec(line);
    if (idMatch !== null) operationId = idMatch[1];
    const verbMatch = /^ {6}x-openapps-verb:\s*(\S+)\s*$/.exec(line);
    if (verbMatch !== null) {
      if (path === undefined || operationId === undefined || verbMatch[1] === undefined) {
        throw new Error(`x-openapps-verb without path or operationId: ${line}`);
      }
      result.set(operationId, { path, verb: verbMatch[1] });
    }
  }
  return result;
}

describe('tool mapping — manifest, OpenAPI and route match', () => {
  it('the manifest passes the real schema of the platform', () => {
    expect(manifest.name).toBe('wiki');
    expect(manifest.requiredTables.map((table) => table.name).sort()).toEqual([
      'page_favorites',
      'page_links',
      'page_revisions',
      'pages',
      'search_outbox',
      'search_sync',
    ]);
    expect(manifest.version).toBe('0.3.2');
    expect(manifest.source.tag).toBe('wiki-v0.3.2');
  });

  it('offers exactly the fourteen tools of the wiki', () => {
    expect(manifest.offeredTools.map((tool) => tool.name).sort()).toEqual(
      [
        'favorites.list',
        'favorites.set',
        'pages.archive',
        'pages.create',
        'pages.get',
        'pages.history',
        'pages.list',
        'pages.move',
        'pages.restore',
        'pages.search',
        'pages.tree',
        'pages.update',
        'search.backfill',
        'search.status',
      ].sort(),
    );
  });

  it('every tool in the manifest has a handler and a schema — and vice versa', () => {
    const declared = manifest.offeredTools.map((tool) => tool.name).sort();
    expect(Object.keys(toolHandlers).sort()).toEqual(declared);
    expect(Object.keys(toolSchemas).sort()).toEqual(declared);
  });

  it('every tool has an operation with the same operationId, verb and path /tools/<name>', () => {
    const ops = operations();
    expect(ops.size).toBe(manifest.offeredTools.length);
    for (const tool of manifest.offeredTools) {
      const op = ops.get(tool.operationId);
      expect(op, `operation ${tool.operationId} is missing in openapi.yaml`).toBeDefined();
      expect(op?.path).toBe(`/tools/${tool.name}`);
      expect(op?.verb).toBe(tool.verb);
    }
  });

  it('only reading tools are read, all writing ones write', () => {
    const verbs = Object.fromEntries(manifest.offeredTools.map((tool) => [tool.name, tool.verb]));
    expect(verbs).toEqual({
      'pages.list': 'read',
      'pages.tree': 'read',
      'pages.get': 'read',
      'pages.search': 'read',
      'pages.history': 'read',
      'favorites.list': 'read',
      'search.status': 'read',
      'pages.create': 'write',
      'pages.update': 'write',
      'pages.move': 'write',
      'pages.archive': 'write',
      'pages.restore': 'write',
      'favorites.set': 'write',
      'search.backfill': 'write',
    });
  });

  it('asks for exactly the two grants it needs on Knowledge, for itself as an app', () => {
    const forApp = manifest.requestedGrants.filter((grant) => grant.subjectKind === 'app');
    expect(forApp).toEqual([
      expect.objectContaining({
        subjectId: 'wiki',
        verb: 'execute',
        resource: { kind: 'tool', app: 'knowledge', name: 'documents.upsert' },
      }),
      expect.objectContaining({
        subjectId: 'wiki',
        verb: 'execute',
        resource: { kind: 'tool', app: 'knowledge', name: 'documents.remove' },
      }),
    ]);
  });

  it('the server path in openapi.yaml is the app path', () => {
    expect(openapi).toMatch(/default: \/wiki\s*$/m);
  });
});

describe('tool route — signature first, then arguments', () => {
  const SECRET = 'w'.repeat(48);
  const APP_HOST = 'intern.example';

  beforeEach(() => {
    vi.stubEnv('OPENAPPS_AUTH_SECRET', SECRET);
    vi.stubEnv('OPENAPPS_APP_ID', 'wiki');
    vi.stubEnv('OPENAPPS_APP_HOST', APP_HOST);
    // Ohne Datenbank: Kein Test hier darf bis zu einer Abfrage kommen.
    vi.stubEnv('DATABASE_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function signed(secret = SECRET): Record<string, string> {
    const values = {
      userId: 'agent:editor',
      email: 'editor@agents.invalid',
      groups: '',
      issuedAt: String(Math.floor(Date.now() / 1000)),
    };
    return {
      [USER_ID_HEADER]: values.userId,
      [USER_EMAIL_HEADER]: values.email,
      [GROUPS_HEADER]: values.groups,
      [ISSUED_AT_HEADER]: values.issuedAt,
      [SIGNATURE_HEADER]: signatureFor({ secret, appId: 'wiki', host: APP_HOST, ...values }),
    };
  }

  function call(tool: string, body: unknown, headers: Record<string, string>): Promise<Response> {
    const request = new Request(`http://wiki:3000/wiki/api/tools/${tool}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return POST(request, { params: Promise.resolve({ tool }) });
  }

  it('rejects every tool without a signature with 401', async () => {
    for (const tool of Object.keys(toolHandlers)) {
      const response = await call(tool, {}, {});
      expect(response.status, tool).toBe(401);
    }
  });

  it('rejects a signature made with a foreign secret', async () => {
    const response = await call('pages.create', { title: 'x', contentMd: '' }, signed('z'.repeat(48)));
    expect(response.status).toBe(401);
  });

  it('rejects self-set identity headers without a matching signature', async () => {
    const headers = { ...signed(), [USER_ID_HEADER]: 'admin' };
    expect((await call('pages.list', {}, headers)).status).toBe(401);
  });

  it('knows no tool that is not in the manifest', async () => {
    const response = await call('pages.delete', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }, signed());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'unknown_tool' });
  });

  it('answers wrong arguments with 400 and the findings without asking the database', async () => {
    const cases: Array<[string, unknown]> = [
      ['pages.get', { id: 'not-a-uuid' }],
      ['pages.create', { title: '' }],
      ['pages.update', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }],
      ['pages.update', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', contentMd: 'a', appendMd: 'b' }],
      ['pages.search', { query: '' }],
      ['pages.archive', {}],
      ['pages.history', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', limit: 9999 }],
      ['pages.list', { unknown: 1 }],
      ['pages.list', { sort: 'random' }],
      ['pages.list', { limit: 0 }],
      ['pages.tree', { rootId: '../etc' }],
      ['pages.tree', { depth: 3 }],
      // parentId fehlt: Absicht unklar, kein stilles „nach oben“.
      ['pages.move', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }],
      ['pages.move', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', parentId: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }],
      ['pages.move', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', parentId: 'root' }],
      ['pages.restore', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }],
      ['pages.restore', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', revisionId: 5 }],
      ['pages.restore', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', revisionId: '1; drop table pages' }],
      ['favorites.list', { userId: 'someone-else' }],
      ['favorites.set', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }],
      ['favorites.set', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', favorite: 'yes' }],
    ];
    for (const [tool, args] of cases) {
      const response = await call(tool, args, signed());
      expect(response.status, `${tool} ${JSON.stringify(args)}`).toBe(400);
      const body = (await response.json()) as { error: string; issues: unknown[] };
      expect(body.error).toBe('invalid');
      expect(body.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('platform search (ADR 0021)', () => {
  it('names pages.search as the search tool, a read tool', () => {
    expect(manifest.search).toEqual({ tool: 'pages.search' });
    expect(manifest.offeredTools.find((tool) => tool.name === 'pages.search')?.verb).toBe('read');
  });

  it('returns hits the platform accepts: a path inside the wiki and kind page', () => {
    const row = {
      id: '3f1c2a8e-6b2d-4a51-9a64-0b1f6f6c9e11',
      parent_id: null,
      title: 'Leave policy',
      tags: ['hr'],
      updated_at: new Date('2026-11-27T10:00:00Z'),
      rank: 0.4,
      snippet: 'How to request «leave»\n in   time',
    };
    const hit = toSearchHit(row);
    expect(hit.url).toBe(`/pages/${row.id}`);
    expect(hit.kind).toBe('page');
    expect(normalizeSearchResult({ hits: [hit] }, 5)).toEqual([
      {
        id: row.id,
        title: 'Leave policy',
        url: `/pages/${row.id}`,
        kind: 'page',
        snippet: 'How to request «leave» in time',
      },
    ]);
  });
});
