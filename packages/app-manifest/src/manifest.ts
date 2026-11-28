import { z } from 'zod';
import { requestedGrantSchema, slugSchema, verbSchema } from './permissions.js';
import { isRefAppName, isRefType, REF_LIMITS } from './refs.js';

/**
 * Das maßgebliche Schema für `app.json` (docs/04-app-manifest.md).
 *
 * Felder aus dem Brief: Name, Beschreibung, Kategorie, Version, benötigte
 * Tabellen, angebotene MCP-Tools, gewünschte Rechte, Quelle.
 * Dazu, weil die Plattform es braucht: deklarierte Env-Variablen (AGENTS.md
 * Regel 5) und deklarierte ausgehende Netzwerkziele (Regel 7).
 */

const description = z.string().min(1).max(500);

/** Semver ohne führendes `v`. Build-Metadaten sind erlaubt, Ranges nicht. */
export const semverSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/,
    'expected an exact semver version, e.g. 1.2.3',
  );

/**
 * Kategorie des Katalogs. Offene Liste als Slug, damit v1 keinen Enum braucht,
 * den der späte Katalog ohnehin umschreiben würde.
 * OFFENE ENTSCHEIDUNG (CoS): feste Kategorienliste oder frei?
 */
export const categorySchema = slugSchema;

/** Eine Tabelle im eigenen Schema der App (AGENTS.md Regel 2). */
export const requiredTableSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(63)
      .regex(/^[a-z][a-z0-9_]*$/, 'expected a Postgres name of [a-z0-9_]'),
    description,
  })
  .strict();
export type RequiredTable = z.infer<typeof requiredTableSchema>;

/**
 * Ein MCP-Tool, das die App anbietet. Erzeugt wird es aus `openapi.yaml`
 * (AGENTS.md Regel 3); hier steht, was der Katalog und das Rechtemodell davon
 * wissen müssen. `verb` ordnet das Tool dem einen Rechtemodell zu, damit eine
 * Freigabe „Agent darf lesen“ ohne Sonderlogik auf Tools wirkt.
 */
export const offeredToolSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'expected [a-z0-9._-]'),
    description,
    verb: verbSchema,
    /** `operationId` der zugehörigen Operation in `openapi.yaml`. */
    operationId: z.string().min(1).max(128),
  })
  .strict();
export type OfferedTool = z.infer<typeof offeredToolSchema>;

/**
 * Eine Env-Variable, die die App erwartet. AGENTS.md Regel 5: Secrets kommen
 * nur über Env und sind hier deklariert. Werte stehen nie im Manifest — die
 * Control Plane setzt sie beim Deploy.
 */
export const envVarSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Z][A-Z0-9_]*$/, 'expected SCREAMING_SNAKE_CASE'),
    secret: z.boolean(),
    description,
    /** Nur für Nicht-Secrets. Ein Default für ein Secret ist ein Code-Secret. */
    default: z.string().max(500).optional(),
    required: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.secret && value.default !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['default'],
        message: 'a secret must not have a default in the manifest',
      });
    }
  });
export type EnvVar = z.infer<typeof envVarSchema>;

/**
 * Ein ausgehendes Ziel. AGENTS.md Regel 7: nichts am Gateway vorbei — was hier
 * nicht steht, ist gesperrt. Hostname ohne Schema und ohne Pfad, damit das Ziel
 * als Firewall-/Proxy-Regel taugt.
 */
export const egressTargetSchema = z
  .object({
    host: z
      .string()
      .min(1)
      .max(253)
      .regex(
        /^(\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/,
        'expected a hostname without scheme and path, wildcard only as *.example.com',
      ),
    protocol: z.enum(['https', 'http', 'tcp']),
    port: z.number().int().min(1).max(65535).optional(),
    reason: z.string().min(1).max(500),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.protocol === 'tcp' && value.port === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['port'],
        message: "protocol 'tcp' requires 'port'",
      });
    }
  });
export type EgressTarget = z.infer<typeof egressTargetSchema>;

