/**
 * Die Agent-Identitaeten: wer als Agent hereinkommt, wem er gehoert, wann er
 * zuletzt da war. Darunter das Formular fuer eine neue.
 *
 * Das Formular ruft `POST /api/agents` — denselben Endpunkt, den es als
 * MCP-Tool `create_agent` gibt (CLAUDE.md, Grundsatz 1). Die Seite ist nur der
 * Weg fuer den allerersten Agent: Bevor es einen gibt, kann keiner das Tool
 * rufen.
 */

import { Table, type TableColumn } from '@openapps/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { listAgentIdentities } from '../../domain';
import type { AgentIdentity } from '../../domain/types';
import { currentActorOrNull } from '../../lib/actor';
import { domainContext } from '../../lib/runtime';
import { CreateAgentForm } from './create-agent-form';

export const dynamic = 'force-dynamic';

/** `Table` ist eine Client-Komponente: Spalten nennen ein Feld, keine Funktion. */
interface AgentRow {
  id: string;
  name: string;
  subject: string;
  owner: string;
  lastSeen: string;
  state: string;
}

const COLUMNS: readonly TableColumn<AgentRow>[] = [
  { field: 'name', header: 'Name' },
  { field: 'subject', header: 'Subjekt', hideBelow: 'md' },
  { field: 'owner', header: 'Angelegt von', hideBelow: 'md' },
  { field: 'lastSeen', header: 'Zuletzt gesehen', hideBelow: 'sm' },
  { field: 'state', header: 'Stand' },
];

const day = (date: Date): string => date.toISOString().slice(0, 10);

const toRow = (agent: AgentIdentity): AgentRow => ({
  id: agent.id,
  name: agent.displayName,
  subject: `agent:${agent.name}`,
  owner: agent.ownerUserId,
  lastSeen: agent.lastSeenAt === null ? 'noch nie' : day(agent.lastSeenAt),
  state: agent.disabledAt === null ? 'aktiv' : `gesperrt am ${day(agent.disabledAt)}`,
});

export default async function AgentsPage() {
  const requestHeaders = await headers();
  const request = new Request('http://control-plane/agents', { headers: requestHeaders });

  // Ohne Session: Login, nicht Fehlerzustand.
  const actor = await currentActorOrNull(request);
  if (actor === null) redirect('/login?next=%2Fagents');

  let agents: readonly AgentIdentity[] = [];
  let failure: string | undefined;
  try {
    agents = await listAgentIdentities(domainContext(), { actor });
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unbekannter Fehler';
  }

  // Die Adresse, unter der ein Agent den Plattform-MCP erreicht. Aus der
  // eigenen Domain abgeleitet, nicht aus dem Request: Hinter dem Proxy steht
  // im Host-Header nicht verlaesslich, was aussen gilt.
  const host = process.env.CONTROL_PLANE_HOST?.trim();
  const mcpUrl = host === undefined || host === '' ? '/mcp' : `https://${host}/mcp`;

  return (
    <section>
      <h1>Agents</h1>
      <Table
        caption="Agent-Identitäten dieser Instanz"
        columns={COLUMNS}
        rows={agents.map(toRow)}
        {...(failure === undefined
          ? {}
          : { error: { title: 'Agents konnten nicht geladen werden', description: failure } })}
        empty={{
          title: 'Noch kein Agent',
          description:
            'Ein Agent bekommt eine eigene Identität und danach Freigaben. Ohne beides kommt er nicht herein.',
        }}
      />
      <CreateAgentForm mcpUrl={mcpUrl} />
      <p>
        Sperren läuft über das MCP-Tool disable_agent oder DELETE /api/agents/&lt;name&gt;.{' '}
        <a href="/grants">Freigaben ansehen</a> · <a href="/">Apps</a>
      </p>
    </section>
  );
}
