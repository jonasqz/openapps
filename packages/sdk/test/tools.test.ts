import { describe, expect, it, vi } from 'vitest';
import {
  createToolRoute,
  GROUPS_HEADER,
  ISSUED_AT_HEADER,
  parseArgs,
  SIGNATURE_HEADER,
  signatureFor,
  ToolInputError,
  ToolNotFoundError,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  type ToolRouteOptions,
} from '../src/index.js';

const SECRET = 's'.repeat(48);
const APP_ID = 'crm';
const APP_HOST = 'apps.example.test';
const NOW_SECONDS = 1_794_387_600;
const OPTIONS: ToolRouteOptions = {
  secret: SECRET,
  appId: APP_ID,
  appHost: APP_HOST,
  now: () => NOW_SECONDS * 1000,
  onError: () => undefined,
};

function signed(userId = 'agent:vertrieb'): Record<string, string> {
  const values = {
    userId,
    email: 'vertrieb@agents.invalid',
    groups: '',
    issuedAt: String(NOW_SECONDS),
  };
  return {
    [USER_ID_HEADER]: values.userId,
    [USER_EMAIL_HEADER]: values.email,
    [GROUPS_HEADER]: values.groups,
    [ISSUED_AT_HEADER]: values.issuedAt,
    [SIGNATURE_HEADER]: signatureFor({ secret: SECRET, appId: APP_ID, host: APP_HOST, ...values }),
  };
}

function call(
  route: ReturnType<typeof createToolRoute>,
  tool: string,
  init: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  const request = new Request(`http://crm:3000/crm/api/tools/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? signed()) },
    body: init.body ?? '{}',
  });
  return route(request, { params: Promise.resolve({ tool }) });
}

describe('createToolRoute — die riskanten Pfade zuerst', () => {
  it('weist einen Aufruf ohne Signatur ab, bevor ein Handler laeuft', async () => {
    const handler = vi.fn(async () => 'nie');
    const route = createToolRoute({ 'contacts.list': handler }, OPTIONS);
    const response = await call(route, 'contacts.list', { headers: {} });
    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('verraet ohne Signatur nicht, ob es ein Tool gibt', async () => {
    const route = createToolRoute({}, OPTIONS);
    const response = await call(route, 'gibt.es.nicht', { headers: {} });
    expect(response.status).toBe(401);
  });

  it('weist eine Signatur mit falschem Secret ab', async () => {
    const route = createToolRoute({ x: async () => 1 }, { ...OPTIONS, secret: 'y'.repeat(48) });
    expect((await call(route, 'x')).status).toBe(401);
  });

  it('nimmt keine geerbten Eigenschaften als Tool', async () => {
    const route = createToolRoute({}, OPTIONS);
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect((await call(route, name)).status).toBe(404);
    }
  });

  it('gibt bei unerwarteten Fehlern nichts Internes heraus', async () => {
    const route = createToolRoute(
      {
        boom: async () => {
          throw new Error('relation "geheim" does not exist');
        },
      },
      OPTIONS,
    );
    const response = await call(route, 'boom');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('geheim');
  });
});

describe('createToolRoute — der normale Weg', () => {
  it('ruft den Handler mit Argumenten und Aufrufer', async () => {
    const route = createToolRoute(
      { 'contacts.create': async (args, { user }) => ({ args, by: user.id }) },
      OPTIONS,
    );
    const response = await call(route, 'contacts.create', { body: '{"name":"Ada"}' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ args: { name: 'Ada' }, by: 'agent:vertrieb' });
  });

  it('nimmt einen leeren Body als leere Argumente', async () => {
    const route = createToolRoute({ t: async (args) => args }, OPTIONS);
    expect(await (await call(route, 't', { body: '' })).json()).toEqual({});
  });

  it('antwortet 400 auf kaputtes JSON', async () => {
    const route = createToolRoute({ t: async () => 1 }, OPTIONS);
    expect((await call(route, 't', { body: '{kaputt' })).status).toBe(400);
  });

  it('reicht Eingabe- und Nicht-gefunden-Fehler mit Meldung durch', async () => {
    const route = createToolRoute(
      {
        bad: async () => {
          throw new ToolInputError('name missing');
        },
        gone: async () => {
          throw new ToolNotFoundError('contact not found');
        },
      },
      OPTIONS,
    );
    const bad = await call(route, 'bad');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ message: 'name missing' });
    const gone = await call(route, 'gone');
    expect(gone.status).toBe(404);
  });

  it('lehnt zu grosse Bodies ab', async () => {
    const route = createToolRoute({ t: async () => 1 }, { ...OPTIONS, maxBodyBytes: 10 });
    expect((await call(route, 't', { body: JSON.stringify({ x: 'y'.repeat(50) }) })).status).toBe(
      400,
    );
  });
});

describe('parseArgs', () => {
  const schema = {
    safeParse(value: unknown) {
      return typeof value === 'object' && value !== null && 'name' in value
        ? ({ success: true, data: value as { name: string } } as const)
        : ({ success: false, error: { issues: [{ path: ['name'] }] } } as const);
    },
  };

  it('wirft ToolInputError mit den Befunden', () => {
    expect(() => parseArgs(schema, {})).toThrowError(ToolInputError);
  });

  it('gibt die geprueften Daten zurueck', () => {
    expect(parseArgs(schema, { name: 'Ada' })).toEqual({ name: 'Ada' });
  });
});
