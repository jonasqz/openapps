import type { JSX, ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';

/**
 * Rendert Markdown als React-Elemente. Kein HTML-String, kein
 * `dangerouslySetInnerHTML`: Jeder Text geht als Kind an React und wird
 * escapet. Links haben nur http(s)-Ziele — das prueft der Parser.
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
      const items = block.items.map((item, index) => (
        <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
      ));
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
