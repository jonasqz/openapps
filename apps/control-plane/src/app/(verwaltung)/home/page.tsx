/**
 * Home: der eigene Eingang auf der Plattform (ADR 0022 D). Die Seite laedt
 * den ersten Stand auf dem Server ueber dieselbe Domaenenfunktion wie
 * `GET /api/inbox` und das MCP-Tool `list_inbox`; alles Weitere (Filter,
 * gelesen, erledigt) laeuft im Browser ueber die API.
 *
 * Mit Chat-Modell (ADR 0024) kommen Zusammenfassung und „Ask agent“ dazu,
 * ueber dieselben Domaenenfunktionen wie `POST /api/inbox/summary`,
 * `start_agent_run` und `list_agent_runs`. Ohne Modell sind sie nicht
 * sichtbar, und nichts davon scheitert.
 */

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { chatConfigured, listAgentProfiles, listAgentRuns, listInbox } from '../../../domain';
import { currentUser } from '../../../lib/actor';
import { readEnv } from '../../../lib/env';
import { lokalAppHref } from '../../../lib/lokal-links';
import { domainContext } from '../../../lib/runtime';
import { actorFromSession } from '../../../lib/session';
import { PageHeader } from '../page-header';
import { AgentPanel, type HomeRun, type StartableAgent } from './agent-panel';
import { InboxTriage, type HomeData } from './inbox-triage';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const request = new Request('http://control-plane/home', { headers: await headers() });
  const user = await currentUser(request);
  if (user === null) redirect('/login?next=%2Fhome');

  let initial: HomeData | null = null;
  let failure: string | undefined;
  try {
    const appHref = lokalAppHref(request, readEnv().controlPlaneHost);
    initial = await listInbox(domainContext(), {
      actor: actorFromSession(user),
      email: user.email,
      ...(appHref === undefined ? {} : { appHref }),
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unknown error';
  }

  // Nur mit Chat-Modell: ohne es gibt es weder Zusammenfassung noch Lauf.
  const ctx = domainContext();
  const withModel = chatConfigured(ctx);
  let agents: StartableAgent[] = [];
  let runs: HomeRun[] | null = null;
  let runsError: string | undefined;
  if (withModel) {
    const actor = actorFromSession(user);
    try {
      agents = (await listAgentProfiles(ctx, { actor })).agents
        .filter((agent) => agent.canStart)
        .map((agent) => ({ agent: agent.agent, displayName: agent.displayName }));
      runs = [...(await listAgentRuns(ctx, { actor, limit: 10 })).runs];
    } catch (error) {
      runsError = error instanceof Error ? error.message : 'unknown error';
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Platform"
        title="Home"
        description="What happened for you in the apps you may open: assigned to you, changed, won. Each item links back to its app."
      />
      {withModel ? (
        <AgentPanel
          agents={agents}
          runs={runs}
          {...(runsError === undefined ? {} : { runsError })}
        />
      ) : null}
      <InboxTriage
        initial={initial}
        {...(failure === undefined ? {} : { initialError: failure })}
      />
    </section>
  );
}
