import { createToolRoute } from '@openapps/sdk';
import { toolHandlers } from '@/lib/tools';

/**
 * POST /api/tools/<tool> — der Weg, auf dem Agents das Wiki benutzen.
 *
 * `createToolRoute` prueft zuerst die Gateway-Signatur, dann das Tool, dann den
 * Body. Die Freigabe (wer welches Tool darf) hat der Plattform-MCP vorher
 * geprueft; hier gibt es keinen eigenen Rechte-Code.
 */
export const POST = createToolRoute(toolHandlers);

/** Jede Anfrage braucht frische Daten und eine frische Signaturpruefung. */
export const dynamic = 'force-dynamic';
