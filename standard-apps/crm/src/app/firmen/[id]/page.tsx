import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { Badge, DetailPattern, EmptyState, ErrorState, Table, Tabs } from '@openapps/ui';
import { ButtonLink, TextLink } from '@/components/links';
import { getCompany, type Activity, type CompanyDetail, type Contact, type Deal } from '@/lib/crm';
import { ACTIVITY_KIND_LABELS, STAGE_LABELS } from '@/lib/domain';
import { formatDate, formatDateTime, formatDay, formatEuro } from '@/lib/format';
import { uuid } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

/** Firmen-Detail. Dieselben Daten liefert das Tool `companies.get`. */

interface ContactRow {
  id: string;
  name: string;
  role: string;
  email: ReactNode;
  phone: string;
}

const toContactRow = (contact: Contact): ContactRow => ({
  id: contact.id,
  name: contact.name,
  role: contact.role ?? '',
  email:
    contact.email === null ? '' : (
      <a href={`mailto:${contact.email}`} className="text-primary underline-offset-2 hover:underline">
        {contact.email}
      </a>
    ),
  phone: contact.phone ?? '',
});

interface DealRow {
  id: string;
  title: string;
  stage: ReactNode;
  wert: string;
  abschluss: string;
}

const toDealRow = (deal: Deal): DealRow => ({
  id: deal.id,
  title: deal.title,
  stage: <Badge>{STAGE_LABELS[deal.stage]}</Badge>,
  wert: formatEuro(deal.valueCents),
  abschluss: formatDate(deal.expectedClose),
});

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = uuid.safeParse(id);
  if (!parsed.success) notFound();

  let detail: CompanyDetail | null = null;
  try {
    detail = await getCompany(parsed.data);
  } catch (error) {
    if (error instanceof ToolNotFoundError) notFound();
    console.error('[crm] Firma laden:', error);
  }

  if (detail === null) {
    return (
      <>
        <TextLink href="/firmen">← Alle Firmen</TextLink>
        <ErrorState
          title="Firma konnte nicht geladen werden"
          description="Die Datenbank hat nicht geantwortet. Lade die Seite neu."
        />
      </>
    );
  }

  const { company, contacts, deals, activities } = detail;
  const openDeals = deals.filter((deal) => deal.stage !== 'gewonnen' && deal.stage !== 'verloren');

  return (
    <>
      <TextLink href="/firmen" className="self-start text-sm">
        ← Alle Firmen
      </TextLink>
      <DetailPattern
        eyebrow="Firma"
        title={company.name}
        meta={
          <>
            {company.branche === null ? null : <Badge>{company.branche}</Badge>}
            <Badge tone="primary">{`${openDeals.length} offene Deals`}</Badge>
          </>
        }
        actions={
          <>
            <ButtonLink href={`/aktivitaeten/neu?firma=${company.id}`} variant="secondary">
              Aktivität erfassen
            </ButtonLink>
            <ButtonLink href={`/kontakte/neu?firma=${company.id}`} variant="secondary">
              Neuer Kontakt
            </ButtonLink>
            <ButtonLink href={`/deals/neu?firma=${company.id}`}>Neuer Deal</ButtonLink>
          </>
        }
        sections={[
          {
            title: 'Stammdaten',
            fields: [
              {
                label: 'Website',
                value:
                  company.website === null ? '–' : (
                    <a
                      href={company.website}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {company.website}
                    </a>
                  ),
              },
              { label: 'Branche', value: company.branche ?? '–' },
              { label: 'Angelegt', value: formatDay(company.createdAt) },
              { label: 'Geändert', value: formatDay(company.updatedAt) },
              { label: 'Notizen', value: company.notes ?? '–', wide: true },
            ],
          },
        ]}
      >
        <Tabs
          label="Bereiche der Firma"
          items={[
            {
              id: 'kontakte',
              label: 'Kontakte',
              count: contacts.length,
              content: (
                <Table<ContactRow>
                  caption={`Kontakte von ${company.name}`}
                  rows={contacts.map(toContactRow)}
                  columns={[
                    { field: 'name', header: 'Name' },
                    { field: 'role', header: 'Rolle', hideBelow: 'sm' },
                    { field: 'email', header: 'E-Mail', hideBelow: 'md' },
                    { field: 'phone', header: 'Telefon', hideBelow: 'lg' },
                  ]}
                  empty={{
                    title: 'Noch keine Kontakte',
                    description: 'Lege einen Kontakt für diese Firma an.',
                  }}
                />
              ),
            },
            {
              id: 'deals',
              label: 'Deals',
              count: deals.length,
              content: (
                <Table<DealRow>
                  caption={`Deals von ${company.name}`}
                  rows={deals.map(toDealRow)}
                  columns={[
                    { field: 'title', header: 'Titel' },
                    { field: 'stage', header: 'Stage' },
                    { field: 'wert', header: 'Wert', align: 'right' },
                    { field: 'abschluss', header: 'Abschluss', hideBelow: 'sm' },
                  ]}
                  empty={{
                    title: 'Noch keine Deals',
                    description: 'Lege einen Deal für diese Firma an.',
                  }}
                />
              ),
            },
            {
              id: 'aktivitaeten',
              label: 'Aktivitäten',
              count: activities.length,
              content: <ActivityList activities={activities} />,
            },
          ]}
        />
      </DetailPattern>
    </>
  );
}

function ActivityList({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <EmptyState
        title="Noch keine Aktivitäten"
        description="Erfasse eine Notiz, einen Anruf, eine Mail oder einen Termin."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {activities.map((activity) => (
        <li key={activity.id} className="min-w-0 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{ACTIVITY_KIND_LABELS[activity.kind]}</Badge>
            <span className="text-sm font-medium text-fg [overflow-wrap:anywhere]">
              {activity.subject}
            </span>
          </div>
          {activity.body === null ? null : (
            <p className="mt-2 whitespace-pre-line text-sm text-fg [overflow-wrap:anywhere]">
              {activity.body}
            </p>
          )}
          <p className="mt-2 text-xs text-fg-muted [overflow-wrap:anywhere]">
            {[
              formatDateTime(activity.happenedAt),
              activity.contactName,
              activity.dealTitle,
              `erfasst von ${activity.createdBy}`,
            ]
              .filter((part): part is string => part !== null && part !== '')
              .join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  );
}
