/**
 * Schema und DB-Rolle pro App, plus die Postgres-Seite der Freigaben.
 *
 * Alles laeuft ueber `provision_app_schema` (Migration 0006, ersetzt in 0013) — die Funktion
 * haelt fest, dass eine App-Rolle nie SUPERUSER und nie BYPASSRLS bekommt.
 * Hier im Code wird keine Rolle direkt angelegt, damit es nur eine Stelle gibt,
 * an der diese Regel steht.
 */

import { randomBytes } from 'node:crypto';
import type { SchemaProvisioner } from '../../domain/ports';
import type { Queryable } from './pool';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface PgProvisionerOptions {
  /** Host-Teil der DSN, die eine App als DATABASE_URL bekommt. */
  readonly appDsnTemplate: (input: { role: string; password: string; schema: string }) => string;
}

export function createPgProvisioner(
  db: Queryable,
  options: PgProvisionerOptions,
): SchemaProvisioner {
  return {
    async provision({ schemaName, dbRole }) {
      assertIdentifier(schemaName);
      assertIdentifier(dbRole);
      // Das Passwort entsteht hier und wird nicht gespeichert; es geht als
      // DSN direkt in die Env der App.
      const password = randomBytes(24).toString('base64url');
      await db.query(`SELECT provision_app_schema($1, $2, $3)`, [schemaName, dbRole, password]);
      return { dsn: options.appDsnTemplate({ role: dbRole, password, schema: schemaName }) };
    },

    async grantSelect({ grantee, schemaName, objectName }) {
      assertIdentifier(grantee);
      assertIdentifier(schemaName);
      assertIdentifier(objectName);
      // USAGE auf dem Schema und SELECT auf genau einem Objekt — nicht auf
      // "ALL TABLES", damit eine spaetere Tabelle nicht stillschweigend
      // mitfreigegeben wird. Ueber die Funktion aus Migration 0013, die als
      // Eigentuemer des Schemas freigibt: Ein direktes GRANT der Control Plane
      // waere ohne Superuser nur eine WARNING und haette nichts bewirkt.
      await db.query(`SELECT app_select_grant($1, $2, $3, 'grant')`, [
        schemaName,
        objectName,
        grantee,
      ]);
    },

    async revokeSelect({ grantee, schemaName, objectName }) {
      assertIdentifier(grantee);
      assertIdentifier(schemaName);
      assertIdentifier(objectName);
      await db.query(`SELECT app_select_grant($1, $2, $3, 'revoke')`, [
        schemaName,
        objectName,
        grantee,
      ]);
    },
  };
}

/**
 * Bezeichner koennen in Postgres nicht als Parameter uebergeben werden. Statt
 * zu quoten und zu hoffen, wird hier gegen ein enges Muster geprueft — die
 * Namen stammen ohnehin aus `src/domain/naming.ts`, nicht von einem Nutzer.
 */
function assertIdentifier(value: string): void {
  if (!IDENTIFIER.test(value) || value.length > 63) {
    throw new Error(`ungueltiger SQL-Bezeichner: "${value}"`);
  }
}
