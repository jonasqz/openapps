import Link from 'next/link';
import type { JSX, ReactNode } from 'react';
import { Icon, cn } from '@openapps/ui';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';
import { WikiRefChip } from './Refs';

/**
 * Rendert Markdown als React-Elemente. Kein HTML-String, kein
 * `dangerouslySetInnerHTML`: Jeder Text geht als Kind an React und wird
 * escapet. Links haben nur http(s)-Ziele — das prueft der Parser.
 * Seitenlinks (`page:<uuid>`) gehen ueber `next/link` auf `/pages/<uuid>`,
 * damit der basePath stimmt; der Pfad entsteht hier aus der geprueften UUID.
 * Verweise `@{app:typ:id}` (ADR 0023) werden Chips, die ihren Titel im
 * Browser ueber die Plattform laden, mit den Rechten der lesenden Person.
 *
 * Die Ueberschriften beginnen bei `h2`, weil der Seitentitel das `h1` ist.
 *
 * Laeuft auf dem Server wie im Browser; keine Hooks.
 */

const HEADING_CLASS: Record<number, string> = {
  1: 'mt-6 text-xl font-semibold text-fg first:mt-0',
  2: 'mt-6 text-lg font-semibold text-fg first:mt-0',
  3: 'mt-5 text-base font-semibold text-fg first:mt-0',
  4: 'mt-4 text-sm font-semibold text-fg first:mt-0',
  5: 'mt-4 text-sm font-semibold text-fg-muted first:mt-0',
  6: 'mt-4 text-xs font-semibold uppercase tracking-wide text-fg-muted first:mt-0',
};

function renderInline(nodes: readonly Inline[], keyPrefix: string): ReactNode[] {
  // Eine Folge von Textstuecken, kein Datenbestand — `nodes` ist hoechstens
  // leer, wenn der Absatz leer ist, und dann rendert hier schlicht nichts.
  const out: ReactNode[] = [];
  nodes.forEach((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        out.push(node.text);
        break;
      case 'strong':
        out.push(
          <strong key={key} className="font-semibold">
            {renderInline(node.children, key)}
          </strong>,
        );
        break;
      case 'em':
        out.push(<em key={key}>{renderInline(node.children, key)}</em>);
        break;
      case 'code':
        out.push(
          <code key={key} className="rounded-sm bg-surface-muted px-1 font-mono text-sm">
            {node.text}
          </code>,
        );
        break;
      case 'link':
        out.push(
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2 hover:text-primary-hover"
          >
            {renderInline(node.children, key)}
          </a>,
        );
        break;
      case 'ref':
        out.push(<WikiRefChip key={key} value={node.ref} />);
        break;
      case 'pagelink':
        out.push(
          <Link
            key={key}
            href={`/pages/${node.id}`}
            className="text-primary underline decoration-border-strong underline-offset-2 hover:decoration-primary"
          >
            {renderInline(node.children, key)}
          </Link>,
        );
        break;
    }
  });
  return out;
}

function renderBlock(block: Block, key: string): JSX.Element {
  switch (block.type) {
    case 'heading': {
      const level = Math.min(block.level + 1, 6);
      const className = HEADING_CLASS[block.level];
      const children = renderInline(block.children, key);
      if (level === 2) return <h2 key={key} className={className}>{children}</h2>;
      if (level === 3) return <h3 key={key} className={className}>{children}</h3>;
      if (level === 4) return <h4 key={key} className={className}>{children}</h4>;
      if (level === 5) return <h5 key={key} className={className}>{children}</h5>;
      return <h6 key={key} className={className}>{children}</h6>;
    }
    case 'paragraph':
      return (
        <p key={key} className="mt-3 text-sm text-fg first:mt-0">
          {renderInline(block.children, key)}
        </p>
      );
    case 'quote':
      return (
        <blockquote
          key={key}
          className="mt-3 border-l-2 border-border-strong pl-3 text-sm text-fg-muted first:mt-0"
        >
          {renderInline(block.children, key)}
        </blockquote>
      );
    case 'code':
      return (
        <pre
          key={key}
          className="mt-3 overflow-x-auto rounded-md bg-surface-muted p-3 font-mono text-sm text-fg first:mt-0"
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} className="my-4 border-border" />;
    case 'list': {
      // Ein Markdown-Aufzaehlungspunkt ist Inhalt, keine geladene Datenliste:
      // Der Parser erzeugt eine Liste nur aus mindestens einem Punkt, und es
      // gibt nichts, was beim Laden scheitern koennte. Leer- und Fehlerzustand
      // der Seite selbst liegen eine Ebene hoeher.
      const isChecklist = block.checked.some((value) => value !== null);
      const items = block.items.map((item, index) => {
        const itemKey = `${key}-${index}`;
        const checked = block.checked[index] ?? null;
        if (checked === null) return <li key={itemKey}>{renderInline(item, itemKey)}</li>;
        // Ein Kaestchen zur Anzeige, kein Eingabefeld: Abhaken ist eine
        // Aenderung am Inhalt und laeuft ueber „Edit“ bzw. pages.update.
        return (
          <li key={itemKey} className="flex list-none items-start gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                checked ? 'border-primary bg-primary text-primary-fg' : 'border-border-strong',
              )}
            >
              {checked ? <Icon name="check" size="sm" /> : null}
            </span>
            <span className="sr-only">{checked ? 'Done: ' : 'Open: '}</span>
            <span className={cn('min-w-0', checked && 'text-fg-muted line-through')}>
              {renderInline(item, itemKey)}
            </span>
          </li>
        );
      });
      if (isChecklist && !block.ordered) {
        return (
          <ul key={key} className="mt-3 space-y-1 text-sm text-fg first:mt-0">
            {items}
          </ul>
        );
      }
      return block.ordered ? (
        <ol
          key={key}
          start={block.start}
          className="mt-3 list-decimal space-y-1 pl-6 text-sm text-fg first:mt-0"
        >
          {items}
        </ol>
      ) : (
        <ul key={key} className="mt-3 list-disc space-y-1 pl-6 text-sm text-fg first:mt-0">
          {items}
        </ul>
      );
    }
  }
}

export function Markdown({ source }: { source: string }): JSX.Element {
  const blocks = parseMarkdown(source);
  return <div className="min-w-0 [overflow-wrap:anywhere]">{blocks.map((block, index) => renderBlock(block, `b${index}`))}</div>;
}
