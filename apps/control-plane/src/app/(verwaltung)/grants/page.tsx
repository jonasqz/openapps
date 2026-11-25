/**
 * Die Freigaben. Eine Liste, kein Formular: vergeben und widerrufen passiert
 * über `grant` und `revoke` im Plattform-MCP bzw. unter `/api/grants`.
 * Die Seite macht sichtbar, was gilt — und wer es vergeben hat.
 */

import { Table, type TableColumn } from '@openapps/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { can, listGrants } from '../../../domain';
import type { Grant } from '../../../domain/types';
import { currentActorOrNull } from '../../../lib/actor';
import { domainContext } from '../../../lib/runtime';
import { PageHeader } from '../page-header';

export const dynamic = 'force-dynamic';

/**
 * Die Seite rendert auf dem Server, `Table` ist eine Client-Komponente: Eine
 * Spalte nennt deshalb ihr `field` und keine `cell`. Subjekt, Ressource und
 * Stand sind abgeleitet — sie werden hier ausgerechnet und stehen als Feld in
 * der Zeile, statt als Funktion über die Grenze zu gehen.
 */
interface GrantRow {
  id: string;
  subject: string;
  verb: string;
  resource: string;
  grantedBy: string;
  state: string;
}

const COLUMNS: readonly TableColumn<GrantRow>[] = [
  { field: 'subject', header: 'Subject' },
  { field: 'verb', header: 'Verb' },
  { field: 'resource', header: 'Resource' },
  { field: 'grantedBy', header: 'Granted by', hideBelow: 'md' },
  { field: 'state', header: 'State' },
];

const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });

const toRow = (g: Grant): GrantRow => ({
  id: g.id,
  subject: `${g.subject.kind}:${g.subject.id}`,
  verb: g.verb,
  resource: `${g.resource.kind}:${g.resource.id}`,
  grantedBy: g.grantedBy,
  state: g.revokedAt === null ? 'active' : `revoked on ${DAY.format(g.revokedAt)}`,
});

export default async function GrantsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/grants', { headers: requestHeaders });

  // Ohne Session: Login, nicht Fehlerzustand.
  const actor = await currentActorOrNull(request);
  if (actor === null) redirect('/login?next=%2Fgrants');

  // Wer alle Freigaben lesen darf (read auf app:*), sieht alle; jeder andere
  // seine eigenen. Wie `list_grants` im MCP und `GET /api/grants`.
  let grants: readonly Grant[] = [];
  let all = false;
  let failure: string | undefined;
  try {
    const ctx = domainContext();
    all = await can(ctx, actor, 'read', { kind: 'app', id: '*' });
    grants = await listGrants(
      ctx,
      all ? { actor } : { actor, subject: { kind: actor.kind, id: actor.id } },
    );
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unknown error';
  }

  return (
    <section>
      <PageHeader
        title="Grants"
        description={
          all
            ? 'Who may do what on which resource. Granting and revoking go through grant and revoke in the platform MCP.'
            : 'Your own grants. Only someone with read access to all apps sees every grant.'
        }
      />
      <Table
        caption={all ? 'All grants' : 'Your grants'}
        columns={COLUMNS}
        rows={grants.map(toRow)}
        searchable
        {...(failure === undefined
          ? {}
          : { error: { title: 'Grants could not be loaded', description: failure } })}
        empty={{
          title: all ? 'No grants yet' : 'You have no grants yet',
          description:
            'Without a grant, everything is locked. That is the intended starting point.',
        }}
      />
    </section>
  );
}
