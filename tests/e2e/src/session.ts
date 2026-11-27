/**
 * Eine Better-Auth-Session fuer den echten Weg durch Traefik und
 * Forward-Auth (`https://apps.local.test:8443`).
 *
 * Warum so: Menschen kommen lokal nur ueber Google herein (ADR 0013). Der
 * Ansehen-Proxy auf 8090 ueberspringt die Forward-Auth und prueft deshalb
 * keine Freigabe, der auf 8091 gibt seine Session nie heraus (ADR 0014). Um
 * Default-Deny am Gateway zu pruefen, braucht der Test also eine Session im
 * Browser. Sie entsteht genau so wie in `lokal-ansehen-cp.ts`: ueber
 * `lokaleSession`, also ueber Better Auth selbst, mit Domain-Schranke und
 * Bootstrap-Hook. Nichts wird per SQL geschrieben, kein Code der Control
 * Plane geaendert; das Skript laeuft im Container der Control Plane, weil nur
 * dort `BETTER_AUTH_SECRET` und die DSN liegen.
 *
 * Der Cookie-Wert bleibt im Speicher dieses Prozesses. Er wird nie geloggt;
 * scheitert der Aufruf, steht im Fehler nur stderr, nie stdout.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LOKAL_SH, REPO_ROOT } from './stack';

const run = promisify(execFile);

export interface MintedSession {
  readonly cookieName: string;
  readonly cookieValue: string;
  readonly userId: string;
  readonly email: string;
}

/**
 * Laeuft im Container (`WORKDIR /repo/apps/control-plane`). Nur die Rolle
 * `user` (`user@<erste erlaubte Domain>`): ohne Gruppe, ohne Freigabe.
 */
const SCRIPT = `
(async () => {
  const base = process.cwd() + '/src';
  const { createAuth } = await import(base + '/lib/auth.ts');
  const { readAuthEnv } = await import(base + '/lib/env.ts');
  const { getPool } = await import(base + '/infra/pg/pool.ts');
  const cp = await import(base + '/infra/lokal-ansehen-cp.ts');
  const env = readAuthEnv();
  const auth = createAuth({ pool: getPool(), env });
  const email = cp.emailFuerRolle('user', env);
  const session = await cp.lokaleSession(auth, email);
  const ctx = await auth.$context;
  const found = await ctx.internalAdapter.findUserByEmail(email);
  if (!found) throw new Error('user not found after creating the session');
  process.stdout.write(JSON.stringify({
    cookieName: session.cookieName,
    cookieValue: session.value,
    userId: found.user.id,
    email,
  }));
  await getPool().end();
})().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
`;

export async function mintUserSession(): Promise<MintedSession> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      LOKAL_SH,
      ['exec', '-T', 'control-plane', 'node_modules/.bin/tsx', '--eval', SCRIPT],
      {
        cwd: REPO_ROOT,
        env: { ...process.env, COMPOSE_PARALLEL_LIMIT: '1' },
        maxBuffer: 1024 * 1024,
        timeout: 60_000,
      },
    ));
  } catch (error) {
    // Nur stderr: stdout koennte den Cookie tragen.
    const stderr = (error as { stderr?: unknown }).stderr;
    throw new Error(
      `Could not create a session in the control-plane container: ${
        typeof stderr === 'string' ? stderr.trim().slice(-2000) : 'no details'
      }`,
    );
  }
  const line = stdout.trim().split('\n').pop() ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error('Session script returned no JSON (output withheld).');
  }
  const value = parsed as Partial<MintedSession>;
  if (
    typeof value.cookieName !== 'string' ||
    typeof value.cookieValue !== 'string' ||
    typeof value.userId !== 'string' ||
    typeof value.email !== 'string'
  ) {
    throw new Error('Session script returned an unexpected shape (output withheld).');
  }
  return value as MintedSession;
}
