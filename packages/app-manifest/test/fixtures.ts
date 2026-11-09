import type { AppManifestInput } from '../src/index.js';

export function validManifest(overrides: Partial<AppManifestInput> = {}): AppManifestInput {
  return {
    manifestVersion: 1,
    name: 'projektliste',
    displayName: 'Projektliste',
    description: 'Liste der laufenden Projekte des Teams.',
    category: 'produktivitaet',
    version: '0.1.0',
    requiredTables: [{ name: 'projects', description: 'Ein Projekt pro Zeile.' }],
    offeredTools: [
      {
        name: 'projects.list',
        description: 'Listet Projekte.',
        verb: 'read',
        operationId: 'listProjects',
      },
    ],
    requestedGrants: [
      {
        subjectKind: 'group',
        subjectId: 'team',
        verb: 'read',
        resource: { kind: 'app', app: 'projektliste' },
        reason: 'Das Team soll die Liste öffnen können.',
      },
    ],
    env: [
      { name: 'DATABASE_URL', secret: true, description: 'Verbindung zum eigenen Schema.' },
      { name: 'LOG_LEVEL', secret: false, description: 'Log-Stufe.', default: 'info' },
    ],
    egress: [
      {
        host: 'api.github.com',
        protocol: 'https',
        reason: 'Repo-Metadaten für die Projektliste.',
      },
    ],
    source: { git: 'https://github.com/blyck/projektliste.git', tag: 'v0.1.0' },
    ...overrides,
  };
}
