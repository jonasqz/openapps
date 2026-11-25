'use client';

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Badge, ListPattern, cn } from '@openapps/ui';
import { Snippet } from '@/components/Snippet';
import { LinkButton, TextLink } from '@/components/LinkButton';
import type { PageRow } from '@/lib/tree';

/**
 * Die Seitenliste der Startseite: als eingerueckter Baum, oder — sobald
 * gesucht wird — als Trefferliste mit Ausschnitt. Die Daten kommen fertig vom
 * Server (`page.tsx`); hier wird nur angezeigt und die URL gesetzt.
 */

export interface PageListProps {
  mode: 'tree' | 'search';
  rows: PageRow[];
  q: string;
  tag: string;
  tagOptions: string[];
  failed: boolean;
  truncated: boolean;
}

/** Einrueckung je Ebene. Feste Klassen, damit Tailwind sie findet. */
const INDENT = ['', 'pl-4', 'pl-8', 'pl-12', 'pl-16', 'pl-20', 'pl-24'] as const;

const SEARCH_DELAY_MS = 300;

export function PageList({
  mode,
  rows,
  q,
  tag,
  tagOptions,
  failed,
  truncated,
}: PageListProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);
  const lastPushed = useRef(q);

  // Suchfeld -> URL, verzoegert, damit nicht jeder Tastendruck eine Abfrage ist.
  useEffect(() => {
    if (search.trim() === lastPushed.current.trim()) return undefined;
    const timer = setTimeout(() => {
      lastPushed.current = search;
      router.replace(urlFor(pathname, search.trim(), tag));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, tag, pathname, router]);

  const filtersActive = q !== '' || tag !== '';

  return (
    <ListPattern<PageRow>
      title="Wiki"
      description={
        truncated
          ? 'There are more pages than fit here. Search or filter by tag to find the rest.'
          : 'Knowledge pages for humans and agents. Every change is in the history.'
      }
      actions={
        <LinkButton href="/new" variant="primary">
          New page
        </LinkButton>
      }
      search={{
        label: 'Search',
        value: search,
        onChange: setSearch,
        placeholder: 'Full text, e.g. request leave',
      }}
      filters={[
        {
          id: 'tag',
          label: 'Tag',
          value: tag,
          placeholder: 'All tags',
          options: tagOptions.map((option) => ({ value: option, label: option })),
          onChange: (value) => router.replace(urlFor(pathname, q, value)),
        },
      ]}
      filtersActive={filtersActive}
      onResetFilters={() => {
        setSearch('');
        lastPushed.current = '';
        router.replace(pathname);
      }}
      columns={[
        {
          key: 'title',
          header: 'Title',
          cell: (row) => (
            <div className={cn('min-w-0', INDENT[Math.min(row.depth, INDENT.length - 1)])}>
              {row.depth > 0 ? (
                <span aria-hidden="true" className="mr-1 text-fg-subtle">
                  ↳
                </span>
              ) : null}
              <TextLink href={`/pages/${row.id}`}>{row.title}</TextLink>
              {row.snippet === undefined ? null : (
                <p className="mt-1 text-xs text-fg-muted">
                  <Snippet source={row.snippet} />
                </p>
              )}
            </div>
          ),
        },
        {
          key: 'tags',
          header: 'Tags',
          hideBelow: 'sm',
          cell: (row) =>
            row.tags.length === 0 ? (
              <span className="text-fg-subtle">–</span>
            ) : (
              <span className="flex flex-wrap gap-1">
                {row.tags.map((name) => (
                  <Badge key={name}>{name}</Badge>
                ))}
              </span>
            ),
        },
        { field: 'updatedAt', header: 'Updated', hideBelow: 'md' },
      ]}
      rows={rows}
      {...(failed
        ? {
            error: {
              title: mode === 'search' ? 'Search failed' : 'Pages could not be loaded',
              description: 'The database did not respond. Please try again in a moment.',
              retry: () => router.refresh(),
            },
          }
        : {})}
      empty={{
        title: 'No pages yet',
        description: 'Create the first page. Agents can do the same with the pages.create tool.',
        action: (
          <LinkButton href="/new" variant="primary" size="sm">
            New page
          </LinkButton>
        ),
      }}
      emptyFiltered={{
        title: mode === 'search' ? 'No matches' : 'No pages with this tag',
        description:
          mode === 'search'
            ? 'Try different words or fewer of them. Search covers title and content.'
            : 'Choose a different tag or reset the filter.',
      }}
    />
  );
}

function urlFor(pathname: string, q: string, tag: string): string {
  const params = new URLSearchParams();
  if (q !== '') params.set('q', q);
  if (tag !== '') params.set('tag', tag);
  const query = params.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}
