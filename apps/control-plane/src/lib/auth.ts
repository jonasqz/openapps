/**
 * Die Better-Auth-Instanz der Control Plane. **Ein** Anbieter: Google. Kein
 * Passwort-Login, kein zweiter Weg herein.
 *
 * Drei Dinge sind hier wichtiger als die Konfiguration selbst:
 *
 * 1. **Ein Pool, nicht zwei.** Better Auth bekommt den Pool der Control Plane
 *    aus `src/infra/pg/pool.ts` ueber eine Kysely-Instanz. Eine zweite
 *    Verbindung waere ein zweites Limit, ein zweiter Ausfallpunkt und eine
 *    zweite DSN im Betrieb.
 * 2. **Eigenes Schema.** `WithSchemaPlugin('control_plane')` setzt jede
 *    Tabellenreferenz von Better Auth auf das Schema aus Migration 0008 —
 *    nicht `public`, wo das Rechtemodell liegt. Schema-Name hier und in 0008
 *    sind dasselbe und muessen zusammen geaendert werden.
 * 3. **Die Domain-Schranke ist ein Hook, kein Hinweis.** Sie haengt am Anlegen
 *    des Nutzers **und** am Anlegen jeder Session. Das erste verhindert, dass
 *    eine fremde Adresse ein Konto bekommt; das zweite, dass ein Konto, dessen
 *    Domain inzwischen gestrichen wurde, sich weiter anmeldet.
 *
 * Fehlt eine der vier Pflicht-Variablen, wirft `readAuthEnv` — eine halb
 * konfigurierte Auth ist schlimmer als keine.
 */

import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { Kysely, PostgresDialect, WithSchemaPlugin } from 'kysely';
import type { Pool } from 'pg';
import { getPool } from '../infra/pg/pool';
import { createGroupMembershipRepository } from '../infra/pg/groups';
import type { GroupMembershipRepository } from '../infra/pg/groups';
import {
  applyBootstrapMembership,
  assertEmailDomainAllowed,
  EmailDomainRejectedError,
} from './auth-policy';
import { readAuthEnv, type AuthEnv } from './env';

/** Muss zum Schema in Migration 0008 passen. */
export const AUTH_DB_SCHEMA = 'control_plane';

export type ControlPlaneAuth = ReturnType<typeof createAuth>;

export interface CreateAuthOptions {
  readonly pool: Pool;
  readonly env: AuthEnv;
  /** Fuer Tests ersetzbar; im Betrieb der Pool-eigene Repository. */
  readonly groups?: GroupMembershipRepository;
}

export function createAuth(options: CreateAuthOptions) {
  const { pool, env } = options;
  const groups = options.groups ?? createGroupMembershipRepository(pool);

  const db = new Kysely<Record<string, never>>({
    dialect: new PostgresDialect({ pool }),
    plugins: [new WithSchemaPlugin(AUTH_DB_SCHEMA)],
  });

  /** Abweisen heisst 403 mit Grund, nicht ein stiller Login ohne Rechte. */
  const guardEmail = (email: string): void => {
    try {
      assertEmailDomainAllowed(email, env.allowedEmailDomains);
    } catch (error) {
      if (error instanceof EmailDomainRejectedError) {
        throw new APIError('FORBIDDEN', { message: error.message });
      }
      throw error;
    }
  };

  return betterAuth({
    secret: env.secret,
    baseURL: env.baseUrl,
    database: { db, type: 'postgres' },
    // Kein Passwort-Login: Google ist der einzige Weg herein.
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        clientId: env.googleClientId,
        clientSecret: env.googleClientSecret,
      },
    },
    account: {
      accountLinking: {
        // Nur Google existiert; eine Verknuepfung zu einem anderen Anbieter
        // waere ein zweiter Weg an derselben Adresse.
        enabled: false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            guardEmail(user.email);
            return Promise.resolve({ data: user });
          },
          after: async (user) => {
            await applyBootstrapMembership(user.email, env.bootstrapAdmins, groups);
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // Jede Anmeldung, nicht nur die erste: wird eine Domain aus
            // AUTH_ALLOWED_EMAIL_DOMAINS gestrichen, ist der naechste Login
            // zu Ende. Und eine spaeter ergaenzte Bootstrap-Adresse greift
            // beim naechsten Login, ohne Handgriff an der Datenbank.
            const email = await emailOfUser(pool, session.userId);
            if (email === null) {
              throw new APIError('FORBIDDEN', {
                message: 'Anmeldung abgelehnt: kein Nutzer zu dieser Session',
              });
            }
            guardEmail(email);
            await applyBootstrapMembership(email, env.bootstrapAdmins, groups);
            return { data: session };
          },
        },
      },
    },
  });
}

/**
 * Die E-Mail eines Nutzers, direkt aus der Tabelle von Better Auth. Bewusst
 * als SQL ueber den Pool und nicht ueber Kysely: der Schema- und Tabellenname
 * steht so sichtbar da, wie Migration 0008 ihn anlegt. `AUTH_DB_SCHEMA` ist
 * eine Konstante dieses Moduls, kein Eingabewert.
 */
async function emailOfUser(pool: Pool, userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT email FROM ${AUTH_DB_SCHEMA}."user" WHERE id = $1`,
    [userId],
  );
  return rows[0]?.email ?? null;
}

let instance: ControlPlaneAuth | undefined;

/**
 * Die eine Instanz im Prozess. Lazy, damit ein Import der Control Plane ohne
 * Google-Zugangsdaten nicht sofort scheitert — der erste Zugriff aber schon.
 */
export function getAuth(): ControlPlaneAuth {
  instance ??= createAuth({ pool: getPool(), env: readAuthEnv() });
  return instance;
}

/** Nur fuer Tests: die Instanz zuruecksetzen. */
export function resetAuth(): void {
  instance = undefined;
}
