import Link from 'next/link';
import type { JSX } from 'react';
import { EmptyState, ErrorState, Icon, cn, focusRing } from '@openapps/ui';
import type { TreeNode } from '@/lib/tree';

/**
 * Der Seitenbaum zum Navigieren, neben einer Seite. Serverfaehig, ohne Hooks:
 * Auf- und Zuklappen macht `<details>` im Browser. Offen sind die Vorfahren
 * der aktuellen Seite und die aktuelle Seite selbst, damit man sieht, wo man
 * ist; alles andere ist zu.
 *
 * Liest wie das Tool `pages.tree`.
 */
export interface PageTreeProps {
  nodes: readonly TreeNode[];
  /** Die angezeigte Seite, hervorgehoben und mit `aria-current`. */
  currentId?: string;
  /** Ids, deren Unterseiten aufgeklappt sind (Vorfahren der aktuellen Seite). */
  openIds?: readonly string[];
  failed?: boolean;
  truncated?: boolean;
}

export function PageTree({
  nodes,
  currentId,
  openIds = [],
  failed = false,
  truncated = false,
}: PageTreeProps): JSX.Element {
  if (failed) {
    return <ErrorState title="Page tree could not be loaded" description="Reload the page to try again." />;
  }
  if (nodes.length === 0) {
    return <EmptyState title="No pages yet" description="Create the first page with “New page”." />;
  }
  const open = new Set(openIds);
  if (currentId !== undefined) open.add(currentId);
  return (
    <nav aria-label="Page tree" className="min-w-0 text-sm">
      <ul className="flex flex-col gap-0.5">
        {nodes.map((node) => (
          <TreeItem key={node.id} node={node} currentId={currentId} open={open} />
        ))}
      </ul>
      {truncated ? (
        <p className="mt-3 text-xs text-fg-muted">
          Only part of the tree fits here. Use search or open a page further down.
        </p>
      ) : null}
    </nav>
  );
}

function TreeItem({
  node,
  currentId,
  open,
}: {
  node: TreeNode;
  currentId: string | undefined;
  open: ReadonlySet<string>;
}): JSX.Element {
  const current = node.id === currentId;
  const label = (
    <Link
      href={`/pages/${node.id}`}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'block min-w-0 flex-1 truncate rounded-sm px-1.5 py-1',
        focusRing,
        current ? 'bg-surface-hover font-medium text-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {node.title}
    </Link>
  );

  if (node.children.length === 0) {
    return (
      <li className="flex min-w-0 items-center gap-1 pl-5">
        {label}
      </li>
    );
  }

  return (
    <li className="min-w-0">
      <details open={open.has(node.id)} className="group min-w-0">
        <summary
          className={cn(
            'flex min-w-0 cursor-pointer list-none items-center gap-1 rounded-sm [&::-webkit-details-marker]:hidden',
            focusRing,
          )}
        >
          <span className="text-fg-subtle transition-transform group-open:rotate-90" aria-hidden="true">
            <Icon name="chevron-right" size="sm" />
          </span>
          {label}
        </summary>
        <ul className="ml-3 flex flex-col gap-0.5 border-l border-border pl-1">
          {node.children.map((child) => (
            <TreeItem key={child.id} node={child} currentId={currentId} open={open} />
          ))}
        </ul>
      </details>
    </li>
  );
}
