'use server';

import { getUser, ToolInputError, ToolNotFoundError, type PlatformUser } from '@openapps/sdk';
import { headers } from 'next/headers';
import { parseEuroToCents } from '@/lib/format';
import { toolHandlers, type ToolName } from '@/lib/tools';

/**
 * Die Mutationen der Oberflaeche. Jede ruft genau ein Tool aus
 * src/lib/tools.ts — die UI hat keinen eigenen Weg in die Daten, und jede
 * Aktion hier hat ihr MCP-Tool (Review-Gate: "UI-Aktion ohne MCP-Tool").
 *
 * Jede Aktion prueft zuerst mit `getUser` die Signatur des Gateways. Ohne
 * gueltige Signatur passiert nichts.
 */

export type FormInput = Record<string, string | boolean>;

export type ActionResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string>; formError?: string };

async function currentUser(): Promise<PlatformUser | null> {
  try {
    return getUser(await headers());
  } catch {
    return null;
  }
}

/** Nur Text-Felder, leere weg. Die Schemas behandeln "" ohnehin als fehlend. */
function textValues(values: FormInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.trim() !== '') out[key] = value;
  }
  return out;
}

function issueFieldErrors(issues: readonly unknown[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    const field = Array.isArray(path) && typeof path[0] === 'string' ? path[0] : undefined;
    if (field !== undefined && typeof message === 'string' && errors[field] === undefined) {
      errors[field] = message;
    }
  }
  return errors;
}

function formErrorOf(issues: readonly unknown[], fallback: string): string {
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    if (Array.isArray(path) && path.length === 0 && typeof message === 'string') return message;
  }
  return fallback;
}

/**
 * Ruft ein Tool im Namen des angemeldeten Nutzers und uebersetzt das Ergebnis
 * in Feldfehler fuer `FormPattern`. `pickId` holt die Id des Angelegten.
 */
async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  pickId: (result: unknown) => string,
  rename: Readonly<Record<string, string>> = {},
): Promise<ActionResult> {
  const user = await currentUser();
  if (user === null) {
    return {
      ok: false,
      fieldErrors: {},
      formError: 'Nicht angemeldet: Die Anfrage kam nicht über das Gateway. Lade die Seite neu.',
    };
  }

  try {
    const result: unknown = await toolHandlers[name](args, { user });
    return { ok: true, id: pickId(result) };
  } catch (error) {
    if (error instanceof ToolInputError) {
      const raw = issueFieldErrors(error.issues);
      const fieldErrors: Record<string, string> = {};
      for (const [field, message] of Object.entries(raw)) fieldErrors[rename[field] ?? field] = message;
      return {
        ok: false,
        fieldErrors,
        formError: formErrorOf(error.issues, Object.keys(fieldErrors).length > 0 ? 'Bitte die markierten Felder prüfen.' : error.message),
      };
    }
    if (error instanceof ToolNotFoundError) {
      return { ok: false, fieldErrors: {}, formError: error.message };
    }
    console.error(`[crm] ${name}:`, error);
    return {
      ok: false,
      fieldErrors: {},
      formError: 'Speichern ist fehlgeschlagen. Versuche es gleich noch einmal.',
    };
  }
}

/** Liest `result[key].id` aus einer Tool-Antwort. */
const idAt =
  (key: string) =>
  (result: unknown): string => {
    const inner = (result as Record<string, unknown> | null)?.[key];
    const id = (inner as Record<string, unknown> | null | undefined)?.id;
    if (typeof id !== 'string') throw new Error(`Tool-Antwort ohne ${key}.id`);
    return id;
  };

export async function createCompanyAction(values: FormInput): Promise<ActionResult> {
  return runTool('companies.create', textValues(values), idAt('company'));
}

export async function createContactAction(values: FormInput): Promise<ActionResult> {
  return runTool('contacts.create', textValues(values), idAt('contact'));
}

export async function createDealAction(values: FormInput): Promise<ActionResult> {
  const { value, ...rest } = textValues(values);
  const valueCents = value === undefined ? undefined : parseEuroToCents(value);
  if (valueCents === null) {
    return {
      ok: false,
      fieldErrors: { value: 'Betrag wie 12.500 oder 12.500,50 eingeben.' },
    };
  }
  return runTool('deals.create', { ...rest, valueCents }, idAt('deal'), { valueCents: 'value' });
}

export async function updateDealStageAction(values: FormInput): Promise<ActionResult> {
  return runTool('deals.update_stage', textValues(values), idAt('deal'));
}

export async function logActivityAction(values: FormInput): Promise<ActionResult> {
  return runTool('activities.log', textValues(values), idAt('activity'));
}
