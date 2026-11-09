import { z } from 'zod';

/**
 * Das eine Rechtemodell (CLAUDE.md Grundsatz 4): Wer (Subjekt-Art) darf was
 * (Verb) auf welcher Ressource. Dieselben drei Achsen gelten für Mensch → App,
 * App → App und Agent → Tool. Durchgesetzt wird immer zentral (Gateway,
 * Postgres-Grant, Plattform-MCP) — eine App enthält nie Rechte-Code.
 *
 * Im Manifest stehen *gewünschte* Rechte. Sie sind ein Antrag, keine Freigabe:
 * Default-Deny bleibt, bis die Control Plane `grant` ausführt.
 */

/** Mensch, Gruppe, App oder Agent — die vier Subjekt-Arten. */
export const subjectKindSchema = z.enum(['human', 'group', 'app', 'agent']);
export type SubjectKind = z.infer<typeof subjectKindSchema>;

/** Lesen, schreiben, ausführen. */
export const verbSchema = z.enum(['read', 'write', 'execute']);
export type Verb = z.infer<typeof verbSchema>;

/** App, Tabelle, View oder Tool. */
export const resourceKindSchema = z.enum(['app', 'table', 'view', 'tool']);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

/** Bezeichner: Kleinbuchstaben, Ziffern, Bindestrich. */
const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'erwartet einen Slug aus [a-z0-9-]');

/**
 * Qualifizierter Ressourcen-Name. `app` ist der App-Slug, in dessen Namensraum
 * die Ressource liegt — bei Tabellen und Views ist das das Postgres-Schema, bei
 * Tools der Tool-Namensraum der App. `name` entfällt bei `kind: 'app'`, weil die
 * App selbst die Ressource ist.
 */
export const resourceRefSchema = z
  .object({
    kind: resourceKindSchema,
    app: slug,
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9_.]+$/, 'erwartet [a-z0-9_.]')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'app' && value.name !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: "bei kind 'app' darf 'name' nicht gesetzt sein",
      });
    }
    if (value.kind !== 'app' && value.name === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: `bei kind '${value.kind}' ist 'name' nötig`,
      });
    }
  });
export type ResourceRef = z.infer<typeof resourceRefSchema>;

/**
 * Ein gewünschtes Recht. `subjectId` bleibt offen, wenn die App ein Recht für
 * eine erst bei der Installation bekannte Gruppe beantragt — die Control Plane
 * fragt es dann beim Freigeben ab.
 */
export const requestedGrantSchema = z
  .object({
    subjectKind: subjectKindSchema,
    subjectId: z.string().min(1).max(128).optional(),
    verb: verbSchema,
    resource: resourceRefSchema,
    /** Warum die App das braucht. Geht ins Review-Gate und in die Freigabe-UI. */
    reason: z.string().min(1).max(500),
  })
  .strict();
export type RequestedGrant = z.infer<typeof requestedGrantSchema>;

export { slug as slugSchema };
