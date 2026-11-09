import { zodToJsonSchema } from 'zod-to-json-schema';
import { appManifestSchema } from './manifest.js';

/**
 * JSON-Schema für `app.json`, damit Agents und Werkzeuge ohne TypeScript das
 * Manifest prüfen können (AGENTS.md Regel 4).
 *
 * Begründung der Wahl: aus zod generiert, nicht von Hand gepflegt. Das zod-
 * Schema ist die eine Quelle der Wahrheit; ein zweites, handgeschriebenes
 * Schema würde beim ersten Feld auseinanderlaufen, und genau dieses
 * Auseinanderlaufen prüft das Review-Gate ja. Die Datei `schema/app.schema.json`
 * entsteht beim `build` und ist als `@openapps/app-manifest/app.schema.json`
 * exportiert.
 */
export const APP_MANIFEST_SCHEMA_ID = 'https://openapps.dev/schema/app-manifest/v1/app.schema.json';

export function appManifestJsonSchema(): Record<string, unknown> {
  // Ohne `name` und ohne `$ref`: Das Schema steht an der Wurzel, damit jeder
  // JSON-Schema-Validator es direkt gegen eine app.json halten kann.
  const generated = zodToJsonSchema(appManifestSchema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;

  return {
    $id: APP_MANIFEST_SCHEMA_ID,
    title: 'openapps App-Manifest (app.json)',
    ...generated,
  };
}
