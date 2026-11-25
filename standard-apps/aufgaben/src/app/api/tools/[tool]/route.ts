import { createToolRoute } from '@openapps/sdk';
import { toolHandlers } from '@/lib/tools';

/**
 * POST /api/tools/<tool> — der Weg, auf dem Agents diese App benutzen.
 *
 * `createToolRoute` prueft zuerst die Signatur der Plattform, dann das Tool,
 * dann den Body. Ohne Signatur antwortet es 401 — daran erkennt die Plattform
 * auch, dass die App laeuft.
 */
export const POST = createToolRoute(toolHandlers);

export const dynamic = 'force-dynamic';
