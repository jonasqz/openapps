/**
 * Die Liste der Apps. Absichtlich duenn: jede Aktion existiert zuerst als Tool
 * im Plattform-MCP und als Endpunkt unter `/api`, die Seite zeigt nur.
 *
 * Leerer Zustand und Fehlerzustand sind Pflicht (CLAUDE.md), nicht Zugabe —
 * deshalb stehen sie hier vor der Tabelle.
 */

import { EmptyState, ErrorState, Table } from '@openapps/ui';
import { listApps } from '../domain';
import { currentActor } from '../lib/actor';
import { domainContext } from '../lib/runtime';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function AppsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/apps', { headers: requestHeaders });

  let apps;
  try {
    const actor = await currentActor(request);
    apps = await listApps(domainContext(), { actor });
  } catch (error) {
    return (
      <ErrorState
        title="Apps konnten nicht geladen werden"
        description={error instanceof Error ? error.message : 'unbekannter Fehler'}
      />
    );
  }

  if (apps.length === 0) {
    return (
      <EmptyState
        title="Noch keine App"
        description="Apps entstehen über das MCP-Tool create_app, nicht hier."
      />
    );
  }

  return (
    <section>
      <h1>Apps</h1>
      <Table
        caption="Apps dieser Instanz"
        columns={[
          { key: 'name', header: 'Name' },
          { key: 'domain', header: 'Domain' },
          { key: 'schema', header: 'Schema' },
          { key: 'deployment', header: 'Aktuelles Deployment' },
        ]}
        rows={apps.map((app) => ({
          id: app.id,
          name: app.displayName,
          domain: app.primaryDomain ?? '—',
          schema: app.schemaName,
          deployment: app.currentDeploymentId ?? 'noch nicht deployt',
        }))}
      />
      <p>
        Zurücksetzen, Deployen und Freigeben laufen über den Plattform-MCP —
        dort existiert jede Aktion zuerst. <a href="/grants">Freigaben ansehen</a>
      </p>
    </section>
  );
}
