/**
 * Die Freigaben. Eine Liste, kein Formular: vergeben und widerrufen passiert
 * über `grant` und `revoke` im Plattform-MCP bzw. unter `/api/grants`.
 * Die Seite macht sichtbar, was gilt — und wer es vergeben hat.
 */

import { Table, type TableColumn } from '@openapps/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { listGrants } from '../../domain';
import type { Grant } from '../../domain/types';
import { currentActorOrNull } from '../../lib/actor';
import { domainContext } from '../../lib/runtime';

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
  { field: 'subject', header: 'Subjekt' },
  { field: 'verb', header: 'Verb' },
  { field: 'resource', header: 'Ressource' },
  { field: 'grantedBy', header: 'Vergeben von', hideBelow: 'md' },
  { field: 'state', header: 'Stand' },
];

const toRow = (g: Grant): GrantRow => ({
  id: g.id,
  subject: `${g.subject.kind}:${g.subject.id}`,
  verb: g.verb,
  resource: `${g.resource.kind}:${g.resource.id}`,
  grantedBy: g.grantedBy,
  state: g.revokedAt === null ? 'offen' : `widerrufen am ${g.revokedAt.toISOString().slice(0, 10)}`,
});

export default async function GrantsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/grants', { headers: requestHeaders });

  // Ohne Session: Login, nicht Fehlerzustand.
  const actor = await currentActorOrNull(request);
  if (actor === null) redirect('/login?next=%2Fgrants');

  let grants: readonly Grant[] = [];
  let failure: string | undefined;
  try {
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
        rows={grants.map(toRow)}
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
