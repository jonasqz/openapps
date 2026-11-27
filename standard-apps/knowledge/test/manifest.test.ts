import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateAppManifest, type AppManifest } from '@openapps/app-manifest';
import { toolHandlers } from '@/lib/tools';

/**
 * Manifest, Spec und Code muessen zusammenpassen — sonst blockiert das
 * Review-Gate („ein Manifest, das nicht zum Code passt“), oder schlimmer: Ein
 * Tool ist freigegeben, aber ohne Handler, oder ein Handler ist erreichbar,
 * ohne im Manifest zu stehen und je freigegeben worden zu sein.
 */

const root = join(import.meta.dirname, '..');
const rawManifest: unknown = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const openapi = readFileSync(join(root, 'openapi.yaml'), 'utf8');

function manifest(): AppManifest {
  const result = validateAppManifest(rawManifest);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  return result.manifest;
}

interface Operation {
  path: string;
  method: string;
  operationId: string;
  verb: string | undefined;
}

/**
 * Liest die Operationen aus `openapi.yaml`, ohne YAML-Bibliothek (keine neue
 * Abhaengigkeit fuer einen Test). Erwartet das Format dieser Datei: Pfade mit
 * zwei Leerzeichen Einzug, Methoden mit vier, Felder mit sechs.
 */
function operations(): Operation[] {
  const result: Operation[] = [];
  let inPaths = false;
  let path: string | undefined;
  let current: Operation | undefined;
  for (const line of openapi.split('\n')) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith('paths:');
      continue;
    }
    if (!inPaths) continue;
    const pathMatch = /^ {2}(\/\S+):\s*$/.exec(line);
    if (pathMatch?.[1] !== undefined) {
      path = pathMatch[1];
      continue;
    }
    const methodMatch = /^ {4}(get|put|post|patch|delete):\s*$/.exec(line);
    if (methodMatch?.[1] !== undefined && path !== undefined) {
      current = { path, method: methodMatch[1], operationId: '', verb: undefined };
      result.push(current);
      continue;
    }
    const field = /^ {6}(operationId|x-openapps-verb):\s*(\S+)\s*$/.exec(line);
    if (field?.[1] !== undefined && field[2] !== undefined && current !== undefined) {
      if (field[1] === 'operationId') current.operationId = field[2];
      else current.verb = field[2];
    }
  }
  return result;
}

describe('app.json', () => {
  it('ist gültig nach dem echten Manifest-Schema', () => {
    const result = validateAppManifest(rawManifest);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('heißt knowledge und nennt sich in jeder angefragten App-Freigabe selbst', () => {
    const m = manifest();
    expect(m.name).toBe('knowledge');
    for (const grant of m.requestedGrants) expect(grant.resource.app).toBe('knowledge');
  });

  it('beschreibt bei search, dass Passagen mit Quelle zurückkommen und mit Quelle geantwortet wird', () => {
    const search = manifest().offeredTools.find((tool) => tool.name === 'search');
    expect(search?.description).toMatch(/chunkId/);
    expect(search?.description).toMatch(/documentId/);
    expect(search?.description).toMatch(/documentTitle/);
    expect(search?.description).toMatch(/source/);
  });

  it('nennt genau die Tabellen, die die Migrationen anlegen', () => {
    const created = readdirSync(join(root, 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .flatMap((name) =>
        [...readFileSync(join(root, 'migrations', name), 'utf8').matchAll(/create table (\w+)/gi)].map(
          (match) => match[1],
        ),
      );
    expect(manifest().requiredTables.map((table) => table.name).sort()).toEqual(created.sort());
  });
});

describe('Tool-Zuordnung', () => {
  it('jedes Tool aus app.json hat einen Handler, und es gibt keinen Handler ohne Tool', () => {
    const declared = manifest().offeredTools.map((tool) => tool.name).sort();
    expect(Object.keys(toolHandlers).sort()).toEqual(declared);
  });

  it('jedes Tool hat eine Operation POST /tools/<name> mit derselben operationId und demselben Verb', () => {
    const ops = operations();
    for (const tool of manifest().offeredTools) {
      const op = ops.find((candidate) => candidate.operationId === tool.operationId);
      expect(op, `Operation ${tool.operationId} fehlt in openapi.yaml`).toBeDefined();
      expect(op?.path).toBe(`/tools/${tool.name}`);
      expect(op?.method).toBe('post');
      expect(op?.verb).toBe(tool.verb);
    }
  });

  it('openapi.yaml hat keine Operation, die nicht als Tool im Manifest steht', () => {
    const ops = operations();
    expect(ops.length).toBeGreaterThan(0);
    const ids = new Set(manifest().offeredTools.map((tool) => tool.operationId));
    for (const op of ops) expect(ids.has(op.operationId), op.operationId).toBe(true);
    // Jede Operation traegt ein Verb; ohne Verb kann das Rechtemodell sie nicht zuordnen.
    for (const op of ops) expect(['read', 'write', 'execute']).toContain(op.verb);
  });

  it('der Default-Pfad in openapi.yaml ist der Pfad dieser App', () => {
    expect(openapi).toMatch(/default: \/knowledge\s*$/m);
  });
});

describe('Suche ueber alle Apps (ADR 0021)', () => {
  it('nennt documents.search als Such-Tool, ein lesendes Tool', () => {
    const m = manifest();
    expect(m.search).toEqual({ tool: 'documents.search' });
    expect(m.offeredTools.find((tool) => tool.name === 'documents.search')?.verb).toBe('read');
  });

  it('steht auf Version 0.2.2', () => {
    expect(manifest().version).toBe('0.2.2');
  });
});
