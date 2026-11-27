/**
 * Wer ruft als App (ADR 0020)? Die aufrufende App signiert jeden Aufruf mit
 * ihrem `OPENAPPS_CALL_SECRET`; hier wird die Signatur geprueft und daraus
 * das Subjekt `app:<name>` im einen Rechtemodell.
 *
 * Diese Pruefung belegt nur, **wer** ruft. Ob er darf, entscheidet danach
 * `callAppTool` mit der Freigabe `execute` auf `<app>.<tool>`.
 */

import {
  APP_CALL_MAX_AGE_SECONDS,
  appCallSignatureFor,
  CALLER_HEADER,
  CALLER_ISSUED_AT_HEADER,
  CALLER_SIGNATURE_HEADER,
  sha256Hex,
} from '@openapps/sdk';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appCallSecret } from './app-secret';
import { record } from './audit';
import type { DomainContext } from './context';
import { DomainError } from './errors';
import { appIdOf } from './gateway-identity';
import type { Actor } from './types';

export { CALLER_HEADER, CALLER_ISSUED_AT_HEADER, CALLER_SIGNATURE_HEADER };

/** Die Signatur passt nicht, ist abgelaufen oder der Aufrufer ist keine App. 401. */
export class UnauthenticatedCallerError extends DomainError {
  constructor(message = 'the caller could not be verified') {
    super(message, 'unauthenticated');
  }
}

const APP_NAME = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

/** Vorlauf, falls die Uhr der aufrufenden App vorgeht (wie im SDK). */
const FUTURE_TOLERANCE_SECONDS = 2;

export interface AppCallerInput {
  /** Header der Anfrage; Gross-/Kleinschreibung egal. */
  readonly headers: Headers;
  /** Ziel-App aus dem Pfad. */
  readonly app: string;
  /** Tool aus dem Pfad. */
  readonly tool: string;
  /** Der Body, genau so, wie er ankam. */
  readonly body: string;
  readonly correlationId?: string;
}

/**
 * Prueft die Signatur einer aufrufenden App und gibt ihr Subjekt zurueck.
 * Wirft `UnauthenticatedCallerError` und protokolliert den Versuch, wenn der
 * angegebene Name die Form eines App-Namens hat — sonst gibt es kein
 * Subjekt, unter dem er stuende.
 */
export async function verifyAppCaller(ctx: DomainContext, input: AppCallerInput): Promise<Actor> {
  const caller = single(input.headers, CALLER_HEADER);
  const issuedAt = single(input.headers, CALLER_ISSUED_AT_HEADER);
  const signature = single(input.headers, CALLER_SIGNATURE_HEADER);

  if (caller === null || !APP_NAME.test(caller)) {
    throw new UnauthenticatedCallerError('caller missing or not an app name');
  }
  const actor: Actor = { kind: 'app', id: caller };

  const reject = async (reason: string): Promise<never> => {
    await record(ctx, {
      actor,
      action: 'call_app_tool',
      resource: { kind: 'tool', id: `${input.app}.${input.tool}` },
      outcome: 'denied',
      reason,
      detail: { appName: input.app, toolName: input.tool },
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
    });
    throw new UnauthenticatedCallerError(reason);
  };

  if (signature === null || issuedAt === null || !/^\d{1,15}$/.test(issuedAt)) {
    return reject('caller signature missing');
  }

  const app = await ctx.apps.findByName(caller);
  // Eine archivierte App ruft nichts mehr. Eine App, die es nicht gibt, hat
  // kein Secret — die Signatur kann nicht stimmen, aber wir rechnen gar nicht.
  if (app === null || app.archivedAt !== null) {
    return reject('caller is not a registered app');
  }

  const expected = appCallSignatureFor({
    secret: appCallSecret({
      masterSecret: ctx.authMasterSecret,
      appId: appIdOf(app),
      generation: app.authSecretGeneration,
    }),
    caller,
    app: input.app,
    tool: input.tool,
    issuedAt,
    bodySha256: sha256Hex(input.body),
  });
  if (!equalSignatures(signature, expected)) {
    return reject('caller signature does not match');
  }

  const age = ctx.clock.now().getTime() / 1000 - Number.parseInt(issuedAt, 10);
  if (age > APP_CALL_MAX_AGE_SECONDS || age < -FUTURE_TOLERANCE_SECONDS) {
    return reject('caller signature expired or from the future');
  }

  return actor;
}

/** Genau ein nicht leerer Wert, sonst `null`. Mehrfach gesetzt ist nicht eindeutig. */
function single(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.includes(',')) return null;
  return trimmed;
}

/** Zeitkonstant, ueber Digests gleicher Laenge — wie `signatureEquals` im SDK. */
function equalSignatures(presented: string, expected: string): boolean {
  const key = 'openapps-app-call-compare';
  const a = createHmac('sha256', key).update(presented.toLowerCase(), 'utf8').digest();
  const b = createHmac('sha256', key).update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
