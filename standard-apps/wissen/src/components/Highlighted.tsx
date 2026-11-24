import type { JSX } from 'react';
import { parseHighlights } from '@/lib/highlight';

/**
 * Ein Suchausschnitt mit markierten Treffern. Jedes Stueck geht als
 * React-Text hinein, React maskiert es — kein `dangerouslySetInnerHTML`, also
 * kommt aus einem Dokument kein HTML in die Seite.
 */
export function Highlighted({ text }: { text: string }): JSX.Element {
  return (
    <>
      {parseHighlights(text).map((segment, index) =>
        segment.marked ? (
          <mark
            key={index}
            className="rounded-sm bg-warning-subtle px-0.5 font-medium text-warning-subtle-fg"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}
