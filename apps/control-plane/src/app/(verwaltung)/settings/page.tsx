/**
 * Settings der Person (ADR 0017). Nur Anzeige: Was hier steht, liefern
 * genauso `GET /api/me` und das MCP-Tool `whoami` — beide aus
 * `describeActor`. Aendern laesst sich hier nichts, was es nicht schon als
 * Tool gibt; die Seite verweist nur dorthin.
 */

import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Table,
  type TableColumn,
} from '@openapps/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { JSX, ReactNode } from 'react';
import { describeActor, type ActorDescription, type ActorGrant } from '../../../domain';
import { currentUser } from '../../../lib/actor';
import { domainContext } from '../../../lib/runtime';
import { actorFromSession } from '../../../lib/session';
import { PageHeader } from '../page-header';

export const dynamic = 'force-dynamic';

const LINK = 'text-sm font-medium text-primary underline underline-offset-4';

/** `Table` ist eine Client-Komponente: Spalten nennen ein Feld, keine Funktion. */
interface GrantRow {
  id: string;
  verb: string;
  resource: string;
  via: string;
  grantedBy: string;
}

const GRANT_COLUMNS: readonly TableColumn<GrantRow>[] = [
  { field: 'verb', header: 'Verb' },
  { field: 'resource', header: 'Resource' },
  { field: 'via', header: 'Source' },
  { field: 'grantedBy', header: 'Granted by', hideBelow: 'md' },
];

// Die Herkunft als Satzteil, damit klar ist, warum ein Recht da ist — und wo
// es zu widerrufen waere.
const toRow = (g: ActorGrant): GrantRow => ({
  id: g.id,
  verb: g.verb,
  resource: `${g.resource.kind}:${g.resource.id}`,
  via: g.via.kind === 'group' ? `via group ${g.via.group}` : 'Direct',
  grantedBy: g.grantedBy,
});

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card>
      <CardHeader title={title} {...(description === undefined ? {} : { description })} />
      <CardBody className="flex flex-col gap-3">{children}</CardBody>
    </Card>
  );
}

function AppList({
  me,
  failure,
}: {
  me: ActorDescription | undefined;
  failure: string | undefined;
}): JSX.Element {
  if (failure !== undefined || me === undefined) {
    return (
      <ErrorState title="Your apps could not be loaded" description={failure ?? 'unknown error'} />
    );
  }
  if (me.apps.length === 0) {
    return (
      <EmptyState
        title="No apps yet"
        description="You see an app here once someone grants you read access to it."
      />
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {me.apps.map((app) => (
        <li key={app.name} className="flex items-center justify-between gap-3 py-2">
          <a href={app.href} className={LINK}>
            {app.title}
          </a>
          {app.category === null || app.category === undefined ? null : (
            <Badge>{app.category}</Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

export default async function SettingsPage(): Promise<JSX.Element> {
  const request = new Request('http://control-plane/settings', { headers: await headers() });

  // Ohne Session: Login, nicht Fehlerzustand.
  const user = await currentUser(request);
  if (user === null) redirect('/login?next=%2Fsettings');

  let me: ActorDescription | undefined;
  let failure: string | undefined;
  try {
    me = await describeActor(domainContext(), actorFromSession(user), { email: user.email });
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unknown error';
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Who you are on the platform and what you may do. Agents get the same view with the MCP tool whoami or GET /api/me."
      />

      <Section title="Profile" description="Your name and email come from your Google sign-in.">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-fg-muted">Email</dt>
          <dd className="text-fg [overflow-wrap:anywhere]">{user.email}</dd>
          <dt className="text-fg-muted">Groups</dt>
          <dd className="flex flex-wrap gap-1.5">
            {user.groups.length === 0 ? (
              <span className="text-fg-muted">No groups</span>
            ) : (
              user.groups.map((group) => <Badge key={group}>{group}</Badge>)
            )}
          </dd>
        </dl>
      </Section>

      <Section title="Your apps" description="The apps you may open.">
        <AppList me={me} failure={failure} />
      </Section>

      <Section
        title="Your access"
        description="Everything you may do: grants made directly to you and grants to your groups. The same right can appear more than once if it comes from several places."
      >
        <Table
          caption="Your grants"
          columns={GRANT_COLUMNS}
          rows={(me?.grants ?? []).map(toRow)}
          {...(failure === undefined
            ? {}
            : { error: { title: 'Your grants could not be loaded', description: failure } })}
          empty={{
            title: 'You have no grants',
            description:
              'Without a grant, everything is locked. That is the intended starting point.',
          }}
        />
      </Section>

      <Section title="Your agents">
        <p className="text-sm text-fg-muted">
          Agents act with their own identity and only do what they have been granted.
        </p>
        <a href="/agents" className={LINK}>
          Manage agents
        </a>
      </Section>

      <Section title="Appearance">
        <p className="text-sm text-fg-muted">
          Switch between light and dark theme from the user menu in the sidebar.
        </p>
      </Section>

      {me?.isAdmin === true ? (
        <Section title="Administration" description="You are a member of platform-admins.">
          <ul className="flex flex-col gap-2">
            <li>
              <a href="/grants" className={LINK}>
                Grants
              </a>
            </li>
            <li>
              <a href="/agents" className={LINK}>
                Agents
              </a>
            </li>
          </ul>
        </Section>
      ) : null}

      <Section title="Sign out">
        <p className="text-sm text-fg-muted">Ends your session on this platform.</p>
        <a href="/sign-out" className={LINK}>
          Sign out
        </a>
      </Section>
    </section>
  );
}
