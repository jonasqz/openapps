import type { JSX, ReactNode } from 'react';
import { Badge, Table } from '@openapps/ui';
import { formatDateTime } from '@/lib/format';
import type { PageSummary } from '@/lib/pages';
import { LinkButton, TextLink } from './LinkButton';

/**
 * Eine Seitenliste als Tabelle, serverfaehig (nur `field`-Spalten). Fuer
 * „Favorites“ und „Recently edited“. Leer- und Fehlerzustand kommen aus
 * `Table`; die Texte gibt die Seite vor.
 */
interface Row {
  id: string;
  title: ReactNode;
  tags: ReactNode;
  updated: string;
  updatedBy: string;
}

export function PageTable({
  caption,
  pages,
  failed,
  empty,
}: {
  caption: string;
  pages: readonly PageSummary[];
  failed: boolean | { title: string; description: string };
  empty: { title: string; description: string };
}): JSX.Element {
  const rows: Row[] = pages.map((page) => ({
    id: page.id,
    title: <TextLink href={`/pages/${page.id}`}>{page.title}</TextLink>,
    tags:
      page.tags.length === 0 ? null : (
        <span className="flex flex-wrap gap-1">
          {page.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </span>
      ),
    updated: formatDateTime(page.updatedAt),
    updatedBy: page.updatedBy,
  }));
  return (
    <Table<Row>
      caption={caption}
      rows={rows}
      columns={[
        { field: 'title', header: 'Title' },
        { field: 'tags', header: 'Tags', hideBelow: 'sm' },
        { field: 'updated', header: 'Updated', hideBelow: 'md' },
        { field: 'updatedBy', header: 'By', hideBelow: 'lg' },
      ]}
      error={
        failed === false
          ? undefined
          : failed === true
            ? { title: 'Pages could not be loaded', description: 'The database did not respond. Reload the page.' }
            : failed
      }
      empty={{
        ...empty,
        action: (
          <LinkButton href="/" size="sm">
            All pages
          </LinkButton>
        ),
      }}
    />
  );
}
