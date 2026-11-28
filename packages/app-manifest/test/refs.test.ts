import { describe, expect, it } from 'vitest';
import {
  appManifestJsonSchema,
  extractRefs,
  formatObjectRef,
  formatRefToken,
  formatSubjectRef,
  parseObjectRef,
  parseRef,
  parseSubjectRef,
  RefFormatError,
  RESERVED_APP_NAMES,
  splitRefTokens,
  validateAppManifest,
} from '../src/index.js';
import { validManifest } from './fixtures.js';

/** ADR 0023 Schnitt 1: gueltige und ungueltige Verweise, Subjekt und Objekt unterscheidbar. */
describe('parseRef', () => {
  it('liest Objekt-Verweise mit drei Teilen', () => {
    expect(parseRef('tasks:task:42')).toEqual({
      kind: 'object',
      app: 'tasks',
      type: 'task',
      id: '42',
      ref: 'tasks:task:42',
    });
    expect(parseObjectRef('wiki:page:9f2c-aa_1.b~')?.id).toBe('9f2c-aa_1.b~');
    expect(parseObjectRef('crm:next-step:1')?.type).toBe('next-step');
  });

  it('liest Subjekt-Verweise mit zwei Teilen, E-Mail klein', () => {
    expect(parseRef('human:Anna@Example.com')).toEqual({
      kind: 'subject',
      subjectKind: 'human',
      id: 'anna@example.com',
      ref: 'human:anna@example.com',
    });
    expect(parseSubjectRef('group:sales-team')?.ref).toBe('group:sales-team');
    expect(parseSubjectRef('agent:helper')?.ref).toBe('agent:helper');
  });

  it('unterscheidet Subjekt und Objekt eindeutig', () => {
    expect(parseObjectRef('human:anna@example.com')).toBeNull();
    expect(parseSubjectRef('tasks:task:42')).toBeNull();
  });

  it('weist eine App mit gesperrtem Namen ab, auch mit drei Teilen', () => {
    for (const app of RESERVED_APP_NAMES) {
      expect(parseRef(`${app}:task:1`), app).toBeNull();
    }
    expect(RESERVED_APP_NAMES).toContain('human');
  });

  it('weist ungueltige Verweise ab', () => {
    for (const bad of [
      '',
      'tasks',
      'tasks:task',
      'tasks:task:',
      'tasks:task:4:2',
      'Tasks:task:1',
      'tasks:Task:1',
      'tasks:task:a b',
      'tasks:task:<script>',
      'ta:task:1',
      'tasks:task:' + 'x'.repeat(129),
      'user:u-1',
      'app:wiki',
      'human:not-an-email',
      'human:a@b@c',
      'group:X',
      'agent:1bad',
      42,
      null,
    ]) {
      expect(parseRef(bad), String(bad)).toBeNull();
    }
  });
});

describe('formatieren', () => {
  it('formatiert gueltige Teile und wirft bei ungueltigen', () => {
    expect(formatObjectRef({ app: 'crm', type: 'deal', id: 'd-1' })).toBe('crm:deal:d-1');
    expect(formatSubjectRef('human', 'Ben@Example.com')).toBe('human:ben@example.com');
    expect(formatRefToken('tasks:task:42')).toBe('@{tasks:task:42}');
    expect(() => formatObjectRef({ app: 'human', type: 'x', id: '1' })).toThrow(RefFormatError);
    expect(() => formatObjectRef({ app: 'crm', type: 'deal', id: 'a:b' })).toThrow(RefFormatError);
    expect(() => formatRefToken('nope')).toThrow(RefFormatError);
  });
});

describe('extractRefs und splitRefTokens', () => {
  const text =
    'See @{tasks:task:42} and @{human:Anna@example.com}, again @{tasks:task:42}. ' +
    'Not a ref: @{nope}, @{human:anna} and {tasks:task:1}.';

  it('findet gueltige Verweise ohne Doppel, in Reihenfolge', () => {
    expect(extractRefs(text).map((ref) => ref.ref)).toEqual([
      'tasks:task:42',
      'human:anna@example.com',
    ]);
    expect(extractRefs(text, 1)).toHaveLength(1);
  });

  it('teilt Text so, dass ungueltige Tokens Klartext bleiben', () => {
    const segments = splitRefTokens('a @{tasks:task:1} b @{nope} c');
    expect(segments.map((s) => (s.kind === 'ref' ? `[${s.ref.ref}]` : s.text)).join('')).toBe(
      'a [tasks:task:1] b @{nope} c',
    );
  });
});

describe('objects und actions (ADR 0023)', () => {
  const tools = [
    { name: 'projects.list', description: 'List.', verb: 'read' as const, operationId: 'list' },
    { name: 'resolve', description: 'Resolve.', verb: 'read' as const, operationId: 'resolve' },
    {
      name: 'projects.create_from_ref',
      description: 'Create.',
      verb: 'write' as const,
      operationId: 'createFromRef',
    },
  ];

  it('sind optional und nehmen gueltige Eintraege an', () => {
    expect(validateAppManifest(validManifest()).ok).toBe(true);
    const result = validateAppManifest(
      validManifest({
        offeredTools: tools,
        objects: [{ type: 'project', description: 'A project.', resolver: 'resolve' }],
        actions: [
          {
            name: 'project_from_ref',
            title: 'Create project',
            accepts: ['wiki:page', 'crm:deal'],
            tool: 'projects.create_from_ref',
            path: '/new',
          },
        ],
      }),
    );
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('verlangt einen lesenden Resolver aus offeredTools', () => {
    const missing = validateAppManifest(
      validManifest({
        offeredTools: tools,
        objects: [{ type: 'project', description: 'A project.', resolver: 'nope' }],
      }),
    );
    expect(missing.ok).toBe(false);
    const writing = validateAppManifest(
      validManifest({
        offeredTools: tools,
        objects: [
          { type: 'project', description: 'A project.', resolver: 'projects.create_from_ref' },
        ],
      }),
    );
    expect(writing.ok).toBe(false);
  });

  it('weist falsche Arten, fremde Pfade und doppelte Typen ab', () => {
    const action = {
      name: 'x',
      title: 'X',
      accepts: ['wiki:page'],
      tool: 'projects.create_from_ref',
    };
    for (const bad of [
      { ...action, accepts: ['wiki'] },
      { ...action, accepts: ['human:page'] },
      { ...action, path: 'https://evil.invalid/' },
      { ...action, path: '//evil.invalid' },
      { ...action, path: '/a/../b' },
      { ...action, tool: 'nope' },
    ]) {
      expect(
        validateAppManifest(validManifest({ offeredTools: tools, actions: [bad] })).ok,
        JSON.stringify(bad),
      ).toBe(false);
    }
    const object = { type: 'project', description: 'A project.', resolver: 'resolve' };
    expect(
      validateAppManifest(validManifest({ offeredTools: tools, objects: [object, object] })).ok,
    ).toBe(false);
  });

  it('steht im JSON-Schema', () => {
    const schema = appManifestJsonSchema() as { properties: Record<string, unknown> };
    expect(schema.properties.objects).toBeDefined();
    expect(schema.properties.actions).toBeDefined();
  });
});
