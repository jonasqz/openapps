'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { strings } from '../strings.ts';
import type { RefResolution, ResolveRef } from './platform-refs.ts';

/**
 * Ein Verweis im Text (ADR 0023 G): `@{tasks:task:42}` wird ein Chip mit
 * Titel und Status, wenn die Person die Ziel-App lesen darf. Sonst steht dort
 * nur „Restricted“, ohne Titel und ohne App-Namen; das hat die Plattform
 * schon so geliefert, der Chip zeigt nichts darueber hinaus.
 *
 * Zustaende: laden, aufgeloest, `restricted`, `not_found`, nicht erreichbar
 * und Fehler (die Plattform hat gar nicht geantwortet, mit „Try again“).
 */

export type RefChipState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; resolution: RefResolution };

export interface RefChipProps {
  state: RefChipState;
  /** Nur im Fehlerzustand: neuer Versuch. */
  onRetry?: () => void;
  className?: string;
}

const BASE =
  'inline-flex max-w-full items-baseline gap-1 rounded-sm border px-1.5 align-baseline text-sm leading-6';

export function RefChip({ state, onRetry, className }: RefChipProps): JSX.Element {
  if (state.status === 'loading') {
    return (
      <span
        data-oa-ref-chip="loading"
        aria-busy="true"
        className={cn(BASE, 'border-border bg-surface-muted text-fg-subtle', className)}
      >
        <span className="inline-block h-3 w-16 animate-pulse rounded-sm bg-surface-hover" aria-hidden="true" />
        <span className="sr-only">{strings.refs.loading}</span>
      </span>
    );
  }
  if (state.status === 'error') {
    return (
      <span
        data-oa-ref-chip="error"
        className={cn(BASE, 'border-danger bg-danger-subtle text-danger-subtle-fg', className)}
      >
        {strings.refs.error}
        {onRetry === undefined ? null : (
          <button
            type="button"
            onClick={onRetry}
            className={cn('underline underline-offset-2', focusRing)}
          >
            {strings.refs.retry}
          </button>
        )}
      </span>
    );
  }

  const { resolution } = state;
  if (resolution.state !== 'resolved') {
    const label =
      resolution.state === 'restricted'
        ? strings.refs.restricted
        : resolution.state === 'not_found'
          ? strings.refs.notFound
          : strings.refs.unavailable;
    return (
      <span
        data-oa-ref-chip={resolution.state}
        title={resolution.state === 'restricted' ? strings.refs.restrictedHint : undefined}
        className={cn(BASE, 'border-dashed border-border-strong bg-bg text-fg-subtle', className)}
      >
        {label}
      </span>
    );
  }

  const isPerson = resolution.kind !== 'object';
  const content = (
    <>
      {isPerson ? <span aria-hidden="true">@</span> : null}
      <span className="min-w-0 truncate">{resolution.title}</span>
      {resolution.appTitle === undefined ? null : (
        <span className="shrink-0 font-mono text-2xs uppercase tracking-label text-fg-subtle">
          {resolution.appTitle}
        </span>
      )}
      {resolution.status === undefined ? null : (
        <span className="shrink-0 text-xs text-fg-muted">
          <span className="sr-only">{strings.refs.statusPrefix}</span>
          {resolution.status}
        </span>
      )}
    </>
  );
  const classes = cn(
    BASE,
    isPerson ? 'border-primary-subtle bg-primary-subtle text-primary-subtle-fg' : 'border-border bg-surface text-fg',
    className,
  );
  if (resolution.href === undefined) {
    return (
      <span data-oa-ref-chip="resolved" className={classes}>
        {content}
      </span>
    );
  }
  return (
    <a
      data-oa-ref-chip="resolved"
      href={resolution.href}
      className={cn(classes, 'hover:border-fg-muted', focusRing)}
    >
      {content}
    </a>
  );
}

/**
 * Laedt einen Verweis mit `resolve` und haelt den Zustand fuer den Chip.
 * `retry` fragt nach einem Fehler noch einmal.
 */
export function useRefResolution(
  value: string,
  resolve: ResolveRef,
): { state: RefChipState; retry: () => void } {
  const [state, setState] = useState<RefChipState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    resolve(value).then(
      (resolution) => {
        if (alive) setState({ status: 'done', resolution });
      },
      () => {
        if (alive) setState({ status: 'error' });
      },
    );
    return () => {
      alive = false;
    };
  }, [value, resolve, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}

export interface ResolvedRefChipProps {
  /** Der Verweis ohne `@{` und `}`. */
  value: string;
  resolve: ResolveRef;
  className?: string;
}

/** Chip, der sich selbst laedt: `useRefResolution` plus `RefChip`. */
export function ResolvedRefChip({ value, resolve, className }: ResolvedRefChipProps): JSX.Element {
  const { state, retry } = useRefResolution(value, resolve);
  return (
    <RefChip
      state={state}
      onRetry={retry}
      {...(className === undefined ? {} : { className })}
    />
  );
}
