/**
 * Das Audit-Log ist nicht optional. Jede Domaenenfunktion schreibt genau einen
 * Eintrag pro Aufruf — erlaubt, abgelehnt oder fehlerhaft (DoD 6).
 */

import { PermissionDeniedError } from './errors';
import type { DomainContext } from './context';
import type { Actor, AuditOutcome, ResourceRef } from './types';

export interface AuditInput {
  readonly actor: Actor;
  readonly action: string;
  readonly resource?: ResourceRef | null;
  readonly outcome: AuditOutcome;
  readonly reason?: string | null;
  readonly detail?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

export async function record(ctx: DomainContext, input: AuditInput): Promise<void> {
  await ctx.audit.append({
    occurredAt: ctx.clock.now(),
    actor: { kind: input.actor.kind, id: input.actor.id },
    action: input.action,
    resource: input.resource ?? null,
    outcome: input.outcome,
    reason: input.reason ?? null,
    detail: input.detail ?? {},
    correlationId: input.correlationId ?? null,
  });
}

/**
 * Fuehrt `work` aus und protokolliert das Ergebnis. Ein Fehler wird als
 * 'error' protokolliert und dann weitergeworfen — nie geschluckt.
 */
export async function audited<T>(
  ctx: DomainContext,
  input: Omit<AuditInput, 'outcome' | 'reason'>,
  work: () => Promise<{ value: T; detail?: Readonly<Record<string, unknown>> }>,
): Promise<T> {
  try {
    const { value, detail } = await work();
    await record(ctx, {
      ...input,
      outcome: 'allowed',
      detail: { ...(input.detail ?? {}), ...(detail ?? {}) },
    });
    return value;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const denied = error instanceof PermissionDeniedError;
    await record(ctx, {
      ...input,
      outcome: denied ? 'denied' : 'error',
      reason,
    });
    throw error;
  }
}