/**
 * Signierter Kontext, den die App vom Gateway zusaetzlich zur Identitaet
 * anfordert (ADR 0020). Heute nur `readableApps`: die Apps, die der Aufrufer
 * lesen darf, fuer eine App, die Inhalte anderer Apps zeigt (Knowledge). Ohne
 * Anforderung setzt das Gateway die Header leer — die Kosten traegt nur, wer
 * fragt. Eine Anforderung ist keine Freigabe: Die Liste nennt nur, was der
 * Aufrufer ohnehin lesen darf.
 */
export const gatewayContextSchema = z.enum(['readableApps']);
export type GatewayContext = z.infer<typeof gatewayContextSchema>;

/**
 * Postgres-Erweiterung, die die App nutzt (ADR 0025). Heute nur `vector`
 * (pgvector). Die Erweiterung legt der Betreiber einmal als Superuser im
 * Schema `extensions` an; die Control Plane gibt der Rolle einer App, die sie
 * hier nennt, nur `USAGE` auf dieses Schema, nie `CREATE`. Fehlt sie, endet
 * der Deploy als `failed`. Typen und Operatoren spricht die App voll
 * qualifiziert an (`extensions.vector`); ihr search_path bleibt ihr Schema.
 */
export const databaseExtensionSchema = z.enum(['vector']);
export type DatabaseExtension = z.infer<typeof databaseExtensionSchema>;

/**
 * Das Such-Tool der App fuer die Suche ueber alle Apps (ADR 0021). Die
 * Plattform ruft es mit `{ query, limit }` auf und erwartet
 * `{ hits: [{ id, title, snippet?, url, kind? }] }` (Typ `SearchToolResult`
 * in `@openapps/sdk`). Das Tool muss in `offeredTools` stehen und lesen
 * (`verb: read`): Eine Suche, die schreibt, gibt es nicht. Ohne das Feld
 * nimmt die App an der Suche nicht teil.
 */
export const manifestSearchSchema = z
  .object({
    tool: offeredToolSchema.shape.name,
  })
  .strict();
export type ManifestSearch = z.infer<typeof manifestSearchSchema>;

/**
 * Ereignistyp einer App (ADR 0022): `<objekttyp>.<vorgang>`, etwa
 * `task.assigned` oder `deal.won`. Eindeutig je App; der volle Name auf der
 * Plattform ist `<app>.<type>`. Kleinbuchstaben, Ziffern und Unterstrich,
 * genau ein Punkt.
 */
export const eventTypeSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(
    /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
    'expected <object>.<action> of [a-z0-9_], e.g. task.assigned',
  )
  .refine((type) => !type.startsWith('platform.'), {
    message: 'event types starting with platform. are reserved for the platform',
  });

/** Wie wichtig ein Ereignis fuer den Eingang ist. Ordnet Home, ohne Modell. */
export const eventImportanceSchema = z.enum(['high', 'normal', 'low']);
export type EventImportance = z.infer<typeof eventImportanceSchema>;

/**
 * Ein Ereignistyp, den die App meldet (ADR 0022). Die Plattform nimmt nur
 * Ereignisse an, deren Typ hier steht, im Manifest der laufenden Version.
 */
export const manifestEventSchema = z
  .object({
    type: eventTypeSchema,
    description,
    importance: eventImportanceSchema,
  })
  .strict();
export type ManifestEvent = z.infer<typeof manifestEventSchema>;

/**
 * Ein Abonnement auf Ereignisse einer anderen App (ADR 0022 E). Abgerufen
 * werden sie mit `poll_events`; das Recht ist `read` auf die Quell-App fuer
 * `app:<diese App>`, beantragt in `requestedGrants`. Das Abonnement selbst
 * ist keine Freigabe.
 */
export const manifestSubscriptionSchema = z
  .object({
    app: slugSchema,
    type: eventTypeSchema,
  })
  .strict();
export type ManifestSubscription = z.infer<typeof manifestSubscriptionSchema>;

/**
 * Typ eines Objekts fuer Verweise (ADR 0023 A): ein Slug, `task`, `deal`,
 * `next-step`. Der volle Verweis ist `<app>:<typ>:<id>`.
 */
