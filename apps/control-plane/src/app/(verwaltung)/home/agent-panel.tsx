'use client';

/**
 * Home mit Modell (ADR 0024): Zusammenfassung des Eingangs und „Ask agent“.
 * Die Seite rendert dieses Stueck **nur**, wenn ein Chat-Modell konfiguriert
 * ist; ohne Modell gibt es keinen Knopf, der nur `not_configured` zeigte.
 *
 * Erst Tool, dann Seite: Die Knoepfe rufen nur `POST /api/inbox/summary`,
 * `GET`/`POST /api/agent-runs`, dieselben Domaenenfunktionen wie die
 * MCP-Tools `start_agent_run` und `list_agent_runs`. Hier steht keine
 * Rechtepruefung; was die Listen zeigen, hat die Control Plane gefiltert.
 */

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Select,
  Spinner,
  Textarea,
  type BadgeTone,
} from '@openapps/ui';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';

export interface StartableAgent {
  readonly agent: string;
  readonly displayName: string;
}

export interface HomeRun {
  readonly id: string;
  readonly agent: string;
  readonly status: 'queued' | 'running' | 'succeeded' | 'failed';
  readonly triggerKind: 'manual' | 'mention';
  readonly prompt: string;
  readonly result: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly createdAt: string;
}

export interface AgentPanelProps {
  readonly agents: readonly StartableAgent[];
  /** Erster Stand vom Server, oder `null`, wenn er nicht geladen werden konnte. */
  readonly runs: readonly HomeRun[] | null;
  readonly runsError?: string;
}

const PROMPT_MAX = 4000;

