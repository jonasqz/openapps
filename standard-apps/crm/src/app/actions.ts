'use server';

import { getUser, ToolInputError, ToolNotFoundError, type PlatformUser } from '@openapps/sdk';
import { headers } from 'next/headers';
import type { Stage } from '@/lib/domain';
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

const NOT_SIGNED_IN = 'Not signed in: the request did not come through the gateway. Reload the page.';
const SAVE_FAILED = 'Saving failed. Please try again in a moment.';

/** Ergebnis eines Tool-Aufrufs aus der UI, ohne Formularbezug. */
type ToolCall =
  | { ok: true; result: unknown }
  | { ok: false; message: string; issues: readonly unknown[] };

/** Ruft ein Tool im Namen des angemeldeten Nutzers. Wirft nie. */
async function callTool(name: ToolName, args: Record<string, unknown>): Promise<ToolCall> {
  const user = await currentUser();
  if (user === null) return { ok: false, message: NOT_SIGNED_IN, issues: [] };
  try {
    return { ok: true, result: await toolHandlers[name](args, { user }) };
  } catch (error) {
    if (error instanceof ToolInputError) {
      const fieldMessage = Object.values(issueFieldErrors(error.issues))[0];
      return {
        ok: false,
        message: formErrorOf(error.issues, fieldMessage ?? error.message),
        issues: error.issues,
      };
    }
    if (error instanceof ToolNotFoundError) return { ok: false, message: error.message, issues: [] };
    console.error(`[crm] ${name}:`, error);
    return { ok: false, message: SAVE_FAILED, issues: [] };
  }
}

/**
 * Ruft ein Tool und uebersetzt das Ergebnis in Feldfehler fuer
 * `FormPattern`. `pickId` holt die Id des Angelegten.
 */
async function runTool(
  name: ToolName,
  args: Record<string, unknown>,
  pickId: (result: unknown) => string,
  rename: Readonly<Record<string, string>> = {},
): Promise<ActionResult> {
  const call = await callTool(name, args);
  if (call.ok) return { ok: true, id: pickId(call.result) };
  const fieldErrors: Record<string, string> = {};
  for (const [field, message] of Object.entries(issueFieldErrors(call.issues))) {
    fieldErrors[rename[field] ?? field] = message;
  }
  return {
    ok: false,
    fieldErrors,
    formError: formErrorOf(
      call.issues,
      Object.keys(fieldErrors).length > 0 ? 'Please check the highlighted fields.' : call.message,
    ),
  };
}

/** Liest `result[key].id` aus einer Tool-Antwort. */
const idAt =
  (key: string) =>
  (result: unknown): string => {
    const inner = (result as Record<string, unknown> | null)?.[key];
    const id = (inner as Record<string, unknown> | null | undefined)?.id;
    if (typeof id !== 'string') throw new Error(`tool response without ${key}.id`);
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
      fieldErrors: { value: 'Enter an amount like 12,500 or 12,500.50.' },
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

/**
 * Deal bearbeiten. Anders als beim Anlegen gehen leere Felder mit: "" leert
 * Abschlussdatum, Besitzer und Kontakt (das Schema macht daraus null), ein
 * leerer Titel bleibt unveraendert.
 */
export async function updateDealAction(values: FormInput): Promise<ActionResult> {
  const args: Record<string, unknown> = {};
  for (const key of ['id', 'title', 'expectedClose', 'owner', 'contactId'] as const) {
    const value = values[key];
    if (typeof value === 'string') args[key] = value;
  }
  const value = values.value;
  if (typeof value === 'string' && value.trim() !== '') {
    const valueCents = parseEuroToCents(value);
    if (valueCents === null) {
      return { ok: false, fieldErrors: { value: 'Enter an amount like 12,500 or 12,500.50.' } };
    }
    args.valueCents = valueCents;
  }
  return runTool('deals.update', args, idAt('deal'), { valueCents: 'value' });
}

export async function createNextStepAction(values: FormInput): Promise<ActionResult> {
  return runTool('next_steps.create', textValues(values), idAt('nextStep'));
}

/** Ergebnis einer Aktion ohne Formular (Board, Erledigt-Knopf). */
export type QuickResult = { ok: true; changed: boolean } | { ok: false; message: string };

function changedOf(result: unknown): boolean {
  return (result as { changed?: unknown } | null)?.changed === true;
}

/** Stage-Wechsel vom Board oder der Detailseite. Tool: `deals.update_stage`. */
export async function moveDealAction(id: string, stage: Stage, note: string): Promise<QuickResult> {
  const args: Record<string, unknown> = { id, stage };
  if (note.trim() !== '') args.note = note;
  const call = await callTool('deals.update_stage', args);
  return call.ok ? { ok: true, changed: changedOf(call.result) } : { ok: false, message: call.message };
}

/** Tool: `next_steps.complete`. */
export async function completeNextStepAction(id: string): Promise<QuickResult> {
  const call = await callTool('next_steps.complete', { id });
  return call.ok ? { ok: true, changed: changedOf(call.result) } : { ok: false, message: call.message };
}

/** Tool: `next_steps.reopen`, das "Undo" nach dem Erledigen. */
export async function reopenNextStepAction(id: string): Promise<QuickResult> {
  const call = await callTool('next_steps.reopen', { id });
  return call.ok ? { ok: true, changed: changedOf(call.result) } : { ok: false, message: call.message };
}
