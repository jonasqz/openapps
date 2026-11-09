/**
 * Die Freigaben. Eine Liste, kein Formular: vergeben und widerrufen passiert
 * über `grant` und `revoke` im Plattform-MCP bzw. unter `/api/grants`.
 * Die Seite macht sichtbar, was gilt — und wer es vergeben hat.
 */

import { EmptyState, ErrorState, Table } from '@openapps/ui';
import { listGrants } from '../../domain';
import { currentActor } from '../../lib/actor';
import { domainContext } from '../../lib/runtime';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function GrantsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/grants', { headers: requestHeaders });

  let grants;
  try {
    const actor = await currentActor(request);
    grants = await listGrants(domainContext(), { actor });
  } catch (error) {
    return (
      <ErrorState
        title="Freigaben konnten nicht geladen werden"
        description={error instanceof Error ? error.message : 'unbekannter Fehler'}
      />
    );
  }

  if (grants.length === 0) {
    return (
      <EmptyState
        title="Keine Freigabe vergeben"
        description="Ohne Freigabe ist alles gesperrt. Das ist der gewollte Ausgangszustand."
      />
    );
  }

  return (
    <section>
      <h1>Freigaben</h1>
      <Table
        caption="Wer darf was auf welcher Ressource"
        columns={[
          { key: 'subject', header: 'Subjekt' },
          { key: 'verb', header: 'Verb' },
          { key: 'resource', header: 'Ressource' },
          { key: 'grantedBy', header: 'Vergeben von' },
          { key: 'state', header: 'Stand' },
        ]}
        rows={grants.map((entry) => ({
          id: entry.id,
          subject: `${entry.subject.kind}:${entry.subject.id}`,
          verb: entry.verb,
          resource: `${entry.resource.kind}:${entry.resource.id}`,
          grantedBy: entry.grantedBy,
          state:
            entry.revokedAt === null
              ? 'offen'
              : `widerrufen am ${entry.revokedAt.toISOString().slice(0, 10)}`,
        }))}
      />
    </section>
  );
}
