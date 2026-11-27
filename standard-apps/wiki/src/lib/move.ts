/**
 * Regeln fuer das Verschieben einer Seite, ohne Datenbank. `pages.ts` laedt
 * die Kette der neuen Elternseite und fragt hier, ob das Verschieben erlaubt
 * ist — so ist dieselbe Regel getestet, die auch laeuft.
 */

/**
 * Prueft, ob `pageId` unter `newParentId` gehaengt werden darf.
 *
 * `newParentChain` sind die Ids von `newParentId` selbst und all seinen
 * Vorfahren, in beliebiger Reihenfolge. Steht `pageId` darin, ist die neue
 * Elternseite eine Unterseite (oder die Seite selbst) — das ergaebe einen
 * Kreis, und der Teilbaum hinge an keiner Wurzel mehr.
 *
 * Gibt eine Fehlermeldung fuer Mensch und Agent zurueck, oder `undefined`,
 * wenn das Verschieben erlaubt ist.
 */
export function moveProblem(
  pageId: string,
  newParentId: string | null,
  newParentChain: readonly string[],
): string | undefined {
  if (newParentId === null) return undefined;
  if (newParentId === pageId) return 'A page cannot be its own parent.';
  if (newParentChain.includes(pageId)) {
    return 'A page cannot be moved under one of its own subpages. Move the subpage out first, or choose a different parent.';
  }
  return undefined;
}
