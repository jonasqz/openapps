import { SdkError, UntrustedRequestError } from './errors.js';
import { getUser, type GetUserOptions, type PlatformUser } from './gateway.js';

/**
 * Der Endpunkt, ueber den Agents die Tools einer App aufrufen:
 * `POST <basePath>/api/tools/<tool>` mit den Argumenten als JSON-Body.
 *
 * Der Plattform-MCP prueft die Freigabe (`<app>.<tool>`, Verb `execute`),
 * protokolliert und leitet dann hierher weiter — signiert wie die
 * Forward-Auth (ADR 0004, ADR 0011). Diese Datei prueft die Freigabe **nicht**
 * ein zweites Mal; sie prueft, dass der Aufruf nachweisbar von der Plattform
 * kommt, und sonst nichts. Kein eigener Rechte-Code in Apps (CLAUDE.md 3).
 *
 * Eine App beschreibt ihre Tools einmal und bekommt den Route-Handler:
 *
 * ```ts
 * // src/app/api/tools/[tool]/route.ts
 * export const POST = createToolRoute({
 *   'pages.list': async (args) => listPages(PagesQuery.parse(args)),
 * });
 * ```
 */

export interface ToolContext {
  /** Wer ruft: Mensch (`<id>`) oder Agent (`agent:<name>`). */
  readonly user: PlatformUser;
}

export type ToolHandler = (args: unknown, ctx: ToolContext) => Promise<unknown>;

/**
 * Falsche Eingabe eines Aufrufers. Wird mit 400 und der Meldung beantwortet —
 * die Meldung geht an einen Agenten, der daraus lernen soll, was er falsch
 * gemacht hat. Also nichts Internes hineinschreiben.
 */
export class ToolInputError extends SdkError {
  readonly issues: readonly unknown[];

  constructor(message: string, issues: readonly unknown[] = []) {
    super(message, 400);
    this.issues = issues;
  }
}

/** Das Gesuchte gibt es nicht. 404 mit Meldung. */
export class ToolNotFoundError extends SdkError {
  constructor(message: string) {
    super(message, 404);
  }
}

export interface ToolRouteOptions extends GetUserOptions {
  /** Hoechstgroesse des Bodys in Bytes. Default 1 MiB. */
  readonly maxBodyBytes?: number;
  /** Fuer unerwartete Fehler. Default: `console.error`. */
  readonly onError?: (error: unknown, tool: string) => void;
}

type RouteContext = {
  params: Promise<{ tool?: string | string[] }> | { tool?: string | string[] };
};

/**
 * Baut den Route-Handler fuer `app/api/tools/[tool]/route.ts`.
 *
 * Reihenfolge, und keine kann uebersprungen werden: Signatur pruefen, Tool
 * nachschlagen, Body lesen, Handler rufen. Ein unbekanntes Tool ergibt 404 erst
 * **nach** der Signatur — wer nicht von der Plattform kommt, erfaehrt nicht
 * einmal, welche Tools es gibt.
 */
export function createToolRoute(
  tools: Readonly<Record<string, ToolHandler>>,
  options: ToolRouteOptions = {},
): (request: Request, context: RouteContext) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
  const onError =
    options.onError ??
    ((error: unknown, tool: string) => {
      console.error(`[tools] ${tool}:`, error);
    });

  return async (request, context) => {
    let user: PlatformUser;
    try {
      user = getUser(request.headers, options);
    } catch (error) {
      const status = error instanceof SdkError ? error.status : 401;
      return Response.json({ error: 'unauthorized' }, { status });
    }

    const params = await context.params;
    const raw = Array.isArray(params.tool) ? params.tool.join('/') : params.tool;
    const tool = raw === undefined ? '' : decodeURIComponent(raw);
    // Nur eigene Eintraege: `constructor`, `toString` und Co. sind keine Tools.
    const handler = Object.hasOwn(tools, tool) ? tools[tool] : undefined;
    if (handler === undefined) {
      return Response.json({ error: 'unknown_tool', tool }, { status: 404 });
    }

    let args: unknown;
    try {
      args = await readJsonBody(request, maxBodyBytes);
    } catch (error) {
      const message = error instanceof ToolInputError ? error.message : 'Body ist kein JSON';
      return Response.json({ error: 'invalid', message }, { status: 400 });
    }

    try {
      const result = await handler(args, { user });
      return Response.json(result ?? null);
    } catch (error) {
      if (error instanceof ToolInputError) {
        return Response.json(
          { error: 'invalid', message: error.message, issues: error.issues },
          { status: 400 },
        );
      }
      if (error instanceof ToolNotFoundError) {
        return Response.json({ error: 'not_found', message: error.message }, { status: 404 });
      }
      if (error instanceof UntrustedRequestError) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
      onError(error, tool);
      // Keine Einzelheiten nach aussen: Stacktraces und SQL bleiben im Log.
      return Response.json({ error: 'internal' }, { status: 500 });
    }
  };
}

/**
 * Liest den Body als JSON. Ein leerer Body ist `{}` — ein Tool ohne Argumente
 * soll nicht an einem fehlenden `{}` scheitern.
 */
async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ToolInputError(`Body groesser als ${maxBytes} Bytes`);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new ToolInputError(`Body groesser als ${maxBytes} Bytes`);
  }
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ToolInputError('Body ist kein JSON');
  }
}

/**
 * Prueft Argumente mit einem Schema, das `safeParse` kennt (zod und
 * Verwandte), und wirft bei Fehlern einen `ToolInputError` mit den Befunden.
 * Das SDK haengt damit an keiner Schema-Bibliothek.
 */
export function parseArgs<T>(
  schema: {
    safeParse(
      value: unknown,
    ): { success: true; data: T } | { success: false; error: { issues: readonly unknown[] } };
  },
  args: unknown,
): T {
  const result = schema.safeParse(args);
  if (!result.success) {
    throw new ToolInputError('Argumente passen nicht zum Tool', result.error.issues);
  }
  return result.data;
}