const STATUS: Readonly<Record<HomeRun['status'], { label: string; tone: BadgeTone }>> = {
  queued: { label: 'Queued', tone: 'neutral' },
  running: { label: 'Running', tone: 'primary' },
  succeeded: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

const messageOf = (payload: unknown, fallback: string): string =>
  typeof payload === 'object' && payload !== null && 'message' in payload
    ? String((payload as { message?: unknown }).message)
    : fallback;

function isRunList(value: unknown): value is { runs: HomeRun[] } {
  return (
    typeof value === 'object' && value !== null && Array.isArray((value as { runs?: unknown }).runs)
  );
}

function SummaryCard(): JSX.Element {
  const [summary, setSummary] = useState<string | null | undefined>(undefined);
  const [withheld, setWithheld] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const summarize = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch('/api/inbox/summary', {
        method: 'POST',
        headers: { accept: 'application/json' },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof payload !== 'object' || payload === null) {
        setError(messageOf(payload, 'The summary could not be created.'));
        return;
      }
      const result = payload as { summary?: unknown; withheld?: unknown };
      setSummary(typeof result.summary === 'string' ? result.summary : null);
      setWithheld(typeof result.withheld === 'number' ? result.withheld : 0);
    } catch {
      setError('The summary could not be created. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <Card>
      <CardHeader
        as="h2"
        title="Summary"
        description="A short summary of your open inbox, written by the platform model from the titles only."
        actions={
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void summarize()}>
            Summarize
          </Button>
        }
      />
      <CardBody>
        {error !== undefined ? (
          <ErrorState
            title="The summary could not be created"
            description={error}
            action={
              <Button variant="secondary" size="sm" onClick={() => void summarize()}>
                Try again
              </Button>
            }
          />
        ) : summary === undefined ? (
          <p className="text-sm text-fg-muted">Nothing summarized yet.</p>
        ) : summary === null ? (
          <EmptyState
            title="Nothing to summarize"
            description="Your open inbox is empty, or every item comes from an app that stays in-house."
          />
        ) : (
          <div>
            <p className="whitespace-pre-wrap text-sm text-fg">{summary}</p>
            {withheld > 0 ? (
              <p className="mt-2 text-xs text-fg-muted">
                {String(withheld)} item(s) from apps that stay in-house were left out.
              </p>
            ) : null}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function AgentPanel({ agents, runs: initialRuns, runsError }: AgentPanelProps): JSX.Element {
  const [agent, setAgent] = useState<string>(agents[0]?.agent ?? '');
  const [prompt, setPrompt] = useState('');
  const [promptError, setPromptError] = useState<string | undefined>(undefined);
  const [startError, setStartError] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const [runs, setRuns] = useState<readonly HomeRun[] | null>(initialRuns);
  const [error, setError] = useState<string | undefined>(
    initialRuns === null ? (runsError ?? 'The agent runs could not be loaded.') : undefined,
  );
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await fetch('/api/agent-runs?limit=10', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRunList(payload)) {
        setError(messageOf(payload, 'The agent runs could not be loaded.'));
        return;
      }
      setRuns(payload.runs);
      setError(undefined);
    } catch {
      setError('The agent runs could not be loaded. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Solange ein Lauf wartet oder laeuft, alle 5 s nachsehen.
  const pending = (runs ?? []).some((run) => run.status === 'queued' || run.status === 'running');
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [pending, load]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const text = prompt.trim();
    if (text === '') {
      setPromptError('Tell the agent what to do.');
      return;
    }
    if (text.length > PROMPT_MAX) {
      setPromptError(`At most ${String(PROMPT_MAX)} characters.`);
      return;
    }
    setPromptError(undefined);
    setStartError(undefined);
    setStarting(true);
    try {
      const response = await fetch('/api/agent-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent, prompt: text }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setStartError(messageOf(payload, 'The agent could not be started.'));
        return;
      }
      setPrompt('');
      await load();
    } catch {
      setStartError('The agent could not be started. Check your connection and try again.');
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="mb-8 grid gap-4 lg:grid-cols-2">
      <SummaryCard />
      <Card>
        <CardHeader
          as="h2"
          title="Ask agent"
          description="A platform agent works with its own grants, limited to what you may do yourself."
        />
        <CardBody>
          {agents.length === 0 ? (
            <EmptyState
              title="No agent you may start"
              description="An administrator can give you execute on a platform agent."
            />
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => void submit(event)}
              noValidate
            >
              <Select
                label="Agent"
                options={agents.map((entry) => ({ value: entry.agent, label: entry.displayName }))}
                value={agent}
                onChange={(event) => setAgent(event.target.value)}
              />
              <Textarea
                label="Request"
                rows={3}
                value={prompt}
                maxLength={PROMPT_MAX}
                onChange={(event) => setPrompt(event.target.value)}
                {...(promptError === undefined ? {} : { error: promptError })}
              />
              {startError === undefined ? null : (
                <p role="alert" className="text-sm text-danger">
                  {startError}
                </p>
              )}
              <div>
                <Button type="submit" loading={starting}>
                  Ask agent
                </Button>
              </div>
            </form>
          )}
        </CardBody>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader
          as="h2"
          title="Agent runs"
          description="Runs you started and runs of agents you look after."
          actions={
            <Button variant="ghost" size="sm" loading={loading} onClick={() => void load()}>
              Refresh
            </Button>
          }
        />
        <CardBody>
          {error !== undefined ? (
            <ErrorState
              title="The agent runs could not be loaded"
              description={error}
              action={
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  Try again
                </Button>
              }
            />
          ) : runs === null && loading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-fg-muted">
              <Spinner />
              <span>Loading</span>
            </div>
          ) : runs === null || runs.length === 0 ? (
            <EmptyState
              title="No agent runs yet"
              description="Ask an agent above, or mention one with @ in an app."
            />
          ) : (
            <ul aria-label="Agent runs" className="divide-y divide-border">
              {runs.map((run) => (
                <li key={run.id} className="py-3" data-status={run.status}>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                    <span className="font-medium text-fg">{run.agent}</span>
                    <Badge tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Badge>
                    {run.triggerKind === 'mention' ? <span>from a mention</span> : null}
                    <time dateTime={run.createdAt}>
                      {new Date(run.createdAt).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{run.prompt}</p>
                  {run.result === null ? null : (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-fg">{run.result}</p>
                  )}
                  {run.error === null ? null : (
                    <p className="mt-1 text-sm text-danger">{run.error.message}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
