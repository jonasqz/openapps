'use client';

import { useState, type JSX } from 'react';
import { Button, Card, CardBody, EmptyState, ErrorState } from '@openapps/ui';
import { answerAction, type AnswerActionResult } from '@/app/actions';
import { SourceLink } from './SourceLink';
import { TextLink } from './TextLink';

/**
 * Antwort mit Zitaten auf der Suchseite (ADR 0025 E), die UI zum Tool
 * `answer`. Die Seite zeigt sie nur, wenn ein Chat-Modell konfiguriert ist;
 * sonst gibt es diese Komponente nicht. Gefragt wird erst auf Klick: Jede
 * Antwort kostet Tokens aus dem Tagesbudget von Knowledge, ein Seitenaufruf
 * soll das nicht.
 */
type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: AnswerActionResult }
  | { kind: 'failed' };

export function AnswerPanel({ question }: { question: string }): JSX.Element {
  const [state, setState] = useState<State>({ kind: 'idle' });

  const ask = async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'done', result: await answerAction(question) });
    } catch {
      setState({ kind: 'failed' });
    }
  };

  const retry = (
    <Button variant="secondary" onClick={() => void ask()}>
      Try again
    </Button>
  );

  if (state.kind === 'failed' || (state.kind === 'done' && !state.result.ok)) {
    const message =
      state.kind === 'done' && !state.result.ok
        ? state.result.message
        : 'The answer could not be created. Try again in a moment.';
    return <ErrorState title="The answer failed" description={message} action={retry} />;
  }

  if (state.kind === 'done' && state.result.ok && state.result.status !== 'answered') {
    return (
      <EmptyState
        title={
          state.result.status === 'not_configured'
            ? 'Answers are not available'
            : 'No answer from the sources'
        }
        description={state.result.message}
      />
    );
  }

  if (state.kind === 'done' && state.result.ok && state.result.status === 'answered') {
    const { answer, citations } = state.result;
    return (
      <section aria-labelledby="answer" className="min-w-0">
        <Card>
          <CardBody className="flex min-w-0 flex-col gap-3">
            <h2 id="answer" className="text-sm font-medium text-fg-muted">
              Answer
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-fg [overflow-wrap:anywhere]">
              {answer}
            </p>
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-xs font-medium text-fg-muted">Sources</h3>
              <ol className="flex min-w-0 list-decimal flex-col gap-1 pl-5 text-xs text-fg-muted">
                {citations.map((citation) => (
                  <li key={citation.chunkId} className="[overflow-wrap:anywhere]">
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      <TextLink href={citation.href}>{citation.documentTitle}</TextLink>
                      <span>Section {citation.section}</span>
                      {citation.sourceApp === null ? null : <SourceLink {...citation.sourceApp} />}
                      {citation.source === null ? null : <span>Source: {citation.source}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="text-xs text-fg-muted">
              Written by a model from the sections below. Check the sources before you rely on it.
            </p>
          </CardBody>
        </Card>
      </section>
    );
  }

  return (
    <Card>
      <CardBody className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-fg-muted">
          Get a short answer from these sections, with the sources it relies on.
        </p>
        <Button
          onClick={() => void ask()}
          loading={state.kind === 'loading'}
          loadingLabel="Answering"
          className="shrink-0"
        >
          Answer with sources
        </Button>
      </CardBody>
    </Card>
  );
}
