/**
 * `POST /api/apps/<app>/tools/<tool>` — eine App ruft das Tool einer anderen
 * App (ADR 0020). Getrennt von der Route, damit die Tests sie ohne Next und
 * ohne Datenbank pruefen.
 *
 * Die Pruefkette, in dieser Reihenfolge, und keine wird uebersprungen:
 *
 * 1. Body lesen (hoechstens 1 MiB) — die Signatur haengt an ihm.
 * 2. Aufrufer pruefen (`verifyAppCaller`): Signatur mit dem Call-Secret der
 *    App, Zeitfenster, App registriert und nicht archiviert. Sonst 401.
 * 3. Freigabe `execute` auf `<app>.<tool>` und Weiterleitung
 *    (`callAppTool`, derselbe Weg wie fuer Agents). Ohne Freigabe 403.
 *
 * Jede Antwort ausser 2xx heisst „nein". Ein Fehler der Ziel-App kommt mit
 * ihrem Status zurueck (400, 404 …), damit die aufrufende App unterscheiden
 * kann, ob ein neuer Versuch lohnt.
 *
 * Das Ziel `platform` (ADR 0022 A) ist keine App: Nach derselben
 * Signaturpruefung gehen `emit_event`, `poll_events`, `ack_events` und
 * `set_refs` (ADR 0023), `generate` und `embed` (ADR 0024 D) an die Domaene
 * (`callPlatformTool`), jedes mit seiner eigenen Freigabe `execute` auf
 * `tool:platform.<name>`. `model_info` (ADR 0025) hat keine eigene
 * Freigabe, es braucht `execute` auf `generate` oder `embed`. Falsche Form 400, unbekanntes Tool 404, ohne
 * Modell 503 `not_configured`, Tagesgrenze 429 `budget_exceeded`.
 */

import { APP_CALL_MAX_BODY_BYTES } from '@openapps/sdk';
import {
  AppToolError,
  callAppTool,
  callPlatformTool,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  PLATFORM_TARGET,
  ValidationError,
  UnauthenticatedCallerError,
  verifyAppCaller,
  type AppToolInvoker,
  type DomainContext,
} from '../domain';
import { jsonResponse } from './http';

const APP_SEGMENT = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const TOOL_SEGMENT = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export async function handleAppCall(
  ctx: DomainContext,
  invoker: AppToolInvoker,
  request: Request,
  params: { readonly app: string; readonly tool: string },
): Promise<Response> {
  const app = safeDecode(params.app);
  const tool = safeDecode(params.tool);
  if (app === null || tool === null || !APP_SEGMENT.test(app) || !TOOL_SEGMENT.test(tool)) {
    return jsonResponse({ error: 'not_found', message: 'unknown app tool' }, 404);
  }

  let body: string;
  try {
    body = await readBody(request, APP_CALL_MAX_BODY_BYTES);
  } catch {
    return jsonResponse(
      { error: 'invalid', message: `body larger than ${String(APP_CALL_MAX_BODY_BYTES)} bytes` },
      413,
    );
  }

  const correlationId = request.headers.get('x-correlation-id') ?? undefined;
  try {
    const actor = await verifyAppCaller(ctx, {
      headers: request.headers,
      app,
      tool,
      body,
      ...(correlationId === undefined ? {} : { correlationId }),
    });

    const args = parseArgs(body);
    if (args === null) {
      return jsonResponse({ error: 'invalid', message: 'body must be a JSON object' }, 400);
    }

    if (app === PLATFORM_TARGET) {
      const value = await callPlatformTool(ctx, {
        actor,
        tool,
        args,
        ...(correlationId === undefined ? {} : { correlationId }),
      });
      return jsonResponse(value ?? null);
    }

    const value = await callAppTool(ctx, {
      actor,
      toolResourceId: `${app}.${tool}`,
      args,
      invoker,
      ...(correlationId === undefined ? {} : { correlationId }),
    });
    return jsonResponse(value ?? null);
  } catch (error) {
    if (error instanceof UnauthenticatedCallerError) {
      // Keine Einzelheiten: Wer nicht nachweislich eine App ist, erfaehrt
      // nicht, woran es lag. Der Grund steht im Audit-Log.
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
    if (error instanceof PermissionDeniedError) {
      return jsonResponse({ error: 'permission_denied', message: error.message }, 403);
    }
    if (error instanceof ValidationError) {
      return jsonResponse({ error: 'invalid', message: error.message }, 400);
    }
    if (error instanceof NotFoundError) {
      return jsonResponse({ error: 'not_found', message: error.message }, 404);
    }
    if (error instanceof DomainError && error.code === 'not_configured') {
      return jsonResponse({ error: 'not_configured', message: error.message }, 503);
    }
    // ADR 0024 C: Tagesgrenze erreicht. 429, damit die App spaeter neu versucht.
    if (error instanceof DomainError && error.code === 'budget_exceeded') {
      return jsonResponse({ error: 'budget_exceeded', message: error.message }, 429);
    }
    // Der Modell-Anbieter hat nicht geantwortet; die Meldung ist unsere, nie seine.
    if (error instanceof DomainError && error.code === 'model_error') {
      return jsonResponse({ error: 'model_error', message: error.message }, 502);
    }
    if (error instanceof AppToolError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return jsonResponse(error.body ?? { error: 'app_error', message: error.message }, status);
    }
    console.error('[app-call]', error);
    return jsonResponse({ error: 'target_error', message: 'the app could not be called' }, 502);
  }
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseArgs(body: string): Record<string, unknown> | null {
  if (body.trim() === '') return {};
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readBody(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('too large');
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('too large');
  return text;
}
