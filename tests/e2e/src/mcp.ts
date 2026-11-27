/**
 * Der Plattform-MCP als `operator`, wie in
 * `apps/platform-mcp/tests/lokal-e2e.spec.ts`. Ueber ihn setzen und entziehen
 * die Tests Freigaben: Das ist die API der Control Plane fuer Agents
 * (ADR 0009), und die REST-Routen unter `/api` nehmen nur Sessions an.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { MCP_URL, operatorToken } from './stack';

export interface ToolResult {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

/** Der Ausschnitt einer App aus `list_apps`, den die Tests brauchen. */
export interface ListedApp {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly primaryDomain: string | null;
  readonly archivedAt: string | null;
  readonly currentDeploymentId: string | null;
  readonly manifest: Record<string, unknown> & { readonly version: string };
}

export interface ListedGrant {
  readonly id: string;
  readonly subject: { readonly kind: string; readonly id: string };
  readonly verb: string;
  readonly resource: { readonly kind: string; readonly id: string };
  readonly revokedAt: string | null;
}

export class OperatorMcp {
  private constructor(private readonly client: Client) {}

  static async connect(): Promise<OperatorMcp> {
    return OperatorMcp.connectWithToken(operatorToken());
  }

  /**
   * Als ein anderer Agent, etwa einer, den der Test mit `create_agent`
   * angelegt hat. Das Token bleibt im Prozess und wird nie ausgegeben.
   */
  static async connectWithToken(token: string): Promise<OperatorMcp> {
    const client = new Client({ name: 'openapps-e2e', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    });
    // Das SDK (1.12.1) typisiert optionale Felder ohne `| undefined`; mit
    // `exactOptionalPropertyTypes` passt seine Klasse nicht zu seinem eigenen
    // Interface. Zur Laufzeit ist es dieselbe Form (wie in platform-mcp).
    await client.connect(transport as unknown as Transport);
    return new OperatorMcp(client);
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    let result: Awaited<ReturnType<Client['callTool']>>;
    try {
      result = await this.client.callTool({ name, arguments: args });
    } catch (error) {
      // Das SDK prueft das Eingabe-Schema selbst und antwortet bei einem
      // Verstoss mit einem Protokollfehler statt mit einem Ergebnis.
      return {
        ok: false,
        error: {
          code: 'mcp_error',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    const content = result.content as { type: string; text: string }[];
    const text = content[0]?.text ?? 'null';
    try {
      return JSON.parse(text) as ToolResult;
    } catch {
      // `isError` mit Klartext, etwa „Invalid arguments" aus dem SDK.
      return { ok: false, error: { code: 'mcp_error', message: text } };
    }
  }

  /** Wie `call`, aber ein `ok: false` ist ein Fehler mit Code und Meldung. */
  async must<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const result = await this.call(name, args);
    if (!result.ok) {
      throw new Error(
        `${name} failed: ${result.error?.code ?? 'unknown'}: ${result.error?.message ?? ''}`,
      );
    }
    return result.value as T;
  }

  /** Alle deployten, nicht archivierten Apps, nach Name sortiert. */
  async deployedApps(): Promise<readonly ListedApp[]> {
    const { apps } = await this.must<{ apps: ListedApp[] }>('list_apps', {});
    return apps
      .filter((app) => app.archivedAt === null && app.primaryDomain !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Aktive Freigaben, deren Subjekt dieser Nutzer ist. */
  async activeGrantsOfUser(userId: string): Promise<readonly ListedGrant[]> {
    const { grants } = await this.must<{ grants: ListedGrant[] }>('list_grants', { all: true });
    return grants.filter(
      (g) => g.revokedAt === null && g.subject.kind === 'user' && g.subject.id === userId,
    );
  }

  /** `read` auf eine App fuer einen Nutzer. Gibt die Id der Freigabe zurueck. */
  async grantAppRead(userId: string, appName: string): Promise<string> {
    const { grant } = await this.must<{ grant: { id: string } }>('grant', {
      subjectKind: 'user',
      subjectId: userId,
      verb: 'read',
      resourceKind: 'app',
      resourceId: appName,
    });
    return grant.id;
  }

  async revoke(grantId: string): Promise<void> {
    await this.must('revoke', { grantId });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
