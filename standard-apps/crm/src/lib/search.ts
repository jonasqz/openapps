/**
 * Freitext fuer `ilike`: `%` und `_` im Suchtext sind Zeichen, keine
 * Platzhalter. Sonst findet die Suche nach "100%" alles und die nach "a_b"
 * auch "axb". Escape-Zeichen ist der Postgres-Default `\`.
 */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
