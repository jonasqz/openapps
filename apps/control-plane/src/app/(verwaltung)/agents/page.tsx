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
import { listAgentIdentities } from '../../../domain';
import type { AgentIdentity } from '../../../domain/types';
import { currentActorOrNull } from '../../../lib/actor';
import { domainContext } from '../../../lib/runtime';
import { publicMcpUrl } from '../../../lib/loslegen';
import { CreateAgentForm } from './create-agent-form';
import { PageHeader } from '../page-header';

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
  { field: 'subject', header: 'Subject', hideBelow: 'md' },
  { field: 'owner', header: 'Created by', hideBelow: 'md' },
  { field: 'lastSeen', header: 'Last seen', hideBelow: 'sm' },
  { field: 'state', header: 'State' },
];

const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const day = (date: Date): string => DAY.format(date);

const toRow = (agent: AgentIdentity): AgentRow => ({
  id: agent.id,
  name: agent.displayName,
  subject: `agent:${agent.name}`,
  owner: agent.ownerUserId,
  lastSeen: agent.lastSeenAt === null ? 'never' : day(agent.lastSeenAt),
  state: agent.disabledAt === null ? 'active' : `disabled on ${day(agent.disabledAt)}`,
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
    failure = error instanceof Error ? error.message : 'unknown error';
  }

  // Die Adresse, unter der ein Agent den Plattform-MCP erreicht (dieselbe wie
  // auf der Seite Get started).
  const mcpUrl = publicMcpUrl();

  return (
    <section className="flex flex-col gap-8">
      <PageHeader
        title="Agents"
        description="Each agent has its own identity and may only do what it has been granted. In the apps it appears as the author."
      />
      <Table
        caption="Agent identities on this instance"
        columns={COLUMNS}
        rows={agents.map(toRow)}
        searchable
        {...(failure === undefined
          ? {}
          : { error: { title: 'Agents could not be loaded', description: failure } })}
        empty={{
          title: 'No agents yet',
          description:
            'An agent gets its own identity and then grants. Without both, it cannot get in.',
        }}
      />
      <CreateAgentForm mcpUrl={mcpUrl} />
      <p className="text-sm text-fg-muted">
        Disable an agent with the MCP tool disable_agent or DELETE /api/agents/&lt;name&gt;.
      </p>
    </section>
  );
}
