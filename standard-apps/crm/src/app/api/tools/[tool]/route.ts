import { createToolRoute } from '@openapps/sdk';
import { toolHandlers } from '@/lib/tools';

/**
 * POST /api/tools/<tool> — der Weg, auf dem Agents das CRM benutzen.
 *
 * Der Plattform-MCP prueft die Freigabe und ruft signiert hierher.
 * `createToolRoute` prueft die Signatur, bevor irgendein Handler laeuft;
 * eine eigene Rechtepruefung gibt es hier nicht (CLAUDE.md 3).
 */
export const POST = createToolRoute(toolHandlers);

// Jeder Aufruf liest frische Daten; nichts davon darf im Cache landen.
export const dynamic = 'force-dynamic';
