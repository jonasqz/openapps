import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader } from '@openapps/ui';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Markdown } from '@/components/Markdown';
import { TextLink } from '@/components/LinkButton';
import { CHANGE_LABEL, formatDateTime } from '@/lib/format';
import { getPage, pageHistory, pageTitles, type Page, type Revision } from '@/lib/pages';
import { LIMITS, PageId } from '@/lib/schemas';
import { RestoreButton } from '../../../RestoreButton';

/**
 * Verlauf einer Seite, neueste Aenderung zuerst. Liest wie das Tool
 * `pages.history`; „Restore this version“ ruft dieselbe Funktion wie
 * `pages.restore`.
 */
export const dynamic = 'force-dynamic';

const CHANGE_TONE = {
  create: 'success',
  update: 'primary',
  move: 'neutral',
  restore: 'primary',
  archive: 'warning',
} as const;

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = PageId.safeParse(id);
  if (!parsedId.success) notFound();

  let page: Page | undefined;
  let revisions: Revision[] = [];
  let parents = new Map<string, string>();
  let failed = false;
  try {
    const [loadedPage, history] = await Promise.all([
      getPage({ id: parsedId.data }),
      pageHistory({ id: parsedId.data, limit: LIMITS.historyLimitMax }),
    ]);
    page = loadedPage;
    revisions = history.revisions;
    const moved = revisions
      .filter((revision) => revision.change === 'move' && revision.parentId !== null)
      .map((revision) => revision.parentId ?? '');
    parents = await pageTitles([...new Set(moved)]);
  } catch (error) {
    if (error instanceof ToolNotFoundError) notFound();
    console.error('[wiki] history:', error);
    failed = true;
  }

  const canRestore = page !== undefined && page.archivedAt === null;

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      {page === undefined ? (
        <TextLink href={`/pages/${parsedId.data}`}>← Back to page</TextLink>
      ) : (
        <Breadcrumbs path={page.path} current={{ id: page.id, title: page.title, href: true }} />
      )}
      <PageHeader
        className="mb-0"
        eyebrow="History"
        title={page?.title ?? 'History'}
        description="Every change, by humans and agents alike, with the state after it. Restoring an earlier version adds a new entry; nothing is lost."
      />

      {failed ? (
        <ErrorState
          title="History could not be loaded"
          description="The database did not respond. Reload the page."
        />
      ) : revisions.length === 0 ? (
        <EmptyState
          title="No history entries yet"
          description="Once the page is edited, every change shows up here."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {revisions.map((revision, index) => (
            <li key={revision.id}>
              <Card>
                <CardHeader
                  as="h2"
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={CHANGE_TONE[revision.change]}>{CHANGE_LABEL[revision.change]}</Badge>
                      <span>{formatDateTime(revision.editedAt)}</span>
                      {index === 0 ? <Badge>Current</Badge> : null}
                    </span>
                  }
                  description={`by ${revision.editedBy}`}
                  {...(canRestore && index > 0
                    ? {
                        actions: (
                          <RestoreButton
                            id={parsedId.data}
                            revisionId={revision.id}
                            when={formatDateTime(revision.editedAt)}
                          />
                        ),
                      }
                    : {})}
                />
                <CardBody>
                  <p className="text-sm font-semibold text-fg">{revision.title}</p>
                  {revision.change === 'move' ? (
                    <p className="mt-1 text-sm text-fg-muted">
                      {revision.parentId === null ? (
                        'Moved to the top level.'
                      ) : (
                        <>
                          Moved under{' '}
                          <TextLink href={`/pages/${revision.parentId}`}>
                            {parents.get(revision.parentId) ?? 'another page'}
                          </TextLink>
                          .
                        </>
                      )}
                    </p>
                  ) : null}
                  {revision.tags.length === 0 ? null : (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {revision.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </p>
                  )}
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-medium text-primary">
                      Show content of this version
                    </summary>
                    <div className="mt-3 border-t border-border pt-3">
                      {revision.contentMd.trim() === '' ? (
                        <p className="text-sm text-fg-muted">No content.</p>
                      ) : (
                        <Markdown source={revision.contentMd} />
                      )}
                    </div>
                  </details>
                </CardBody>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
