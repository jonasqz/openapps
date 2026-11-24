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
        setError(messageOf(payload, 'Der Agent konnte nicht angelegt werden.'));
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
            grantProblems.push(`${verb} auf app:*: ${messageOf(reason, 'abgelehnt')}`);
          }
        }
      }
      setCreated({ name: name.trim(), token, grantProblems });
      setName('');
    } catch {
      setError('Die Control Plane war nicht erreichbar.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="mt-6 gap-4 p-4">
      <CardHeader
        title="Neuer Agent"
        description="Eine neue Identität darf nichts. Was der Agent tun darf, entscheiden Freigaben."
      />
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Input
          label="Name"
          hint="Klein geschrieben, Buchstaben, Ziffern, Bindestriche — zum Beispiel claude-jonas. Wird zum Subjekt agent:<name>."
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          autoComplete="off"
          spellCheck={false}
        />
        <Checkbox
          label="Darf Apps anlegen, deployen und zurücksetzen"
          hint="Vergibt read, write und execute auf app:* — dieselben Rechte, die platform-admins auf Apps hat. Ohne Haken ist der Agent angelegt, aber gesperrt."
          checked={operator}
          onChange={(event) => setOperator(event.target.checked)}
        />
        <div>
          <Button type="submit" loading={pending} loadingLabel="Agent wird angelegt">
            Agent anlegen
          </Button>
        </div>
      </form>

      {error === undefined ? null : (
        <ErrorState title="Der Agent wurde nicht angelegt" description={error} />
      )}

      {created === undefined ? null : (
        <div className="flex flex-col gap-3" role="status">
          <p className="text-sm font-medium text-fg">
            agent:{created.name} ist angelegt. Das Token steht nur jetzt hier — nach dem Neuladen
            kennt es niemand mehr.
          </p>
          <Input label="Token" value={created.token} readOnly spellCheck={false} />
          <Input
            label="Für Claude Code"
            hint="Im Terminal ausführen. Das Token gehört nicht in ein Repo und nicht in einen Chat."
            value={`claude mcp add --transport http openapps ${mcpUrl} --header "Authorization: Bearer ${created.token}"`}
            readOnly
            spellCheck={false}
          />
          {created.grantProblems.length === 0 ? null : (
            <ErrorState
              title="Nicht alle Freigaben wurden gesetzt"
              description={created.grantProblems.join(' · ')}
            />
          )}
        </div>
      )}
    </Card>
  );
}
