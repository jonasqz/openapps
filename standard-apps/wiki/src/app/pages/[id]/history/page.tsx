import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader } from '@openapps/ui';
import { Markdown } from '@/components/Markdown';
import { TextLink } from '@/components/LinkButton';
import { CHANGE_LABEL, formatDateTime } from '@/lib/format';
import { pageHistory, type Revision } from '@/lib/pages';
import { LIMITS, PageId } from '@/lib/schemas';

/** Verlauf einer Seite, neueste Änderung zuerst. Liest wie das Tool `pages.history`. */
export const dynamic = 'force-dynamic';

const CHANGE_TONE = { create: 'success', update: 'primary', archive: 'warning' } as const;

export default async function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = PageId.safeParse(id);
  if (!parsedId.success) notFound();

  let title = '';
  let revisions: Revision[] = [];
  let failed = false;
  try {
    const history = await pageHistory({ id: parsedId.data, limit: LIMITS.historyLimitMax });
    title = history.title;
    revisions = history.revisions;
  } catch (error) {
    if (error instanceof ToolNotFoundError) notFound();
    console.error('[wiki] history:', error);
    failed = true;
  }

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4">
      <TextLink href={`/pages/${parsedId.data}`}>← Back to page</TextLink>
      <PageHeader
        className="mb-0"
        eyebrow="History"
        title={failed ? 'History' : title}
        description="Every change, by humans and agents alike, with the state after it."
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
          {revisions.map((revision) => (
            <li key={revision.id}>
              <Card>
                <CardHeader
                  as="h2"
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={CHANGE_TONE[revision.change]}>{CHANGE_LABEL[revision.change]}</Badge>
                      <span>{formatDateTime(revision.editedAt)}</span>
                    </span>
                  }
                  description={`by ${revision.editedBy}`}
                />
                <CardBody>
                  <p className="text-sm font-semibold text-fg">{revision.title}</p>
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
