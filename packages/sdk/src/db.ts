import { Pool, type PoolConfig } from 'pg';
import { SdkConfigurationError } from './errors.js';

/**
 * Postgres-Client für Apps (AGENTS.md Regel 2): genau eine DB-Rolle, genau ein
 * Schema, keine Superuser-Verbindung, kein `search_path`-Trick.
 *
 * Die eigentliche Grenze zieht Postgres — die Rolle der App darf nichts
 * anderes. Dieses Modul ist die zweite Hürde davor: Es stellt den `search_path`
 * fest ein und weist eine Verbindungszeichenfolge ab, die nach Owner- oder
 * Superuser-Rolle aussieht. So fällt eine falsch gesetzte Env beim Start auf und
 * nicht erst, wenn eine App Daten einer anderen liest.
 */

export const DATABASE_URL_ENV = 'DATABASE_URL';
export const DATABASE_SCHEMA_ENV = 'DATABASE_SCHEMA';

/** Rollen, die eine App nie benutzt. Kleinschreibung, exakter Vergleich. */
const FORBIDDEN_ROLES: readonly string[] = [
  'postgres',
  'root',
  'admin',
  'superuser',
  'rdsadmin',
  'azure_superuser',
  'cloudsqlsuperuser',
  'owner',
];

/** Endungen, mit denen die Control Plane Owner-Rollen benennt. */
const FORBIDDEN_ROLE_SUFFIXES: readonly string[] = ['_owner', '-owner', '_admin', '-admin'];

export interface AppPoolOptions {
  /** Verbindungszeichenfolge. Default: `process.env.DATABASE_URL`. */
  readonly connectionString?: string | undefined;
  /** Das eigene Schema der App. Default: `process.env.DATABASE_SCHEMA`. */
  readonly schema?: string | undefined;
  /**
   * Wenn gesetzt, muss die Rolle in der Verbindungszeichenfolge genau so
   * heißen. Die Control Plane kann damit die von ihr angelegte Rolle festnageln.
   */
  readonly expectedRole?: string | undefined;
  /** Name in `pg_stat_activity`. Default: der Schema-Name. */
  readonly applicationName?: string | undefined;
  /** Maximale Verbindungen im Pool. Default 10. */
  readonly max?: number | undefined;
  /** Millisekunden, bis eine untätige Verbindung geschlossen wird. Default 30_000. */
  readonly idleTimeoutMillis?: number | undefined;
  /** Millisekunden, bis das Verbinden aufgegeben wird. Default 5_000. */
  readonly connectionTimeoutMillis?: number | undefined;
}

/**
 * Legt den Pool der App an.
 *
 * Der `search_path` wird als Startup-Option der Verbindung gesetzt
 * (`-c search_path=...`), nicht per `SET` nach dem Verbinden: So gilt er ab der
 * ersten Anweisung und kann nicht durch eine Verbindung, die den Handler
 * verpasst, umgangen werden. `public` steht absichtlich nicht im Pfad — sonst
 * trifft ein unqualifizierter Name still eine fremde Tabelle.
 *
 * @throws {SdkConfigurationError} bei fehlender oder verdächtiger Konfiguration.
 */
export function createAppPool(options: AppPoolOptions = {}): Pool {
  const connectionString = options.connectionString ?? process.env[DATABASE_URL_ENV];
  const schema = options.schema ?? process.env[DATABASE_SCHEMA_ENV];

  if (connectionString === undefined || connectionString.trim() === '') {
    throw new SdkConfigurationError(`${DATABASE_URL_ENV} ist nicht gesetzt.`);
  }
  if (schema === undefined || schema.trim() === '') {
    throw new SdkConfigurationError(
      `${DATABASE_SCHEMA_ENV} ist nicht gesetzt. Eine App ohne festes Schema darf nicht verbinden.`,
    );
  }

  const safeSchema = assertSafeSchemaName(schema.trim());
  assertAppConnectionString(connectionString.trim(), options.expectedRole);

  const config: PoolConfig = {
    connectionString: connectionString.trim(),
    application_name: options.applicationName ?? safeSchema,
    // Startup-Option: gilt ab der ersten Anweisung dieser Verbindung.
    options: `-c search_path=${safeSchema}`,
    max: options.max ?? 10,
    idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  };

  return new Pool(config);
}

/**
 * Prüft die Verbindungszeichenfolge, ohne zu verbinden: brauchbares Postgres-URL,
 * eine Rolle, die nicht nach Owner oder Superuser aussieht, und kein
 * mitgeschmuggelter `search_path`.
 *
 * @throws {SdkConfigurationError}
 */
export function assertAppConnectionString(connectionString: string, expectedRole?: string): void {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch (cause) {
    throw new SdkConfigurationError(
      `${DATABASE_URL_ENV} ist keine brauchbare URL. Erwartet wird postgresql://rolle:…@host/db.`,
      cause instanceof Error ? { cause } : undefined,
    );
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new SdkConfigurationError(
      `${DATABASE_URL_ENV} hat das Schema '${url.protocol}'. Erwartet wird postgres: oder postgresql:.`,
    );
  }

  const role = decodeURIComponent(url.username);
  if (role === '') {
    throw new SdkConfigurationError(
      `${DATABASE_URL_ENV} nennt keine Rolle. Eine App verbindet nur mit ihrer eigenen DB-Rolle.`,
    );
  }

  if (expectedRole !== undefined && role !== expectedRole) {
    throw new SdkConfigurationError(
      `${DATABASE_URL_ENV} verbindet als '${role}', erwartet war '${expectedRole}'.`,
    );
  }

  const lower = role.toLowerCase();
  if (
    FORBIDDEN_ROLES.includes(lower) ||
    FORBIDDEN_ROLE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
  ) {
    throw new SdkConfigurationError(
      `${DATABASE_URL_ENV} verbindet als '${role}'. Das sieht nach einer Owner- oder ` +
        'Superuser-Rolle aus. Eine App bekommt genau eine eigene, eingeschränkte Rolle ' +
        '(AGENTS.md Regel 2).',
    );
  }

  // Ein `search_path` oder `options` in der URL würde die Festlegung unten
  // überschreiben — das ist der `search_path`-Trick, den Regel 2 verbietet.
  for (const key of ['options', 'search_path']) {
    if (url.searchParams.has(key)) {
      throw new SdkConfigurationError(
        `${DATABASE_URL_ENV} enthält '${key}'. Den search_path setzt das SDK, nicht die Env.`,
      );
    }
  }
}

/**
 * Lässt nur einen einfachen Postgres-Namen durch. Der Wert landet in einer
 * Startup-Option, also wird nichts maskiert, sondern Unerwartetes abgewiesen.
 *
 * @throws {SdkConfigurationError}
 */
export function assertSafeSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) {
    throw new SdkConfigurationError(
      `'${schema}' ist kein brauchbarer Schema-Name. Erlaubt sind [a-z_][a-z0-9_]* bis 63 Zeichen.`,
    );
  }
  if (schema === 'public' || schema.startsWith('pg_') || schema === 'information_schema') {
    throw new SdkConfigurationError(
      `'${schema}' ist kein App-Schema. Eine App arbeitet nur in ihrem eigenen Schema.`,
    );
  }
  return schema;
}
