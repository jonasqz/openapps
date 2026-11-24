import { createToolRoute } from '@openapps/sdk';
import { toolHandlers } from '@/lib/tools';

/**
 * POST /api/tools/<tool> — der Endpunkt, ueber den Agents die Tools aufrufen
 * (openapi.yaml, Pfade /tools/*). `createToolRoute` prueft zuerst die
 * Signatur der Plattform; ohne sie gibt es 401, bevor ein Tool nachgeschlagen
 * wird. Die Freigabe selbst prueft der Plattform-MCP, nicht diese App.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createToolRoute(toolHandlers);
