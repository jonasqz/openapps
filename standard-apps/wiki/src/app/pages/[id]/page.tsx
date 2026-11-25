import { notFound } from 'next/navigation';
import { Badge, Card, CardBody, CardHeader, DetailPattern, EmptyState, ErrorState } from '@openapps/ui';
import { Markdown } from '@/components/Markdown';
import { LinkButton, TextLink } from '@/components/LinkButton';
import { formatDateTime } from '@/lib/format';
import { loadPage } from '@/lib/load';
import { ArchiveButton } from '../../ArchiveButton';

/** Eine Seite: Inhalt, Metadaten, Unterseiten. Liest wie das Tool `pages.get`. */
export const dynamic = 'force-dynamic';

export default async function PageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPage(id);
  if (loaded.kind === 'missing') notFound();

  if (loaded.kind === 'failed') {
    return (
      <main className="flex flex-col gap-4 p-6">
        <TextLink href="/">← All pages</TextLink>
        <ErrorState
          title="Page could not be loaded"
          description="The database did not respond. Reload the page."
        />
      </main>
    );
  }

  const page = loaded.value;
  const archived = page.archivedAt !== null;

  return (
    <main className="flex flex-col gap-4 p-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-2 text-sm">
        <TextLink href="/">← All pages</TextLink>
        {page.parent === null ? null : (
          <>
            <span aria-hidden="true" className="text-fg-subtle">
              /
            </span>
            <TextLink href={`/pages/${page.parent.id}`}>{page.parent.title}</TextLink>
          </>
        )}
      </nav>
      <DetailPattern
        title={page.title}
        meta={
          <>
            {archived ? (
              <Badge tone="warning" srPrefix="Status: ">
                Archived
              </Badge>
            ) : null}
            {page.tags.map((tag) => (
              <Badge key={tag} srPrefix="Tag: ">
                {tag}
              </Badge>
            ))}
          </>
        }
        actions={
          archived ? (
            <LinkButton href={`/pages/${page.id}/history`}>History</LinkButton>
          ) : (
            <>
              <LinkButton href={`/pages/${page.id}/edit`} variant="primary">
                Edit
              </LinkButton>
              <LinkButton href={`/new?parent=${page.id}`}>Subpage</LinkButton>
              <LinkButton href={`/pages/${page.id}/history`}>History</LinkButton>
              <ArchiveButton id={page.id} title={page.title} />
            </>
          )
        }
        sections={[]}
      >
        <Card>
          <CardBody>
            {page.contentMd.trim() === '' ? (
              <EmptyState
                title="This page has no content yet"
                description="Add text with “Edit” or the pages.update tool."
              />
            ) : (
              <Markdown source={page.contentMd} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader as="h2" title="Subpages" />
          <CardBody>
            {page.children.length === 0 ? (
              <EmptyState
                title="No subpages"
                {...(archived ? {} : { description: 'Create one with “Subpage”.' })}
              />
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {page.children.map((child) => (
                  <li key={child.id}>
                    <TextLink href={`/pages/${child.id}`}>{child.title}</TextLink>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader as="h2" title="Details" />
          <CardBody>
            <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">Updated</dt>
                <dd className="mt-1 text-fg">
                  {formatDateTime(page.updatedAt)} by {page.updatedBy}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">Created</dt>
                <dd className="mt-1 text-fg">
                  {formatDateTime(page.createdAt)} by {page.createdBy}
                </dd>
              </div>
              {page.archivedAt === null ? null : (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Archived
                  </dt>
                  <dd className="mt-1 text-fg">{formatDateTime(page.archivedAt)}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>
      </DetailPattern>
    </main>
  );
}
