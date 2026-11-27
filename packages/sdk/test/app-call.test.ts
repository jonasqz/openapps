import { describe, expect, it } from 'vitest';
import {
  AppCallError,
  appCallSignatureFor,
  callAppTool,
  callerOf,
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  sha256Hex,
} from '../src/index.js';

/**
 * Der Aufruf von App zu App (ADR 0020), Seite der aufrufenden App. Riskant:
 * ein Secret in einer Meldung, ein Aufruf ohne Signatur, ein Fehler, der wie
 * Erfolg aussieht.
 */

const SECRET = 'c'.repeat(64);
const NOW = 1_794_387_600_000;

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(
  answer: (captured: Captured) => Response | Promise<Response>,
  calls: Captured[] = [],
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const captured = { url: String(input), init: init ?? {} };
    calls.push(captured);
    return answer(captured);
  }) as typeof fetch;
}

const base = {
  platformUrl: 'http://openapps-control-plane:3000/',
  secret: SECRET,
  caller: 'wiki',
  now: () => NOW,
};

describe('callAppTool', () => {
  it('signiert Aufrufer, Ziel, Tool, Zeit und Body und gibt das Ergebnis zurueck', async () => {
    const calls: Captured[] = [];
    const result = await callAppTool(
      'knowledge',
      'documents.upsert',
      { key: 'p1', title: 'T' },
      { ...base, fetch: fakeFetch(() => Response.json({ id: 'd1' }), calls) },
    );
    expect(result).toEqual({ id: 'd1' });
    const call = calls[0];
    expect(call?.url).toBe(
      'http://openapps-control-plane:3000/api/apps/knowledge/tools/documents.upsert',
    );
    const headers = call?.init.headers as Record<string, string>;
    const body = String(call?.init.body);
    expect(headers[CALLER_HEADER]).toBe('wiki');
    expect(headers[CALLER_ISSUED_AT_HEADER]).toBe(String(NOW / 1000));
    expect(headers[CALLER_SIGNATURE_HEADER]).toBe(
      appCallSignatureFor({
        secret: SECRET,
        caller: 'wiki',
        app: 'knowledge',
        tool: 'documents.upsert',
        issuedAt: String(NOW / 1000),
        bodySha256: sha256Hex(body),
      }),
    );
    // Das Secret selbst geht nie mit.
    expect(JSON.stringify(call?.init)).not.toContain(SECRET);
  });

  it('bricht ohne Secret ab, bevor ein Aufruf rausgeht', async () => {
    const calls: Captured[] = [];
    await expect(
      callAppTool(
        'knowledge',
        'search',
        {},
        {
          ...base,
          secret: '',
          fetch: fakeFetch(() => Response.json({}), calls),
        },
      ),
    ).rejects.toMatchObject({ code: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('nimmt keine Plattform-Adresse mit Zugangsdaten', async () => {
    await expect(
      callAppTool(
        'knowledge',
        'search',
        {},
        {
          ...base,
          platformUrl: 'http://user:pw@cp:3000',
          fetch: fakeFetch(() => Response.json({})),
        },
      ),
    ).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('weist einen Zielnamen ab, der einen Pfad baut', async () => {
    await expect(
      callAppTool('../grants', 'x', {}, { ...base, fetch: fakeFetch(() => Response.json({})) }),
    ).rejects.toMatchObject({ code: 'invalid_target' });
  });

  it('ordnet die Antworten der Plattform Codes zu', async () => {
    const cases: [number, string][] = [
      [401, 'unauthorized'],
      [403, 'denied'],
      [400, 'invalid'],
      [404, 'not_found'],
      [502, 'target_error'],
    ];
    for (const [status, code] of cases) {
      const error = await callAppTool(
        'knowledge',
        'search',
        {},
        {
          ...base,
          fetch: fakeFetch(() =>
            Response.json({ error: 'x', message: `status ${String(status)}` }, { status }),
          ),
        },
      ).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppCallError);
      expect((error as AppCallError).code).toBe(code);
      expect((error as AppCallError).message).toContain(`status ${String(status)}`);
    }
  });

  it('meldet eine nicht erreichbare Plattform ohne die Meldung von fetch', async () => {
    const error = await callAppTool(
      'knowledge',
      'search',
      {},
      {
        ...base,
        fetch: fakeFetch(() => {
          throw new TypeError(`connect ECONNREFUSED secret=${SECRET}`);
        }),
      },
    ).catch((e: unknown) => e);
    expect((error as AppCallError).code).toBe('unreachable');
    expect((error as AppCallError).message).not.toContain(SECRET);
  });

  it('bricht nach dem Zeitlimit ab', async () => {
    const error = await callAppTool(
      'knowledge',
      'search',
      {},
      {
        ...base,
        timeoutMs: 20,
        fetch: (async (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          })) as typeof fetch,
      },
    ).catch((e: unknown) => e);
    expect((error as AppCallError).code).toBe('timeout');
  });
});

describe('callerOf', () => {
  it('erkennt eine App nur mit passender Id und E-Mail', () => {
    expect(callerOf({ id: 'app:wiki', email: 'wiki@apps.invalid' })).toEqual({
      kind: 'app',
      app: 'wiki',
    });
    expect(callerOf({ id: 'app:wiki', email: 'wiki@example.com' })).toEqual({
      kind: 'human',
      id: 'app:wiki',
    });
    expect(callerOf({ id: 'app:wiki', email: 'crm@apps.invalid' }).kind).toBe('human');
  });

  it('erkennt einen Agenten', () => {
    expect(callerOf({ id: 'agent:recherche', email: 'recherche@agents.invalid' })).toEqual({
      kind: 'agent',
      agent: 'recherche',
    });
  });

  it('alles andere ist ein Mensch', () => {
    expect(callerOf({ id: 'usr_1', email: 'lena@example.com' })).toEqual({
      kind: 'human',
      id: 'usr_1',
    });
  });
});
