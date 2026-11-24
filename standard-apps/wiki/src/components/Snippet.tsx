import type { JSX } from 'react';

/**
 * Ein Suchausschnitt aus `pages.search`: Text, Treffer in `«…»`. Der Text wird
 * nicht als Markdown gelesen — er ist ein Schnipsel aus der Mitte einer Seite,
 * und halbe Markdown-Konstrukte wuerden falsch gerendert.
 */
export function splitSnippet(snippet: string): Array<{ text: string; hit: boolean }> {
  const parts: Array<{ text: string; hit: boolean }> = [];
  const pattern = /«([^«»]*)»/g;
  let last = 0;
  for (let match = pattern.exec(snippet); match !== null; match = pattern.exec(snippet)) {
    if (match.index > last) parts.push({ text: snippet.slice(last, match.index), hit: false });
    if ((match[1] ?? '') !== '') parts.push({ text: match[1] ?? '', hit: true });
    last = match.index + match[0].length;
  }
  if (last < snippet.length) parts.push({ text: snippet.slice(last), hit: false });
  return parts;
}

export function Snippet({ source }: { source: string }): JSX.Element {
  // Teile eines Satzes, keine Datenliste.
  const parts = splitSnippet(source).map((part, index) =>
    part.hit ? (
      <strong key={index} className="font-semibold text-fg">
        {part.text}
      </strong>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
  return <>{parts}</>;
}
