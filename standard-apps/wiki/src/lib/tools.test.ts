import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appManifestSchema } from '@openapps/app-manifest';
import {
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
} from '@openapps/sdk';
import { POST } from '@/app/api/tools/[tool]/route';
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
        throw new Error(`x-openapps-verb ohne Pfad oder operationId: ${line}`);
      }
      result.set(operationId, { path, verb: verbMatch[1] });
    }
  }
  return result;
}

describe('Tool-Zuordnung — Manifest, OpenAPI und Route passen zusammen', () => {
  it('das Manifest besteht das echte Schema der Plattform', () => {
    expect(manifest.name).toBe('wiki');
    expect(manifest.requiredTables.map((table) => table.name).sort()).toEqual(['page_revisions', 'pages']);
  });

  it('bietet genau die sieben Tools des Wikis an', () => {
    expect(manifest.offeredTools.map((tool) => tool.name).sort()).toEqual(
      [
        'pages.archive',
        'pages.create',
        'pages.get',
        'pages.history',
        'pages.list',
        'pages.search',
        'pages.update',
      ].sort(),
    );
  });

  it('jedes Tool im Manifest hat einen Handler und ein Schema — und umgekehrt', () => {
    const declared = manifest.offeredTools.map((tool) => tool.name).sort();
    expect(Object.keys(toolHandlers).sort()).toEqual(declared);
    expect(Object.keys(toolSchemas).sort()).toEqual(declared);
  });

  it('jedes Tool hat eine Operation mit gleicher operationId, gleichem Verb und Pfad /tools/<name>', () => {
    const ops = operations();
    expect(ops.size).toBe(manifest.offeredTools.length);
    for (const tool of manifest.offeredTools) {
      const op = ops.get(tool.operationId);
      expect(op, `Operation ${tool.operationId} fehlt in openapi.yaml`).toBeDefined();
      expect(op?.path).toBe(`/tools/${tool.name}`);
      expect(op?.verb).toBe(tool.verb);
    }
  });

  it('nur lesende Tools sind read, alle schreibenden write', () => {
    const verbs = Object.fromEntries(manifest.offeredTools.map((tool) => [tool.name, tool.verb]));
    expect(verbs).toEqual({
      'pages.list': 'read',
      'pages.get': 'read',
      'pages.search': 'read',
      'pages.history': 'read',
      'pages.create': 'write',
      'pages.update': 'write',
      'pages.archive': 'write',
    });
  });

  it('der Server-Pfad in openapi.yaml ist der App-Pfad', () => {
    expect(openapi).toMatch(/default: \/wiki\s*$/m);
  });
});

describe('Tool-Route — Signatur zuerst, dann Argumente', () => {
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
      userId: 'agent:redaktion',
      email: 'redaktion@agents.invalid',
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

  it('weist jedes Tool ohne Signatur mit 401 ab', async () => {
    for (const tool of Object.keys(toolHandlers)) {
      const response = await call(tool, {}, {});
      expect(response.status, tool).toBe(401);
    }
  });

  it('weist eine Signatur mit fremdem Secret ab', async () => {
    const response = await call('pages.create', { title: 'x', contentMd: '' }, signed('z'.repeat(48)));
    expect(response.status).toBe(401);
  });

  it('weist selbst gesetzte Identitaets-Header ohne passende Signatur ab', async () => {
    const headers = { ...signed(), [USER_ID_HEADER]: 'admin' };
    expect((await call('pages.list', {}, headers)).status).toBe(401);
  });

  it('kennt kein Tool, das nicht im Manifest steht', async () => {
    const response = await call('pages.delete', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }, signed());
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'unknown_tool' });
  });

  it('beantwortet falsche Argumente mit 400 und den Befunden, ohne die Datenbank zu fragen', async () => {
    const cases: Array<[string, unknown]> = [
      ['pages.get', { id: 'keine-uuid' }],
      ['pages.create', { title: '' }],
      ['pages.update', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001' }],
      ['pages.update', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', contentMd: 'a', appendMd: 'b' }],
      ['pages.search', { query: '' }],
      ['pages.archive', {}],
      ['pages.history', { id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001', limit: 9999 }],
      ['pages.list', { unbekannt: 1 }],
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
