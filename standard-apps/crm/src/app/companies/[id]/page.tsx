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
    console.error('[crm] load company:', error);
  }

  if (detail === null) {
    return (
      <>
        <TextLink href="/companies">← All companies</TextLink>
        <ErrorState
          title="Company could not be loaded"
          description="The database did not respond. Reload the page."
        />
      </>
    );
  }

  const { company, contacts, deals, activities } = detail;
  const openDeals = deals.filter((deal) => deal.stage !== 'won' && deal.stage !== 'lost');

  return (
    <>
      <TextLink href="/companies" className="self-start text-sm">
        ← All companies
      </TextLink>
      <DetailPattern
        eyebrow="Company"
        title={company.name}
        meta={
          <>
            {company.industry === null ? null : <Badge>{company.industry}</Badge>}
            <Badge tone="primary">{`${openDeals.length} open ${openDeals.length === 1 ? 'deal' : 'deals'}`}</Badge>
          </>
        }
        actions={
          <>
            <ButtonLink href={`/activities/new?company=${company.id}`} variant="secondary">
              Log activity
            </ButtonLink>
            <ButtonLink href={`/contacts/new?company=${company.id}`} variant="secondary">
              New contact
            </ButtonLink>
            <ButtonLink href={`/deals/new?company=${company.id}`}>New deal</ButtonLink>
          </>
        }
        sections={[
          {
            title: 'Details',
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
              { label: 'Industry', value: company.industry ?? '–' },
              { label: 'Created', value: formatDay(company.createdAt) },
              { label: 'Updated', value: formatDay(company.updatedAt) },
              { label: 'Notes', value: company.notes ?? '–', wide: true },
            ],
          },
        ]}
      >
        <Tabs
          label="Company sections"
          items={[
            {
              id: 'contacts',
              label: 'Contacts',
              count: contacts.length,
              content: (
                <Table<ContactRow>
                  caption={`Contacts at ${company.name}`}
                  rows={contacts.map(toContactRow)}
                  columns={[
                    { field: 'name', header: 'Name' },
                    { field: 'role', header: 'Role', hideBelow: 'sm' },
                    { field: 'email', header: 'Email', hideBelow: 'md' },
                    { field: 'phone', header: 'Phone', hideBelow: 'lg' },
                  ]}
                  empty={{
                    title: 'No contacts yet',
                    description: 'Create a contact for this company.',
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
                  caption={`Deals with ${company.name}`}
                  rows={deals.map(toDealRow)}
                  columns={[
                    { field: 'title', header: 'Title' },
                    { field: 'stage', header: 'Stage' },
                    { field: 'wert', header: 'Value', align: 'right' },
                    { field: 'abschluss', header: 'Expected close', hideBelow: 'sm' },
                  ]}
                  empty={{
                    title: 'No deals yet',
                    description: 'Create a deal for this company.',
                  }}
                />
              ),
            },
            {
              id: 'activities',
              label: 'Activities',
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
        title="No activities yet"
        description="Log a note, a call, an email or a meeting."
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
              `logged by ${activity.createdBy}`,
            ]
              .filter((part): part is string => part !== null && part !== '')
              .join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  );
}