export const objectTypeSchema = z
  .string()
  .min(1)
  .max(REF_LIMITS.type)
  .refine(isRefType, 'expected a slug of [a-z0-9-] starting with a letter, e.g. task');

/**
 * Eine Objektart der App, die andere Apps verlinken koennen (ADR 0023 B).
 * `resolver` ist ein `read`-Tool aus `offeredTools`: Eingabe `{ type, ids }`,
 * Ausgabe `{ objects: [{ id, title, path, status?, updatedAt }] }`
 * (`ResolveToolResult` in `@openapps/sdk`). Aufgeloest wird nur ueber die
 * Plattform, mit der Rechtepruefung des Betrachters.
 */
export const manifestObjectSchema = z
  .object({
    type: objectTypeSchema,
    description,
    resolver: offeredToolSchema.shape.name,
  })
  .strict();
export type ManifestObject = z.infer<typeof manifestObjectSchema>;

/** `<app>:<typ>`, eine Objektart einer (anderen) App, etwa `wiki:page`. */
export const objectKindSchema = z
  .string()
  .min(3)
  .max(100)
  .refine((value) => {
    const [app = '', type = '', ...rest] = value.split(':');
    return rest.length === 0 && isRefAppName(app) && isRefType(type);
  }, 'expected <app>:<type>, e.g. wiki:page');

/**
 * Eine Aktion „aus X wird Y“ (ADR 0023 E), erklaert von der **Ziel**-App:
 * Sie nimmt Verweise der Arten in `accepts` und legt mit `tool` ein Objekt
 * an. `tool` nimmt `{ sourceRef, excerpt? }`. `path` ist die Seite der App,
 * auf der eine Person die Aktion bestaetigt; die Plattform haengt `ref` und
 * `excerpt` als Parameter an. Ohne `path` gibt es die Aktion nur fuer Agents
 * und Apps.
 */
export const manifestActionSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/, 'expected [a-z0-9_] starting with a letter'),
    title: z.string().min(1).max(60),
    accepts: z.array(objectKindSchema).min(1).max(20),
    tool: offeredToolSchema.shape.name,
    path: z
      .string()
      .min(1)
      .max(200)
      .regex(/^\/(?!\/)[A-Za-z0-9._~\/-]*$/, 'expected a path in the app, e.g. /new')
      .refine((path) => !path.split('/').some((part) => part === '..' || part === '.'), {
        message: 'the path must not contain . or .. segments',
      })
      .optional(),
  })
  .strict();
export type ManifestAction = z.infer<typeof manifestActionSchema>;

/** Die Quelle: Git-URL und Tag. Ein Branch ist keine Quelle — Deploys sind an einen Tag gebunden. */
export const manifestSourceSchema = z
  .object({
    git: z
      .string()
      .min(1)
      .max(500)
      .regex(/^(https:\/\/|git@)/, 'expected an https:// or git@ URL'),
    tag: z.string().min(1).max(128),
  })
  .strict();
export type ManifestSource = z.infer<typeof manifestSourceSchema>;

