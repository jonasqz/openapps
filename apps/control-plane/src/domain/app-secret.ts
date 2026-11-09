/**
 * Das `OPENAPPS_AUTH_SECRET` pro App.
 *
 * ADR 0004 verlangt ein Secret **pro App**, nicht ein geteiltes fuer alle. Es
 * wird nicht gespeichert, sondern abgeleitet: HKDF-SHA256 aus einem
 * Master-Secret der Control Plane, der App-Id und einer Generation.
 *
 * Warum ableiten statt speichern:
 *
 * - In der Datenbank liegt kein App-Secret. Ein Datenbank-Dump enthaelt keine
 *   Schluessel, mit denen man Identitaeten signieren koennte.
 * - Das Gateway (die Control Plane) braucht das Secret bei jedem Aufruf zum
 *   Signieren und kann es jederzeit neu bilden, ohne Lesezugriff auf ein
 *   Geheimnisfeld.
 * - Rotation einer einzelnen App ist `auth_secret_generation + 1` plus
 *   Redeploy; Rotation aller Apps ist ein neues Master-Secret.
 *
 * Was das kostet: Das Master-Secret ist der eine Punkt, an dem alles haengt.
 * Es liegt nur in der Env der Control Plane und geht nie in eine App.
 */

import { hkdfSync } from 'node:crypto';

/** Muss zum Mindestmaß des SDK passen (`MIN_SECRET_LENGTH`, 32 Zeichen). */
const SECRET_BYTES = 32;

const INFO_PREFIX = 'openapps/app-auth-secret/1';

export interface AppSecretInput {
  /** Master-Secret der Control Plane. Nie in einer App. */
  readonly masterSecret: string;
  /** Die App-Id, die auch ins Signatur-Material geht. */
  readonly appId: string;
  readonly generation: number;
}

/**
 * Das abgeleitete Secret als Hex (64 Zeichen). Gleiche Eingabe, gleiches
 * Ergebnis — davon haengt ab, dass Gateway und App denselben Schluessel haben.
 */
export function appAuthSecret(input: AppSecretInput): string {
  if (input.masterSecret.trim() === '') {
    throw new Error('Master-Secret fehlt: ohne es kann kein App-Secret abgeleitet werden');
  }
  if (!Number.isInteger(input.generation) || input.generation < 1) {
    throw new Error(`ungueltige Generation: ${String(input.generation)}`);
  }

  const info = `${INFO_PREFIX}\n${input.appId}\n${String(input.generation)}`;
  // Salt bleibt leer: der Kontext steckt vollstaendig in `info`, und ein
  // zufaelliges Salt muesste gespeichert werden — genau das soll entfallen.
  const bits = hkdfSync('sha256', input.masterSecret, '', info, SECRET_BYTES);
  return Buffer.from(bits).toString('hex');
}
