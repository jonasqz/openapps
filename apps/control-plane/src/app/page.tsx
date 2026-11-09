/**
 * Die Liste der Apps. Absichtlich duenn: jede Aktion existiert zuerst als Tool
 * im Plattform-MCP und als Endpunkt unter `/api`, die Seite zeigt nur.
 *
 * Leerer Zustand und Fehlerzustand kommen aus `Table` selbst (`empty`,
 * `error`) — das Design System verlangt beide und liefert sie mit, damit keine
 * Liste sie vergisst.
 */

import { Table, type TableColumn } from '@openapps/ui';
import { headers } from 'next/headers';
import { listApps } from '../domain';
import type { App } from '../domain/types';
import { currentActor } from '../lib/actor';
import { domainContext } from '../lib/runtime';

export const dynamic = 'force-dynamic';

const COLUMNS: readonly TableColumn<App>[] = [
  { key: 'name', header: 'Name', cell: (app) => app.displayName },
  { key: 'domain', header: 'Domain', cell: (app) => app.primaryDomain ?? '—' },
  { key: 'schema', header: 'Schema', cell: (app) => app.schemaName, hideBelow: 'md' },
  {
    key: 'deployment',
    header: 'Aktuelles Deployment',
    cell: (app) => app.currentDeploymentId ?? 'noch nicht deployt',
    hideBelow: 'sm',
  },
];

export default async function AppsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/apps', { headers: requestHeaders });

  let apps: readonly App[] = [];
  let failure: string | undefined;
  try {
    const actor = await currentActor(request);
    apps = await listApps(domainContext(), { actor });
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unbekannter Fehler';
  }

  return (
    <section>
      <h1>Apps</h1>
      <Table
        caption="Apps dieser Instanz"
        columns={COLUMNS}
        rows={apps}
        rowKey={(app) => app.id}
        {...(failure === undefined
          ? {}
          : { error: { title: 'Apps konnten nicht geladen werden', description: failure } })}
        empty={{
          title: 'Noch keine App',
          description: 'Apps entstehen über das MCP-Tool create_app, nicht hier.',
        }}
      />
      <p>
        Zurücksetzen, Deployen und Freigeben laufen über den Plattform-MCP — dort existiert jede
        Aktion zuerst. <a href="/grants">Freigaben ansehen</a>
      </p>
    </section>
  );
}