export const appManifestSchema = z
  .object({
    /** Version des Manifest-Formats selbst, nicht der App. */
    manifestVersion: z.literal(1),
    name: slugSchema,
    displayName: z.string().min(1).max(64),
    description,
    category: categorySchema,
    version: semverSchema,
    requiredTables: z.array(requiredTableSchema).default([]),
    offeredTools: z.array(offeredToolSchema).default([]),
    requestedGrants: z.array(requestedGrantSchema).default([]),
    env: z.array(envVarSchema).default([]),
    egress: z.array(egressTargetSchema).default([]),
    /** Optional, damit aeltere Manifeste unveraendert gueltig bleiben. */
    gatewayContext: z.array(gatewayContextSchema).max(8).optional(),
    /** Optional (ADR 0025): Postgres-Erweiterungen aus dem Schema `extensions`. */
    databaseExtensions: z.array(databaseExtensionSchema).max(4).optional(),
    /** Optional: Ohne Such-Tool nimmt die App an der Suche ueber alle Apps nicht teil. */
    search: manifestSearchSchema.optional(),
    /** Optional (ADR 0022): Ereignistypen, die die App meldet. */
    events: z.array(manifestEventSchema).max(100).optional(),
    /** Optional (ADR 0022): Ereignisse anderer Apps, die die App abruft. */
    subscriptions: z.array(manifestSubscriptionSchema).max(100).optional(),
    /** Optional (ADR 0023): Objektarten, die andere Apps verlinken koennen, mit Resolver. */
    objects: z.array(manifestObjectSchema).max(20).optional(),
    /** Optional (ADR 0023): Aktionen „aus X wird Y“, die diese App anbietet. */
    actions: z.array(manifestActionSchema).max(20).optional(),
    source: manifestSourceSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    reportDuplicates(
      value.requiredTables.map((table) => table.name),
      ['requiredTables'],
      ctx,
    );
    reportDuplicates(
      value.offeredTools.map((tool) => tool.name),
      ['offeredTools'],
      ctx,
    );
    reportDuplicates(
      value.env.map((entry) => entry.name),
      ['env'],
      ctx,
    );
    (value.databaseExtensions ?? []).forEach((name, index, all) => {
      if (all.indexOf(name) !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['databaseExtensions', index],
          message: `duplicate extension: ${name}`,
        });
      }
    });
    reportDuplicateValues(
      (value.events ?? []).map((entry) => entry.type),
      ['events'],
      'type',
      ctx,
    );
    reportDuplicateValues(
      (value.subscriptions ?? []).map((entry) => `${entry.app}.${entry.type}`),
      ['subscriptions'],
      'type',
      ctx,
    );
    (value.subscriptions ?? []).forEach((entry, index) => {
      if (entry.app === value.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['subscriptions', index, 'app'],
          message: 'an app does not subscribe to its own events',
        });
      }
    });
    reportDuplicateValues(
      (value.objects ?? []).map((entry) => entry.type),
      ['objects'],
      'type',
      ctx,
    );
    reportDuplicateValues(
      (value.actions ?? []).map((entry) => entry.name),
      ['actions'],
      'name',
      ctx,
    );
    (value.objects ?? []).forEach((entry, index) => {
      const tool = value.offeredTools.find((offered) => offered.name === entry.resolver);
      if (tool === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['objects', index, 'resolver'],
          message: `resolver "${entry.resolver}" is not in offeredTools`,
        });
      } else if (tool.verb !== 'read') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['objects', index, 'resolver'],
          message: `resolver "${tool.name}" must have verb "read", not "${tool.verb}"`,
        });
      }
    });
    (value.actions ?? []).forEach((entry, index) => {
      if (!value.offeredTools.some((offered) => offered.name === entry.tool)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['actions', index, 'tool'],
          message: `action tool "${entry.tool}" is not in offeredTools`,
        });
      }
    });
    if (value.search !== undefined) {
      const tool = value.offeredTools.find((entry) => entry.name === value.search?.tool);
      if (tool === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['search', 'tool'],
          message: `search tool "${value.search.tool}" is not in offeredTools`,
        });
      } else if (tool.verb !== 'read') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['search', 'tool'],
          message: `search tool "${tool.name}" must have verb "read", not "${tool.verb}"`,
        });
      }
    }
  });

export type AppManifest = z.infer<typeof appManifestSchema>;
/** Die Form, wie sie in `app.json` stehen darf — vor dem Einsetzen der Defaults. */
export type AppManifestInput = z.input<typeof appManifestSchema>;

function reportDuplicateValues(
  values: readonly string[],
  path: (string | number)[],
  field: string,
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, field],
        message: `duplicate ${field}: ${value}`,
      });
    }
    seen.add(value);
  });
}

function reportDuplicates(
  names: readonly string[],
  path: (string | number)[],
  ctx: z.RefinementCtx,
) {
  const seen = new Set<string>();
  names.forEach((name, index) => {
    if (seen.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, index, 'name'],
        message: `duplicate name: ${name}`,
      });
    }
    seen.add(name);
  });
}
