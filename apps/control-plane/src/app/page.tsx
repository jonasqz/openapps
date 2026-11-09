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
import { redirect } from 'next/navigation';
import { listApps } from '../domain';
import type { App } from '../domain/types';
import { currentActorOrNull } from '../lib/actor';
import { domainContext } from '../lib/runtime';

export const dynamic = 'force-dynamic';

/**
 * Die Seite rendert auf dem Server, `Table` ist eine Client-Komponente: Eine
 * Spalte nennt deshalb ihr `field` und keine `cell`. Abgeleitete Werte stehen
 * vorher in der Zeile (`AppRow`), nicht in einer Funktion.
 */
interface AppRow {
  id: string;
  displayName: string;
  primaryDomain: string | null;
  schemaName: string;
  deployment: string;
}

const COLUMNS: readonly TableColumn<AppRow>[] = [
  { field: 'displayName', header: 'Name' },
  { field: 'primaryDomain', header: 'Domain' },
  { field: 'schemaName', header: 'Schema', hideBelow: 'md' },
  { field: 'deployment', header: 'Aktuelles Deployment', hideBelow: 'sm' },
];

const toRow = (app: App): AppRow => ({
  id: app.id,
  displayName: app.displayName,
  primaryDomain: app.primaryDomain,
  schemaName: app.schemaName,
  deployment: app.currentDeploymentId ?? 'noch nicht deployt',
});

export default async function AppsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/apps', { headers: requestHeaders });

  // Ohne Session gibt es hier nichts zu zeigen, auch keinen Fehlerzustand:
  // der Nutzer gehoert auf den Login (Spec 1.3 laesst `/login` offen).
  const actor = await currentActorOrNull(request);
  if (actor === null) redirect('/login?next=%2F');

  let apps: readonly App[] = [];
  let failure: string | undefined;
  try {
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
        rows={apps.map(toRow)}
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
