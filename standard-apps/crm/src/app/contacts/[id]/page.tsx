import { notFound } from 'next/navigation';
import { ToolNotFoundError } from '@openapps/sdk';
import { Badge, Card, CardBody, CardHeader, ErrorState, PageHeader, Tabs } from '@openapps/ui';
import { AppLinks } from '@/components/AppLinks';
import { DealSummaryTable } from '@/components/DealSummaryTable';
import { ButtonLink, TextLink } from '@/components/links';
import { NextStepList } from '@/components/NextStepList';
import { Properties } from '@/components/Properties';
import { Timeline } from '@/components/Timeline';
import { getContact, type ContactDetail } from '@/lib/crm';
import { formatDay } from '@/lib/format';
import { uuid } from '@/lib/schemas';
import { nextStepView } from '@/lib/views';

export const dynamic = 'force-dynamic';

/** Ein Kontakt mit Deals, naechsten Schritten und Zeitleiste. Tool: `contacts.get`. */
export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = uuid.safeParse((await params).id);
  if (!parsed.success) notFound();

  let detail: ContactDetail | null = null;
  try {
    detail = await getContact(parsed.data);
  } catch (error) {
    if (error instanceof ToolNotFoundError) notFound();
    console.error('[crm] load contact:', error);
  }

  if (detail === null) {
    return (
      <AppLinks>
        <PageHeader breadcrumbs={[{ label: 'Contacts', href: '/contacts' }, { label: 'Contact' }]} title="Contact" />
        <ErrorState title="Contact could not be loaded" description="The database did not respond. Reload the page." />
      </AppLinks>
    );
  }

  const { contact, deals, activities, nextSteps } = detail;
  const refs = `contact=${contact.id}${contact.companyId === null ? '' : `&company=${contact.companyId}`}`;
  const openDeals = deals.filter((deal) => deal.stage !== 'won' && deal.stage !== 'lost');

  return (
    <AppLinks>
      <PageHeader
        breadcrumbs={[
          { label: 'Contacts', href: '/contacts' },
          ...(contact.companyId === null || contact.companyName === null
            ? []
            : [{ label: contact.companyName, href: `/companies/${contact.companyId}` }]),
          { label: contact.name },
        ]}
        title={contact.name}
        meta={
          <>
            {contact.role === null ? null : <Badge>{contact.role}</Badge>}
            <Badge tone="primary">{`${openDeals.length} open ${openDeals.length === 1 ? 'deal' : 'deals'}`}</Badge>
          </>
        }
        actions={
          <>
            <ButtonLink href={`/activities/new?${refs}`} variant="secondary">
              Log activity
            </ButtonLink>
            {contact.companyId === null ? null : (
              <ButtonLink href={`/deals/new?company=${contact.companyId}`} variant="secondary">
                New deal
              </ButtonLink>
            )}
            <ButtonLink href={`/next-steps/new?${refs}`}>Add next step</ButtonLink>
          </>
        }
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <Tabs
            label="Contact sections"
            items={[
              {
                id: 'timeline',
                label: 'Timeline',
                count: activities.length,
                content: (
                  <Timeline
                    activities={activities}
                    hide={['contact']}
                    emptyAction={<TextLink href={`/activities/new?${refs}`}>Log activity</TextLink>}
                  />
                ),
              },
              {
                id: 'deals',
                label: 'Deals',
                count: deals.length,
                content: <DealSummaryTable caption={`Deals with ${contact.name}`} deals={deals} />,
              },
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader as="h2" title="Next steps" />
            <CardBody>
              <NextStepList
                steps={nextSteps.map((step) => nextStepView(step, 'contact'))}
                addHref={`/next-steps/new?${refs}`}
              />
            </CardBody>
          </Card>
          <Properties
            title="Details"
            items={[
              {
                label: 'Company',
                value:
                  contact.companyId === null ? null : (
                    <TextLink href={`/companies/${contact.companyId}`}>{contact.companyName ?? contact.companyId}</TextLink>
                  ),
              },
              { label: 'Role', value: contact.role },
              {
                label: 'Email',
                value:
                  contact.email === null ? null : (
                    <a href={`mailto:${contact.email}`} className="text-primary underline-offset-2 hover:underline">
                      {contact.email}
                    </a>
                  ),
              },
              {
                label: 'Phone',
                value:
                  contact.phone === null ? null : (
                    <a href={`tel:${contact.phone.replace(/[^+0-9]/g, '')}`} className="text-primary underline-offset-2 hover:underline">
                      {contact.phone}
                    </a>
                  ),
              },
              { label: 'Created', value: formatDay(contact.createdAt) },
              { label: 'Updated', value: formatDay(contact.updatedAt) },
            ]}
          />
        </div>
      </div>
    </AppLinks>
  );
}
