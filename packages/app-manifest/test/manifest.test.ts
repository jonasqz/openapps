import { describe, expect, it } from 'vitest';
import {
  appManifestJsonSchema,
  parseAppManifest,
  validateAppManifest,
  ManifestValidationError,
} from '../src/index.js';
import { validManifest } from './fixtures.js';

/** Die riskanten Pfade zuerst: was das Review-Gate blockieren muss. */
describe('validateAppManifest', () => {
  it('nimmt ein vollständiges Manifest an und setzt Defaults', () => {
    const result = validateAppManifest(validManifest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.name).toBe('projektliste');
    expect(result.manifest.env[1]?.required).toBe(true);
  });

  it('lehnt ein Secret mit Default im Manifest ab (AGENTS.md Regel 5)', () => {
    const result = validateAppManifest(
      validManifest({
        env: [
          { name: 'API_KEY', secret: true, description: 'Fremder Dienst.', default: 'sk-live-xxx' },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('env.0.default');
  });

  it('lehnt ein unbekanntes Feld ab, statt es stillschweigend zu schlucken', () => {
    const result = validateAppManifest({ ...validManifest(), allowAllEgress: true });
    expect(result.ok).toBe(false);
  });

  it('lehnt eine Egress-Angabe mit Schema oder Pfad ab (Regel 7)', () => {
    const result = validateAppManifest(
      validManifest({
        egress: [{ host: 'https://api.example.com/v1', protocol: 'https', reason: 'x' }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('lehnt eine Version ab, die kein exaktes Semver ist', () => {
    expect(validateAppManifest(validManifest({ version: '^1.0.0' })).ok).toBe(false);
    expect(validateAppManifest(validManifest({ version: 'v1.0.0' })).ok).toBe(false);
  });

  it('verlangt bei Tabellen-Rechten einen Ressourcen-Namen', () => {
    const result = validateAppManifest(
      validManifest({
        requestedGrants: [
          {
            subjectKind: 'app',
            subjectId: 'crm',
            verb: 'read',
            resource: { kind: 'view', app: 'projektliste' },
            reason: 'CRM liest die aktiven Projekte.',
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('requestedGrants.0.resource.name');
  });

  it('meldet doppelte Tool-Namen', () => {
    const tool = {
      name: 'projects.list',
      description: 'Listet Projekte.',
      verb: 'read' as const,
      operationId: 'listProjects',
    };
    const result = validateAppManifest(validManifest({ offeredTools: [tool, tool] }));
    expect(result.ok).toBe(false);
  });

  it('parseAppManifest wirft mit lesbaren Befunden', () => {
    expect(() => parseAppManifest({}, 'app.json')).toThrowError(ManifestValidationError);
  });
});

describe('appManifestJsonSchema', () => {
  it('liefert ein JSON-Schema mit stabiler $id', () => {
    const schema = appManifestJsonSchema();
    expect(schema['$id']).toContain('app-manifest/v1');
    expect(JSON.stringify(schema)).toContain('manifestVersion');
  });
});

describe('gatewayContext (ADR 0020)', () => {
  it('ist optional: ein Manifest ohne das Feld bleibt gueltig', () => {
    const result = validateAppManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.gatewayContext).toBeUndefined();
  });

  it('nimmt readableApps an', () => {
    const result = validateAppManifest(validManifest({ gatewayContext: ['readableApps'] }));
    expect(result.ok).toBe(true);
  });

  it('weist unbekannten Kontext ab, statt ihn still zu ignorieren', () => {
    const result = validateAppManifest({ ...validManifest(), gatewayContext: ['allGrants'] });
    expect(result.ok).toBe(false);
  });
});

describe('databaseExtensions (ADR 0025)', () => {
  it('ist optional: ohne das Feld bekommt die App keine Erweiterung', () => {
    const result = validateAppManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.databaseExtensions).toBeUndefined();
  });

  it('nimmt vector an', () => {
    const result = validateAppManifest(validManifest({ databaseExtensions: ['vector'] }));
    expect(result.ok).toBe(true);
  });

  it('weist eine unbekannte Erweiterung ab: nur, was der Betreiber bereitstellt', () => {
    for (const name of ['postgis', 'plpython3u', 'dblink', 'pg_read_server_files']) {
      const result = validateAppManifest({ ...validManifest(), databaseExtensions: [name] });
      expect(result.ok, name).toBe(false);
    }
  });

  it('weist eine doppelte Erweiterung ab', () => {
    const result = validateAppManifest({
      ...validManifest(),
      databaseExtensions: ['vector', 'vector'],
    });
    expect(result.ok).toBe(false);
  });
});

describe('search (ADR 0021)', () => {
  const tools = [
    { name: 'projects.list', description: 'Listet.', verb: 'read' as const, operationId: 'list' },
    { name: 'projects.search', description: 'Sucht.', verb: 'read' as const, operationId: 'find' },
    {
      name: 'projects.purge',
      description: 'Loescht.',
      verb: 'write' as const,
      operationId: 'purge',
    },
  ];

  it('ist optional: ohne das Feld nimmt die App an der Suche nicht teil', () => {
    const result = validateAppManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.search).toBeUndefined();
  });

  it('nimmt ein lesendes Tool aus offeredTools an', () => {
    const result = validateAppManifest(
      validManifest({ offeredTools: tools, search: { tool: 'projects.search' } }),
    );
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('weist ein Tool ab, das nicht im Manifest steht', () => {
    const result = validateAppManifest(validManifest({ search: { tool: 'projects.search' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: 'search.tool',
        message: 'search tool "projects.search" is not in offeredTools',
      });
    }
  });

  it('weist ein schreibendes Tool ab: eine Suche darf nichts aendern', () => {
    const result = validateAppManifest(
      validManifest({ offeredTools: tools, search: { tool: 'projects.purge' } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('search.tool');
  });

  it('weist unbekannte Felder und falsche Tool-Namen ab', () => {
    expect(
      validateAppManifest({
        ...validManifest({ offeredTools: tools }),
        search: { tool: 'projects.search', format: 'passages' },
      }).ok,
    ).toBe(false);
    expect(
      validateAppManifest({
        ...validManifest({ offeredTools: tools }),
        search: { tool: 'Projects Search' },
      }).ok,
    ).toBe(false);
  });

  it('steht im JSON-Schema', () => {
    const schema = appManifestJsonSchema() as { properties: Record<string, unknown> };
    expect(schema.properties.search).toBeDefined();
  });
});

describe('events und subscriptions (ADR 0022)', () => {
  const event = {
    type: 'project.archived',
    description: 'A project was archived.',
    importance: 'normal' as const,
  };

  it('sind optional: ein Manifest ohne die Felder bleibt gueltig', () => {
    const result = validateAppManifest(validManifest());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.events).toBeUndefined();
      expect(result.manifest.subscriptions).toBeUndefined();
    }
  });

  it('nimmt erklaerte Ereignistypen und Abonnements an', () => {
    const result = validateAppManifest(
      validManifest({
        events: [event, { ...event, type: 'project.assigned', importance: 'high' }],
        subscriptions: [{ app: 'tasks', type: 'task.assigned' }],
      }),
    );
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('weist einen Typ ohne die Form <objekt>.<vorgang> ab', () => {
    for (const type of ['archived', 'Project.archived', 'project.archived.now', 'project-x.done']) {
      expect(validateAppManifest(validManifest({ events: [{ ...event, type }] })).ok, type).toBe(
        false,
      );
    }
  });

  it('weist eine unbekannte Wichtigkeit und unbekannte Felder ab', () => {
    expect(
      validateAppManifest({ ...validManifest(), events: [{ ...event, importance: 'urgent' }] }).ok,
    ).toBe(false);
    expect(
      validateAppManifest({ ...validManifest(), events: [{ ...event, audience: ['group:x'] }] }).ok,
    ).toBe(false);
  });

  it('meldet doppelte Typen und doppelte Abonnements', () => {
    const doubleEvents = validateAppManifest(validManifest({ events: [event, event] }));
    expect(doubleEvents.ok).toBe(false);
    if (!doubleEvents.ok) expect(doubleEvents.issues[0]?.path).toBe('events.1.type');

    const sub = { app: 'tasks', type: 'task.assigned' };
    expect(validateAppManifest(validManifest({ subscriptions: [sub, sub] })).ok).toBe(false);
  });

  it('weist ein Abonnement auf die eigenen Ereignisse ab', () => {
    const result = validateAppManifest(
      validManifest({ subscriptions: [{ app: 'projektliste', type: 'project.archived' }] }),
    );
    expect(result.ok).toBe(false);
  });

  it('steht im JSON-Schema', () => {
    const schema = appManifestJsonSchema() as { properties: Record<string, unknown> };
    expect(schema.properties.events).toBeDefined();
    expect(schema.properties.subscriptions).toBeDefined();
  });
});
