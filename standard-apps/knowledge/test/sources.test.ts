import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeReadableApps,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  READABLE_APPS_HEADER,
  READABLE_APPS_SIGNATURE_HEADER,
  readableAppsSignatureFor,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
} from '@openapps/sdk';

/**
 * Die riskanten Pfade der gemeinsamen Suche (ADR 0020), ohne Datenbank:
 *
 * - Die Quell-App kommt nur aus der geprueften Identitaet, nie aus den
 *   Argumenten. Ein Mensch oder Agent kann nichts als App abliefern, eine
 *   gefaelschte App-Identitaet kommt nicht an.
 * - Die lesbaren Apps kommen nur aus dem signierten Header. Fehlt er oder ist
 *   er gefaelscht, bekommt die Fachlogik `null` (nur eigene Dokumente).
 *
 * Die Fachlogik ist gemockt: Gepruefte wird, was bei ihr ankommt.
 */

const documents = vi.hoisted(() => ({
  addDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  upsertSourceDocument: vi.fn(),
  removeSourceDocument: vi.fn(),
  chunkPendingDocuments: vi.fn(),
}));
vi.mock('@/lib/documents', () => documents);

const retriever = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('@/lib/retriever', () => ({ createFulltextRetriever: () => retriever }));

const SECRET = 'k'.repeat(48);
const APP_ID = 'knowledge';
const APP_HOST = 'apps.example.test';

interface Identity {
  userId: string;
  email: string;
}

const WIKI: Identity = { userId: 'app:wiki', email: 'wiki@apps.invalid' };
const AGENT: Identity = { userId: 'agent:recherche', email: 'recherche@agents.invalid' };
const HUMAN: Identity = { userId: 'usr_lena', email: 'lena@example.com' };

function signed(identity: Identity, readable?: readonly string[], forgeReadable = false): Headers {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const headers = new Headers({
    [USER_ID_HEADER]: identity.userId,
    [USER_EMAIL_HEADER]: identity.email,
    [GROUPS_HEADER]: '',
    [ISSUED_AT_HEADER]: issuedAt,
    [SIGNATURE_HEADER]: signatureFor({
      secret: SECRET,
      appId: APP_ID,
      host: APP_HOST,
      userId: identity.userId,
      email: identity.email,
      groups: '',
      issuedAt,
    }),
  });
  if (readable !== undefined) {
    const value = encodeReadableApps(readable);
    headers.set(READABLE_APPS_HEADER, value);
    headers.set(
      READABLE_APPS_SIGNATURE_HEADER,
      forgeReadable
        ? 'f'.repeat(64)
        : readableAppsSignatureFor({
            secret: SECRET,
            appId: APP_ID,
            host: APP_HOST,
            userId: identity.userId,
            issuedAt,
            value,
          }),
    );
  }
  return headers;
}

