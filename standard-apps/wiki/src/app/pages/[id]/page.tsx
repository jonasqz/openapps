import { notFound } from 'next/navigation';
import { Badge, Card, CardBody, CardHeader, DetailPattern, EmptyState, ErrorState } from '@openapps/ui';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Markdown } from '@/components/Markdown';
import { PageTree } from '@/components/PageTree';
import { LinkButton, TextLink } from '@/components/LinkButton';
import { pageLinkMarkdown } from '@/lib/editing';
import { formatDateTime } from '@/lib/format';
import { loadPage } from '@/lib/load';
import { isFavorite, pageTree, type PageTree as Tree } from '@/lib/pages';
import { flattenTree } from '@/lib/tree';
import { viewerId } from '@/lib/viewer';
import { ArchiveButton } from '../../ArchiveButton';
import { FavoriteButton } from '../../FavoriteButton';
import { MoveButton } from '../../MoveButton';

/**
 * Eine Seite: Pfad, Inhalt, Unterseiten, Rueckverweise, daneben der
 * Seitenbaum. Liest wie die Tools `pages.get` und `pages.tree`.
 */
export const dynamic = 'force-dynamic';

export default async function PageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await loadPage(id);
  if (loaded.kind === 'missing') notFound();

  if (loaded.kind === 'failed') {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <TextLink href="/">← All pages</TextLink>
        <ErrorState
          title="Page could not be loaded"
          description="The database did not respond. Reload the page."
        />
      </div>
    );
  }

  const page = loaded.value;
  const archived = page.archivedAt !== null;

  // Baum und Favorit sind Beiwerk: Scheitern sie, bleibt die Seite lesbar.
  const viewer = await viewerId();
  const [treeResult, favoriteResult] = await Promise.allSettled([
    pageTree({}),
    viewer === undefined ? Promise.resolve(false) : isFavorite(viewer, page.id),
  ]);
  const tree: Tree | undefined = treeResult.status === 'fulfilled' ? treeResult.value : undefined;
  if (treeResult.status === 'rejected') console.error('[wiki] page tree:', treeResult.reason);
  const favorite = favoriteResult.status === 'fulfilled' ? favoriteResult.value : undefined;
  if (favoriteResult.status === 'rejected') console.error('[wiki] favorite:', favoriteResult.reason);

  return (
    <div className="flex min-w-0 flex-col gap-8 lg:flex-row lg:items-start">
      <aside className="order-last min-w-0 border-t border-border pt-6 lg:order-first lg:sticky lg:top-6 lg:w-nav lg:shrink-0 lg:border-r lg:border-t-0 lg:pr-4 lg:pt-0">
        <p className="mb-2 font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">Pages</p>
        <PageTree
          nodes={tree?.tree ?? []}
          currentId={page.id}
          openIds={page.path.map((ref) => ref.id)}
          failed={tree === undefined}
          truncated={tree?.truncated ?? false}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Breadcrumbs path={page.path} current={{ id: page.id, title: page.title }} />
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
                {tree === undefined ? null : (
                  <MoveButton
                    id={page.id}
                    title={page.title}
                    parentId={page.parentId}
                    targets={flattenTree(tree.tree, page.id)}
                  />
                )}
                {favorite === undefined || viewer === undefined ? null : (
                  <FavoriteButton id={page.id} favorite={favorite} />
                )}
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
            <CardHeader as="h2" title="Linked from" />
            <CardBody>
              {page.backlinks.length === 0 ? (
                <EmptyState
                  title="No other page links here yet"
                  description="Link to this page from another one with the link syntax below."
                />
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {page.backlinks.map((ref) => (
                    <li key={ref.id}>
                      <TextLink href={`/pages/${ref.id}`}>{ref.title}</TextLink>
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
                <div className="min-w-0 sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Link to this page
                  </dt>
                  <dd className="mt-1 min-w-0">
                    <code className="block rounded-sm bg-surface-muted px-2 py-1 font-mono text-xs text-fg [overflow-wrap:anywhere]">
                      {pageLinkMarkdown(page)}
                    </code>
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </DetailPattern>
      </div>
    </div>
  );
}
