/**
 * Die Freigaben. Eine Liste, kein Formular: vergeben und widerrufen passiert
 * über `grant` und `revoke` im Plattform-MCP bzw. unter `/api/grants`.
 * Die Seite macht sichtbar, was gilt — und wer es vergeben hat.
 */

import { Table, type TableColumn } from '@openapps/ui';
import { headers } from 'next/headers';
import { listGrants } from '../../domain';
import type { Grant } from '../../domain/types';
import { currentActor } from '../../lib/actor';
import { domainContext } from '../../lib/runtime';

export const dynamic = 'force-dynamic';

const COLUMNS: readonly TableColumn<Grant>[] = [
  { key: 'subject', header: 'Subjekt', cell: (g) => `${g.subject.kind}:${g.subject.id}` },
  { key: 'verb', header: 'Verb', cell: (g) => g.verb },
  { key: 'resource', header: 'Ressource', cell: (g) => `${g.resource.kind}:${g.resource.id}` },
  { key: 'grantedBy', header: 'Vergeben von', cell: (g) => g.grantedBy, hideBelow: 'md' },
  {
    key: 'state',
    header: 'Stand',
    cell: (g) =>
      g.revokedAt === null ? 'offen' : `widerrufen am ${g.revokedAt.toISOString().slice(0, 10)}`,
  },
];

export default async function GrantsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/grants', { headers: requestHeaders });

  let grants: readonly Grant[] = [];
  let failure: string | undefined;
  try {
    const actor = await currentActor(request);
    grants = await listGrants(domainContext(), { actor });
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unbekannter Fehler';
  }

  return (
    <section>
      <h1>Freigaben</h1>
      <Table
        caption="Wer darf was auf welcher Ressource"
        columns={COLUMNS}
        rows={grants}
        rowKey={(grant) => grant.id}
        {...(failure === undefined
          ? {}
          : { error: { title: 'Freigaben konnten nicht geladen werden', description: failure } })}
        empty={{
          title: 'Keine Freigabe vergeben',
          description: 'Ohne Freigabe ist alles gesperrt. Das ist der gewollte Ausgangszustand.',
        }}
      />
    </section>
  );
}
