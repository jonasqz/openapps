import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { Badge, Card, CardBody, CardHeader, ErrorState, PageHeader, Table, Tabs } from '@openapps/ui';
import { AppLinks } from '@/components/AppLinks';
import { CrmBacklinks } from '@/components/Refs';
import { DealSummaryTable } from '@/components/DealSummaryTable';
import { ButtonLink, TextLink } from '@/components/links';
import { NextStepList } from '@/components/NextStepList';
import { Properties } from '@/components/Properties';
import { Timeline } from '@/components/Timeline';
import { getCompany, type CompanyDetail, type Contact } from '@/lib/crm';
import { isClosedStage } from '@/lib/domain';
import { formatDay, formatEuro } from '@/lib/format';
import { uuid } from '@/lib/schemas';
import { nextStepView } from '@/lib/views';
import { crmRef } from '@/lib/refs';

export const dynamic = 'force-dynamic';

/**
 * Eine Firma mit allem, was dazugehoert: Kontakte, Deals, naechste Schritte
 * und Zeitleiste (auch von ihren Kontakten und Deals). Tool: `companies.get`.
 */

interface ContactRow {
  id: string;
  name: ReactNode;
  role: string;
  email: ReactNode;
  phone: string;
}

const toContactRow = (contact: Contact): ContactRow => ({
  id: contact.id,
  name: <TextLink href={`/contacts/${contact.id}`}>{contact.name}</TextLink>,
  role: contact.role ?? '',
  email:
    contact.email === null ? (
      ''
    ) : (
      <a href={`mailto:${contact.email}`} className="text-primary underline-offset-2 hover:underline">
        {contact.email}
      </a>
    ),
  phone: contact.phone ?? '',
});

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = uuid.safeParse((await params).id);
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
      <AppLinks>
        <PageHeader breadcrumbs={[{ label: 'Companies', href: '/companies' }, { label: 'Company' }]} title="Company" />
        <ErrorState title="Company could not be loaded" description="The database did not respond. Reload the page." />
      </AppLinks>
    );
  }

  const { company, contacts, deals, activities, nextSteps } = detail;
  const openDeals = deals.filter((deal) => !isClosedStage(deal.stage));
  const openValue = openDeals.reduce((sum, deal) => sum + deal.valueCents, 0);
  const refs = `company=${company.id}`;

  return (
    <AppLinks>
      <PageHeader
        breadcrumbs={[{ label: 'Companies', href: '/companies' }, { label: company.name }]}
        title={company.name}
        meta={
          <>
            {company.industry === null ? null : <Badge>{company.industry}</Badge>}
            <Badge tone="primary">{`${openDeals.length} open ${openDeals.length === 1 ? 'deal' : 'deals'} · ${formatEuro(openValue)}`}</Badge>
          </>
        }
        actions={
          <>
            <ButtonLink href={`/activities/new?${refs}`} variant="secondary">
              Log activity
            </ButtonLink>
            <ButtonLink href={`/contacts/new?${refs}`} variant="secondary">
              New contact
            </ButtonLink>
            <ButtonLink href={`/next-steps/new?${refs}`} variant="secondary">
              Add next step
            </ButtonLink>
            <ButtonLink href={`/deals/new?${refs}`}>New deal</ButtonLink>
          </>
        }
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tabs
            label="Company sections"
            items={[
              {
                id: 'timeline',
                label: 'Timeline',
                count: activities.length,
                content: (
                  <Timeline
                    activities={activities}
                    hide={['company']}
                    emptyAction={<TextLink href={`/activities/new?${refs}`}>Log activity</TextLink>}
                  />
                ),
              },
              {
                id: 'deals',
                label: 'Deals',
                count: deals.length,
                content: (
                  <DealSummaryTable
                    caption={`Deals with ${company.name}`}
                    deals={deals}
                    emptyAction={<TextLink href={`/deals/new?${refs}`}>New deal</TextLink>}
                  />
                ),
              },
              {
                id: 'contacts',
                label: 'Contacts',
                count: contacts.length,
                content: <ContactTable caption={`Contacts at ${company.name}`} contacts={contacts} newHref={`/contacts/new?${refs}`} />,
              },
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader as="h2" title="Next steps" description="Open steps here and on its contacts and deals." />
            <CardBody>
              <NextStepList
                steps={nextSteps.map((step) => nextStepView(step, 'company'))}
                addHref={`/next-steps/new?${refs}`}
              />
            </CardBody>
          </Card>
          <Properties
            title="Details"
            items={[
              {
                label: 'Website',
                value:
                  company.website === null ? null : (
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
              { label: 'Industry', value: company.industry },
              { label: 'Notes', value: company.notes === null ? null : <span className="whitespace-pre-line">{company.notes}</span> },
              { label: 'Created', value: formatDay(company.createdAt) },
              { label: 'Updated', value: formatDay(company.updatedAt) },
            ]}
          />
          <Card>
            <CardBody>
              <CrmBacklinks refValue={crmRef('company', company.id)} />
            </CardBody>
          </Card>
        </div>
      </div>
    </AppLinks>
  );
}

function ContactTable({
  caption,
  contacts,
  newHref,
  failed = false,
}: {
  caption: string;
  contacts: readonly Contact[];
  newHref: string;
  failed?: boolean;
}) {
  return (
    <Table<ContactRow>
      caption={caption}
      rows={contacts.map(toContactRow)}
      columns={[
        { field: 'name', header: 'Name' },
        { field: 'role', header: 'Role', hideBelow: 'sm' },
        { field: 'email', header: 'Email', hideBelow: 'md' },
        { field: 'phone', header: 'Phone', hideBelow: 'lg' },
      ]}
      empty={{
        title: 'No contacts yet',
        description: 'Add the people you talk to at this company.',
        action: <TextLink href={newHref}>New contact</TextLink>,
      }}
      error={failed ? { title: 'Contacts could not be loaded', description: 'Reload the page.' } : undefined}
    />
  );
}
