import { z } from 'zod';
import { appManifestSchema, type AppManifest } from './manifest.js';

/** Ein einzelner Befund, als Zeile für Review-Gate-Ausgabe und MCP-Antwort. */
export interface ManifestIssue {
  /** Pfad im Manifest, z. B. `offeredTools.0.name`. Leer bei Fehlern an der Wurzel. */
  path: string;
  message: string;
}

export type ManifestValidationResult =
  | { readonly ok: true; readonly manifest: AppManifest }
  | { readonly ok: false; readonly issues: readonly ManifestIssue[] };

export class ManifestValidationError extends Error {
  readonly issues: readonly ManifestIssue[];

  constructor(issues: readonly ManifestIssue[], context?: string) {
    const where = context === undefined ? '' : ` in ${context}`;
    super(
      `Ungültiges App-Manifest${where}:\n` +
        issues
          .map((issue) => `  ${issue.path === '' ? '(Wurzel)' : issue.path}: ${issue.message}`)
          .join('\n'),
    );
    this.name = 'ManifestValidationError';
    this.issues = issues;
  }
}

/**
 * Prüft unbekannte Daten gegen das Manifest-Schema. Gibt Befunde zurück statt zu
 * werfen, damit das Review-Gate alle Fehler auf einmal melden kann.
 */
export function validateAppManifest(input: unknown): ManifestValidationResult {
  const parsed = appManifestSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, manifest: parsed.data };
  }
  return { ok: false, issues: toIssues(parsed.error) };
}

/** Wie `validateAppManifest`, wirft aber — für Aufrufer, die nur den gültigen Fall behandeln. */
export function parseAppManifest(input: unknown, context?: string): AppManifest {
  const result = validateAppManifest(input);
  if (!result.ok) {
    throw new ManifestValidationError(result.issues, context);
  }
  return result.manifest;
}

/** Liest `app.json`-Text und prüft ihn. JSON-Syntaxfehler kommen als Befund an der Wurzel. */
export function parseAppManifestJson(text: string, context?: string): AppManifest {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ManifestValidationError(
      [{ path: '', message: `kein gültiges JSON: ${message}` }],
      context,
    );
  }
  return parseAppManifest(data, context);
}

function toIssues(error: z.ZodError): ManifestIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
