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
