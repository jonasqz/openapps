/**
 * `/mcp` — der Plattform-MCP unter der Domain der Control Plane (ADR 0009).
 *
 * Diese Route entscheidet **nichts**. Sie reicht den Aufruf an den
 * Plattform-MCP weiter, der im selben Container auf 127.0.0.1 hoert, und gibt
 * dessen Antwort zurueck. Wer der Aufrufer ist und was er darf, prueft der MCP
 * bei jedem Aufruf aus dem `Authorization`-Header
 * (apps/platform-mcp/src/identity.ts) — hier gibt es keine Session und keinen
 * zweiten Rechteweg.
 *
 * Der Pfad steht in der Allowlist der Forward-Auth, weil ein Agent keinen
 * Browser-Cookie hat. Offen ist er damit nicht: Ohne gueltiges Token antwortet
 * der MCP mit 401, bevor irgendein Tool angefasst wird.
 */

export const dynamic = 'force-dynamic';

/** Was ein MCP-Client schickt und der Server braucht — mehr reicht die Route nicht durch. */
const FORWARDED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'mcp-protocol-version',
  'mcp-session-id',
  'last-event-id',
] as const;

const FORWARDED_RESPONSE_HEADERS = ['content-type', 'www-authenticate', 'mcp-session-id', 'allow'];

/**
 * Ein Deploy laeuft durch das Review-Gate und wartet auf das Backend — das
 * dauert. Kuerzer als Traefiks eigenes Limit braucht diese Grenze nicht zu
 * sein, nur endlich.
 */
const UPSTREAM_TIMEOUT_MS = 10 * 60 * 1000;

function upstreamUrl(): string {
  return process.env.PLATFORM_MCP_URL?.trim() || 'http://127.0.0.1:3001';
}

async function forward(request: Request): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl(), {
      method: request.method,
      headers,
      // MCP-Aufrufe sind kleine JSON-Nachrichten; sie ganz zu lesen ist
      // einfacher und sicherer als ein durchgereichter Stream mit `duplex`.
      ...(hasBody ? { body: await request.arrayBuffer() } : {}),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      redirect: 'manual',
    });
  } catch {
    // Nicht erreichbar heisst „nein", nicht „offen" — und sagt nicht, warum.
    return new Response('Plattform-MCP nicht erreichbar', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  // Die Antwort ist ein Strom (text/event-stream) oder JSON; beides geht
  // unveraendert durch.
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