async function callTool(tool: string, body: unknown, headers: Headers) {
  const { POST } = await import('@/app/api/tools/[tool]/route');
  headers.set('content-type', 'application/json');
  const response = await POST(
    new Request(`http://knowledge.internal/knowledge/api/tools/${tool}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ tool }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const UPSERT = { key: 'page-1', title: 'Onboarding', content: 'Erster Tag', path: '/pages/page-1' };

beforeEach(() => {
  vi.stubEnv('OPENAPPS_AUTH_SECRET', SECRET);
  vi.stubEnv('OPENAPPS_APP_ID', APP_ID);
  vi.stubEnv('OPENAPPS_APP_HOST', APP_HOST);
  vi.stubEnv('DATABASE_URL', '');
  for (const fn of Object.values(documents)) fn.mockReset();
  retriever.search.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('documents.upsert und documents.remove: die Quell-App kommt aus der Identitaet', () => {
  it('nimmt die Quell-App aus der geprueften Identitaet der App', async () => {
    documents.upsertSourceDocument.mockResolvedValue({ id: 'd1', key: 'page-1', status: 'created' });
    const result = await callTool('documents.upsert', UPSERT, signed(WIKI));
    expect(result.status).toBe(200);
    expect(documents.upsertSourceDocument).toHaveBeenCalledTimes(1);
    const [args, sourceApp, createdBy] = documents.upsertSourceDocument.mock.calls[0] ?? [];
    expect(sourceApp).toBe('wiki');
    expect(createdBy).toBe('app:wiki');
    expect(args).toMatchObject({ key: 'page-1', path: '/pages/page-1' });
  });

  it('weist ein Feld sourceApp in den Argumenten ab, statt es zu nutzen', async () => {
    const result = await callTool(
      'documents.upsert',
      { ...UPSERT, sourceApp: 'crm' },
      signed(WIKI),
    );
    expect(result.status).toBe(400);
    expect(documents.upsertSourceDocument).not.toHaveBeenCalled();
    const removed = await callTool(
      'documents.remove',
      { key: 'page-1', sourceApp: 'crm' },
      signed(WIKI),
    );
    expect(removed.status).toBe(400);
    expect(documents.removeSourceDocument).not.toHaveBeenCalled();
  });

  it('weist einen Menschen und einen Agenten ab: sie liefern nicht als App', async () => {
    for (const identity of [HUMAN, AGENT]) {
      const upsert = await callTool('documents.upsert', UPSERT, signed(identity));
      expect(upsert.status).toBe(400);
      expect(String(upsert.body.message)).toContain('documents.add');
      const remove = await callTool('documents.remove', { key: 'page-1' }, signed(identity));
      expect(remove.status).toBe(400);
    }
    expect(documents.upsertSourceDocument).not.toHaveBeenCalled();
    expect(documents.removeSourceDocument).not.toHaveBeenCalled();
  });

  it('haelt eine Nutzer-Id app:wiki mit echter E-Mail fuer einen Menschen', async () => {
    const result = await callTool(
      'documents.upsert',
      UPSERT,
      signed({ userId: 'app:wiki', email: 'mallory@example.com' }),
    );
    expect(result.status).toBe(400);
    expect(documents.upsertSourceDocument).not.toHaveBeenCalled();
  });

  it('weist eine gefaelschte App-Identitaet mit 401 ab', async () => {
    const headers = signed(WIKI);
    headers.set(SIGNATURE_HEADER, '0'.repeat(64));
    expect((await callTool('documents.upsert', UPSERT, headers)).status).toBe(401);
    const unsigned = new Headers({
      [USER_ID_HEADER]: 'app:wiki',
      [USER_EMAIL_HEADER]: 'wiki@apps.invalid',
    });
    expect((await callTool('documents.remove', { key: 'page-1' }, unsigned)).status).toBe(401);
    expect(documents.upsertSourceDocument).not.toHaveBeenCalled();
    expect(documents.removeSourceDocument).not.toHaveBeenCalled();
  });

  it('documents.remove nimmt ebenfalls nur die eigene Quell-App', async () => {
    documents.removeSourceDocument.mockResolvedValue({ key: 'page-1', removed: true });
    await callTool('documents.remove', { key: 'page-1' }, signed(WIKI));
    expect(documents.removeSourceDocument).toHaveBeenCalledWith({ key: 'page-1' }, 'wiki');
  });
});

describe('Lesende Tools: die lesbaren Apps kommen nur aus dem signierten Header', () => {
  it('reicht die signierte Liste an die Suche weiter', async () => {
    retriever.search.mockResolvedValue([]);
    await callTool('search', { query: 'Onboarding' }, signed(HUMAN, ['wiki']));
    expect(retriever.search).toHaveBeenCalledWith('Onboarding', 5, { readableApps: ['wiki'] });
  });

  it('ohne Header: null, also nur eigene Dokumente, und kein Fehler', async () => {
    retriever.search.mockResolvedValue([]);
    const result = await callTool('search', { query: 'Onboarding' }, signed(HUMAN));
    expect(result.status).toBe(200);
    expect(retriever.search).toHaveBeenCalledWith('Onboarding', 5, { readableApps: null });
  });

  it('mit gefaelschter Liste: null, auch fuer documents.list und documents.get', async () => {
    retriever.search.mockResolvedValue([]);
    documents.listDocuments.mockResolvedValue([]);
    documents.getDocument.mockResolvedValue({ document: {} });
    await callTool('search', { query: 'x' }, signed(HUMAN, ['wiki', 'crm'], true));
    await callTool('documents.list', {}, signed(HUMAN, ['wiki'], true));
    const id = crypto.randomUUID();
    await callTool('documents.get', { id }, signed(HUMAN, ['wiki'], true));
    expect(retriever.search).toHaveBeenCalledWith('x', 5, { readableApps: null });
    expect(documents.listDocuments).toHaveBeenCalledWith({}, { readableApps: null });
    expect(documents.getDocument).toHaveBeenCalledWith(
      { id, includeChunks: false },
      { readableApps: null },
    );
  });

  it('eine Liste, die fuer eine andere Person ausgestellt war, zaehlt nicht', async () => {
    retriever.search.mockResolvedValue([]);
    const lena = signed(HUMAN, ['wiki']);
    const other = signed(AGENT);
    // Identitaet des Agenten, Liste von Lena.
    other.set(READABLE_APPS_HEADER, lena.get(READABLE_APPS_HEADER) ?? '');
    other.set(READABLE_APPS_SIGNATURE_HEADER, lena.get(READABLE_APPS_SIGNATURE_HEADER) ?? '');
    await callTool('search', { query: 'x' }, other);
    expect(retriever.search).toHaveBeenCalledWith('x', 5, { readableApps: null });
  });
});
