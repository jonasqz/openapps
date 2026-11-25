import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  SIGNATURE_HEADER,
  signatureFor,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
} from '@openapps/sdk';

/**
 * Die riskanten Pfade: Wer ohne gueltige Signatur der Plattform kommt, darf
 * weder ein Tool ausfuehren noch ueber eine Server Action etwas aendern — und
 * erfaehrt nicht einmal, welche Tools es gibt. Die Fachlogik ist hier
 * gemockt: Ein Test, der sie erreicht, haette die Pruefung umgangen.
 */

const documents = vi.hoisted(() => ({
  addDocument: vi.fn(),
  deleteDocument: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
  chunkPendingDocuments: vi.fn(),
}));
vi.mock('@/lib/documents', () => documents);

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => requestHeaders.current }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const SECRET = 'w'.repeat(48);
const APP_ID = 'knowledge';
const APP_HOST = 'apps.example.test';

function signedHeaders(overrides: Partial<Record<string, string>> = {}): Headers {
  const values = {
    userId: 'agent:recherche',
    email: 'recherche@agents.invalid',
    groups: '',
    issuedAt: String(Math.floor(Date.now() / 1000)),
  };
  const headers = new Headers({
    [USER_ID_HEADER]: values.userId,
    [USER_EMAIL_HEADER]: values.email,
    [GROUPS_HEADER]: values.groups,
    [ISSUED_AT_HEADER]: values.issuedAt,
    [SIGNATURE_HEADER]: signatureFor({ secret: SECRET, appId: APP_ID, host: APP_HOST, ...values }),
  });
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

function toolRequest(tool: string, body: unknown, headers: Headers = new Headers()) {
  headers.set('content-type', 'application/json');
  return {
    request: new Request(`http://knowledge.internal/knowledge/api/tools/${tool}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ tool }) },
  };
}

beforeEach(() => {
  vi.stubEnv('OPENAPPS_AUTH_SECRET', SECRET);
  vi.stubEnv('OPENAPPS_APP_ID', APP_ID);
  vi.stubEnv('OPENAPPS_APP_HOST', APP_HOST);
  vi.stubEnv('DATABASE_URL', '');
  for (const fn of Object.values(documents)) fn.mockReset();
  requestHeaders.current = new Headers();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Tool-Route ohne gültige Signatur', () => {
  it('weist einen Aufruf ganz ohne Auth-Header mit 401 ab', async () => {
    const { POST } = await import('@/app/api/tools/[tool]/route');
    const { request, context } = toolRequest('documents.add', { title: 'x', content: 'y' });
    const response = await POST(request, context);
    expect(response.status).toBe(401);
    expect(documents.addDocument).not.toHaveBeenCalled();
  });

  it('weist eine gefälschte Signatur ab, auch wenn alle Header da sind', async () => {
    const { POST } = await import('@/app/api/tools/[tool]/route');
    const headers = signedHeaders({ [SIGNATURE_HEADER]: 'a'.repeat(64) });
    const { request, context } = toolRequest('documents.delete', { id: crypto.randomUUID() }, headers);
    expect((await POST(request, context)).status).toBe(401);
    expect(documents.deleteDocument).not.toHaveBeenCalled();
  });

  it('weist eine Signatur ab, die für eine andere Identität ausgestellt war', async () => {
    const { POST } = await import('@/app/api/tools/[tool]/route');
    const headers = signedHeaders({ [USER_ID_HEADER]: 'agent:jemand-anderes' });
    const { request, context } = toolRequest('documents.list', {}, headers);
    expect((await POST(request, context)).status).toBe(401);
    expect(documents.listDocuments).not.toHaveBeenCalled();
  });

  it('verrät unbekannte Tools erst nach der Signatur', async () => {
    const { POST } = await import('@/app/api/tools/[tool]/route');
    const unsigned = toolRequest('gibt.es.nicht', {});
    expect((await POST(unsigned.request, unsigned.context)).status).toBe(401);
    const signed = toolRequest('gibt.es.nicht', {}, signedHeaders());
    expect((await POST(signed.request, signed.context)).status).toBe(404);
  });
});

describe('Tool-Route mit gültiger Signatur', () => {
  it('ruft documents.add mit der Identität aus der Signatur als Urheber', async () => {
    documents.addDocument.mockResolvedValue({ id: 'd1', chunkCount: 1 });
    const { POST } = await import('@/app/api/tools/[tool]/route');
    const { request, context } = toolRequest(
      'documents.add',
      { title: ' Handbuch ', content: 'Text', source: '' },
      signedHeaders(),
    );
    const response = await POST(request, context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: 'd1', chunkCount: 1 });
    expect(documents.addDocument).toHaveBeenCalledWith(
      { title: 'Handbuch', content: 'Text', source: null },
      'agent:recherche',
    );
  });

  it('antwortet auf falsche Argumente mit 400 und Befunden, ohne die Fachlogik zu erreichen', async () => {
    const { POST } = await import('@/app/api/tools/[tool]/route');
    const { request, context } = toolRequest(
      'documents.add',
      { title: 'x', text: 'falsches Feld' },
      signedHeaders(),
    );
    const response = await POST(request, context);
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe('invalid');
    expect(body.issues.length).toBeGreaterThan(0);
    expect(documents.addDocument).not.toHaveBeenCalled();
  });

  it('gibt bei einem internen Fehler 500 ohne Einzelheiten zurück', async () => {
    documents.listDocuments.mockRejectedValue(new Error('relation "documents" does not exist'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { POST } = await import('@/app/api/tools/[tool]/route');
    const { request, context } = toolRequest('documents.list', {}, signedHeaders());
    const response = await POST(request, context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('relation');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('Server Actions der UI', () => {
  it('addDocumentAction weist ohne gültige Signatur ab und legt nichts an', async () => {
    const { addDocumentAction } = await import('@/app/actions');
    const result = await addDocumentAction({ title: 'T', source: '', content: 'Text' });
    expect(result.ok).toBe(false);
    expect(documents.addDocument).not.toHaveBeenCalled();
  });

  it('deleteDocumentAction weist ohne gültige Signatur ab und löscht nichts', async () => {
    requestHeaders.current = signedHeaders({ [SIGNATURE_HEADER]: 'b'.repeat(64) });
    const { deleteDocumentAction } = await import('@/app/actions');
    const result = await deleteDocumentAction(crypto.randomUUID());
    expect(result.ok).toBe(false);
    expect(documents.deleteDocument).not.toHaveBeenCalled();
  });

  it('addDocumentAction legt mit gültiger Signatur unter der Identität des Nutzers an', async () => {
    requestHeaders.current = signedHeaders({});
    documents.addDocument.mockResolvedValue({ id: 'd2', chunkCount: 3 });
    const { addDocumentAction } = await import('@/app/actions');
    const result = await addDocumentAction({ title: 'T', source: 'Wiki', content: 'Text' });
    expect(result).toEqual({ ok: true, id: 'd2', chunkCount: 3 });
    expect(documents.addDocument).toHaveBeenCalledWith(
      { title: 'T', source: 'Wiki', content: 'Text' },
      'agent:recherche',
    );
  });

  it('addDocumentAction meldet Feldfehler am Feld, ohne die Datenbank zu erreichen', async () => {
    requestHeaders.current = signedHeaders({});
    const { addDocumentAction } = await import('@/app/actions');
    const result = await addDocumentAction({ title: '   ', source: '', content: '  ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(['content', 'title']);
    expect(documents.addDocument).not.toHaveBeenCalled();
  });
});
