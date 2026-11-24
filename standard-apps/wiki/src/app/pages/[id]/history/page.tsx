import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState } from '@openapps/ui';
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
    console.error('[wiki] Verlauf:', error);
    failed = true;
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <TextLink href={`/pages/${parsedId.data}`}>← Zur Seite</TextLink>
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Verlauf</p>
        <h1 className="mt-0.5 text-2xl font-semibold text-fg [overflow-wrap:anywhere]">
          {failed ? 'Verlauf' : title}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          Jede Änderung, von Menschen wie von Agents, mit dem Stand danach.
        </p>
      </header>

      {failed ? (
        <ErrorState
          title="Verlauf konnte nicht geladen werden"
          description="Die Datenbank hat nicht geantwortet. Lade die Seite neu."
        />
      ) : revisions.length === 0 ? (
        <EmptyState
          title="Noch keine Einträge im Verlauf"
          description="Sobald die Seite bearbeitet wird, steht hier jede Änderung."
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
                  description={`von ${revision.editedBy}`}
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
                      Inhalt dieses Stands anzeigen
                    </summary>
                    <div className="mt-3 border-t border-border pt-3">
                      {revision.contentMd.trim() === '' ? (
                        <p className="text-sm text-fg-muted">Kein Inhalt.</p>
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
    </main>
  );
}
