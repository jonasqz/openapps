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
        <TextLink href="/">← Alle Seiten</TextLink>
        <ErrorState
          title="Seite konnte nicht geladen werden"
          description="Die Datenbank hat nicht geantwortet. Lade die Seite neu."
        />
      </main>
    );
  }

  const page = loaded.value;
  const archived = page.archivedAt !== null;

  return (
    <main className="flex flex-col gap-4 p-6">
      <nav aria-label="Pfad" className="flex flex-wrap gap-2 text-sm">
        <TextLink href="/">← Alle Seiten</TextLink>
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
                Archiviert
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
            <LinkButton href={`/pages/${page.id}/history`}>Verlauf</LinkButton>
          ) : (
            <>
              <LinkButton href={`/pages/${page.id}/edit`} variant="primary">
                Bearbeiten
              </LinkButton>
              <LinkButton href={`/new?parent=${page.id}`}>Unterseite</LinkButton>
              <LinkButton href={`/pages/${page.id}/history`}>Verlauf</LinkButton>
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
                title="Diese Seite hat noch keinen Inhalt"
                description="Über „Bearbeiten“ oder das Tool pages.update kommt Text hinein."
              />
            ) : (
              <Markdown source={page.contentMd} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader as="h2" title="Unterseiten" />
          <CardBody>
            {page.children.length === 0 ? (
              <EmptyState
                title="Keine Unterseiten"
                {...(archived ? {} : { description: 'Lege mit „Unterseite“ eine an.' })}
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
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">Geändert</dt>
                <dd className="mt-1 text-fg">
                  {formatDateTime(page.updatedAt)} von {page.updatedBy}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">Angelegt</dt>
                <dd className="mt-1 text-fg">
                  {formatDateTime(page.createdAt)} von {page.createdBy}
                </dd>
              </div>
              {page.archivedAt === null ? null : (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Archiviert
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
