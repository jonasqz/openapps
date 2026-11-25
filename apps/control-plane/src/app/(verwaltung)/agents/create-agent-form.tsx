'use client';

/**
 * Das Formular fuer eine neue Agent-Identitaet. Es ruft `POST /api/agents`
 * und — nur wenn der Haken gesetzt ist — danach dreimal `POST /api/grants`.
 * Beides sind die Endpunkte, die auch ein Agent ruft; hier steht keine eigene
 * Logik und keine eigene Rechtepruefung.
 *
 * Das Token wird genau einmal gezeigt: Es steht nur in der Antwort auf das
 * Anlegen, und diese Komponente behaelt es nur im Speicher der Seite. Nach
 * einem Neuladen ist es weg.
 */

import { Button, Card, CardHeader, Checkbox, ErrorState, Input } from '@openapps/ui';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

export interface CreateAgentFormProps {
  /** Adresse des Plattform-MCP, wie sie ein Agent von aussen erreicht. */
  readonly mcpUrl: string;
}

interface Created {
  readonly name: string;
  readonly token: string;
  /** Freigaben, die danach nicht gesetzt werden konnten. */
  readonly grantProblems: readonly string[];
}

const messageOf = (payload: unknown, fallback: string): string =>
  typeof payload === 'object' && payload !== null && 'message' in payload
    ? String((payload as { message?: unknown }).message)
    : fallback;

export function CreateAgentForm({ mcpUrl }: CreateAgentFormProps): JSX.Element {
  const [name, setName] = useState('');
  const [operator, setOperator] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [created, setCreated] = useState<Created | undefined>();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    setCreated(undefined);
    setPending(true);
    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const token =
        typeof payload === 'object' && payload !== null && 'token' in payload
          ? (payload as { token?: unknown }).token
          : undefined;
      if (!response.ok || typeof token !== 'string') {
        setError(messageOf(payload, 'The agent could not be created.'));
        return;
      }

      // Der zweite Schritt ist absichtlich ein zweiter: Anlegen vergibt keine
      // Rechte. Scheitert eine Freigabe, steht sie sichtbar da — der Agent
      // existiert trotzdem, und das Token wird trotzdem gezeigt.
      const grantProblems: string[] = [];
      if (operator) {
        for (const verb of ['read', 'write', 'execute'] as const) {
          const granted = await fetch('/api/grants', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              subjectKind: 'agent',
              subjectId: name.trim(),
              verb,
              resourceKind: 'app',
              resourceId: '*',
            }),
          });
          if (!granted.ok) {
            const reason: unknown = await granted.json().catch(() => null);
            grantProblems.push(`${verb} on app:*: ${messageOf(reason, 'rejected')}`);
          }
        }
      }
      setCreated({ name: name.trim(), token, grantProblems });
      setName('');
    } catch {
      setError('The control plane could not be reached.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mt-6 gap-4 p-4">
      <CardHeader
        title="New agent"
        description="A new identity may do nothing. Grants decide what the agent may do."
      />
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Input
          label="Name"
          hint="Lower case letters, digits and hyphens, for example claude-jonas. Becomes the subject agent:<name>."
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <Checkbox
          label="May create, deploy and roll back apps"
          hint="Grants read, write and execute on app:*, the same rights platform-admins has on apps. Without the tick, the agent is created but locked."
          checked={operator}
          onChange={(event) => setOperator(event.target.checked)}
        />
        <div>
          <Button type="submit" loading={pending} loadingLabel="Creating agent">
            Create agent
          </Button>
        </div>
      </form>

      {error === undefined ? null : (
        <ErrorState title="The agent was not created" description={error} />
      )}

      {created === undefined ? null : (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm font-medium text-fg">
            agent:{created.name} has been created. The token is shown only now; after a reload,
            nobody knows it any more.
          </p>
          <Input label="Token" value={created.token} readOnly spellCheck={false} />
          <Input
            label="For Claude Code"
            hint="Run this in a terminal. The token does not belong in a repo or a chat."
            value={`claude mcp add --transport http openapps ${mcpUrl} --header "Authorization: Bearer ${created.token}"`}
            readOnly
            spellCheck={false}
          />
          {created.grantProblems.length === 0 ? null : (
            <ErrorState
              title="Not all grants were set"
              description={created.grantProblems.join(' · ')}
            />
          )}
        </div>
      )}
    </Card>
  );
}
