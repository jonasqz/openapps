import { LIMITS } from './schemas';

/**
 * Entwuerfe des Editors. Sie liegen nur im Browser (`localStorage`), nicht in
 * der Datenbank: Ein Entwurf ist ungespeicherter Text einer Person, kein
 * Stand des Wikis, und kein Agent und keine andere Person soll ihn sehen.
 * Gespeichert wird erst mit „Save“ (pages.create / pages.update).
 *
 * Alles hier ist ohne DOM: Der Editor liest und schreibt `localStorage`
 * selbst, diese Funktionen bauen Schluessel und pruefen den Inhalt.
 */

export const DRAFT_PREFIX = 'openapps.wiki.draft.v1.';

export interface Draft {
  contentMd: string;
  /** Wann der Entwurf zuletzt geschrieben wurde (ISO). */
  savedAt: string;
  /**
   * `updatedAt` der Seite, als die Bearbeitung begann. Weicht er vom
   * aktuellen ab, hat inzwischen jemand (auch ein Agent) die Seite geaendert.
   * `null` bei einer neuen Seite.
   */
  baseUpdatedAt: string | null;
}

/** Schluessel je Seite, bzw. je Elternseite fuer eine neue Seite. */
export function draftKey(target: { pageId: string } | { parentId: string | null }): string {
  if ('pageId' in target) return `${DRAFT_PREFIX}page.${target.pageId}`;
  return `${DRAFT_PREFIX}new.${target.parentId ?? 'top'}`;
}

/**
 * Liest einen gespeicherten Entwurf. Alles, was nicht genau die erwartete
 * Form hat (fremder Eintrag, kaputtes JSON, zu lang), ist kein Entwurf.
 */
export function parseDraft(raw: string | null): Draft | undefined {
  if (raw === null || raw.length > LIMITS.contentMax * 2) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const { contentMd, savedAt, baseUpdatedAt } = record;
  if (typeof contentMd !== 'string' || contentMd.length > LIMITS.contentMax) return undefined;
  if (typeof savedAt !== 'string' || Number.isNaN(Date.parse(savedAt))) return undefined;
  if (baseUpdatedAt !== null && typeof baseUpdatedAt !== 'string') return undefined;
  return { contentMd, savedAt, baseUpdatedAt };
}

export function serializeDraft(draft: Draft): string {
  return JSON.stringify(draft);
}

/** Ob die Seite seit Beginn des Entwurfs geaendert wurde. */
export function isStale(draft: Draft, currentUpdatedAt: string | null): boolean {
  return draft.baseUpdatedAt !== currentUpdatedAt;
}
