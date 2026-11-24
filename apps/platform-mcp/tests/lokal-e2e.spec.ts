/**
 * Ende-zu-Ende gegen den laufenden lokalen Stapel (infra/lokal, ADR 0011):
 * dieselben Wege, die die Claude-Agents im ersten Lauf gegangen sind, aber
 * ohne Sprachmodell und deshalb wiederholbar. Gefunden hatten jene Laeufe
 * sieben Fehler, die kein Unit-Test sah. Dieser Test haelt sie fest.
 *
 * Laeuft nur mit `LOKAL_E2E=1` und braucht das Token von `betrieb` aus
 * `infra/lokal/.agents/betrieb.token` (legt `apps-ausrollen.sh` an):
 *
 *   LOKAL_E2E=1 pnpm --filter @openapps/platform-mcp test lokal-e2e
 *
 * Jeder Lauf legt zwei neue Agents an (Namen mit Zeitstempel) und sperrt sie
 * am Ende. Agents lassen sich nicht loeschen, damit das Audit-Log eindeutig
 * bleibt; im lokalen Stapel ist das unschaedlich.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ENABLED = process.env.LOKAL_E2E === '1';
const MCP_URL = process.env.LOKAL_MCP_URL ?? 'http://localhost:8080/mcp';
const TOKEN_FILE = join(__dirname, '../../../infra/lokal/.agents/betrieb.token');

interface ToolResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { code: string; message: string };
}

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'lokal-e2e', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  // Das SDK (1.12.1) typisiert optionale Felder ohne `| undefined`; mit
  // `exactOptionalPropertyTypes` passt seine eigene Klasse dann nicht zu
  // seinem eigenen Interface. Zur Laufzeit ist es dieselbe Form.
  await client.connect(transport as unknown as Transport);
  return client;
}

async function call(client: Client, name: string, args: unknown): Promise<ToolResult> {
  const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]?.text ?? 'null') as ToolResult;
}

async function toolNames(client: Client): Promise<string[]> {
  return (await client.listTools()).tools.map((tool) => tool.name);
}

describe.skipIf(!ENABLED)('lokaler Stapel: Agents ueber den Plattform-MCP', () => {
  const stamp = Date.now().toString(36);
  const leser = `e2e-leser-${stamp}`;
  const schreiber = `e2e-schreiber-${stamp}`;
  let betrieb: Client;
  let leserClient: Client;
  let schreiberClient: Client;
  let schreiberToken: string;

  beforeAll(async () => {
    betrieb = await connect(readFileSync(TOKEN_FILE, 'utf8').trim());

    const tokens: Record<string, string> = {};
    for (const name of [leser, schreiber]) {
      const created = await call(betrieb, 'create_agent', { name });
      expect(created.ok, JSON.stringify(created.error)).toBe(true);
      tokens[name] = (created.value as { token: string }).token;
    }
    const grants: [string, string][] = [
      [leser, 'wiki.pages.list'],
      [leser, 'wiki.pages.search'],
      [schreiber, 'crm.companies.create'],
      [schreiber, 'crm.companies.list'],
      [schreiber, 'crm.activities.log'],
    ];
    for (const [subjectId, resourceId] of grants) {
      const granted = await call(betrieb, 'grant', {
        subjectKind: 'agent',
        subjectId,
        verb: 'execute',
        resourceKind: 'tool',
        resourceId,
      });
      // Fehler 3 aus ADR 0011: Tool-Ids mit Punkt liessen sich nicht freigeben.
      expect(granted.ok, JSON.stringify(granted.error)).toBe(true);
    }

    leserClient = await connect(tokens[leser] ?? '');
    schreiberToken = tokens[schreiber] ?? '';
    schreiberClient = await connect(schreiberToken);
  }, 60_000);

  afterAll(async () => {
    for (const name of [leser, schreiber]) {
      await call(betrieb, 'disable_agent', { name }).catch(() => undefined);
    }
    await Promise.all([betrieb?.close(), leserClient?.close(), schreiberClient?.close()]);
  });

  it('zeigt jedem Agent nur seine Tools, unter gueltigen Namen', async () => {
    const names = await toolNames(leserClient);
    // Fehler 4: Punkte im Namen machten die Tools fuer Claude unsichtbar.
    expect(names).toContain('wiki__pages__list');
    expect(names).toContain('wiki__pages__search');
    expect(names).not.toContain('wiki__pages__create');
    expect(names.some((name) => name.startsWith('crm__'))).toBe(false);
    for (const name of names) expect(name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it('kommt mit Argumenten bis in die App und zurueck', async () => {
    // Fehler 1 und 5: Aufrufe scheiterten am Gateway, Argumente gingen verloren.
    const found = await call(leserClient, 'wiki__pages__search', {
      args: { query: 'Urlaub', limit: 3 },
    });
    expect(found.ok, JSON.stringify(found.error)).toBe(true);
    expect(JSON.stringify(found.value)).toContain('Urlaubsregel');
  });

  it('gibt die Meldung der App bei falschen Argumenten weiter', async () => {
    const wrong = await call(leserClient, 'wiki__pages__search', { args: { q: 'Urlaub' } });
    expect(wrong.ok).toBe(false);
    expect(wrong.error?.code).toBe('app_error');
    expect(wrong.error?.message).toMatch(/400/);
  });

  it('bietet ein nicht freigegebenes Tool nicht an und fuehrt es nicht aus', async () => {
    // Nicht angemeldet heisst: Der MCP kennt das Tool fuer diesen Agent gar
    // nicht und antwortet mit einem Protokollfehler, nicht mit einem Ergebnis.
    await expect(
      leserClient.callTool({
        name: 'wiki__pages__create',
        arguments: { args: { title: 'Heimlich', content: 'x' } },
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('lehnt eine Selbstfreigabe ab', async () => {
    const self = await call(leserClient, 'grant', {
      subjectKind: 'agent',
      subjectId: leser,
      verb: 'execute',
      resourceKind: 'tool',
      resourceId: 'wiki.pages.create',
    });
    expect(self.ok).toBe(false);
    expect(self.error?.code).toBe('permission_denied');
  });

  it('schreibt mit dem Agent als Urheber', async () => {
    const name = `E2E Firma ${stamp}`;
    const created = await call(schreiberClient, 'crm__companies__create', { args: { name } });
    expect(created.ok, JSON.stringify(created.error)).toBe(true);
    const companyId = (created.value as { company: { id: string } }).company.id;

    const listed = await call(schreiberClient, 'crm__companies__list', { args: {} });
    expect(JSON.stringify(listed.value)).toContain(name);

    // Die App bekommt den Agent als Nutzer: `user.id` ist `agent:<name>`.
    const logged = await call(schreiberClient, 'crm__activities__log', {
      args: { kind: 'notiz', subject: 'E2E', companyId },
    });
    expect(logged.ok, JSON.stringify(logged.error)).toBe(true);
    expect((logged.value as { activity: { createdBy: string } }).activity.createdBy).toBe(
      `agent:${schreiber}`,
    );
  });

  it('sperrt einen Agent mit sofortiger Wirkung', async () => {
    const disabled = await call(betrieb, 'disable_agent', { name: schreiber });
    expect(disabled.ok, JSON.stringify(disabled.error)).toBe(true);
    await expect(connect(schreiberToken)).rejects.toThrow();
  });
});
