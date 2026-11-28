'use client';

import { useMemo, type JSX } from 'react';
import {
  BacklinksPanel,
  createBacklinksLoader,
  createRefResolver,
  RefText,
  ResolvedRefChip,
  type RefTextSegment,
} from '@openapps/ui';

/**
 * Verweise zwischen Apps in Tasks (ADR 0023). Alles laedt im Browser ueber
 * `/_platform/refs/…` auf dem gemeinsamen Host, die Person aus ihrer
 * Session; der Server von Tasks ist daran nicht beteiligt und sieht keine
 * Titel anderer Apps. Ein Aufloeser fuer die ganze Seite, damit alle Chips
 * in einer Anfrage laden.
 */
const resolve = createRefResolver();

/** Beschreibung oder Kommentar mit Chips statt `@{…}`. */
export function TaskRefText({ segments }: { segments: readonly RefTextSegment[] }): JSX.Element {
  return <RefText segments={segments} resolve={resolve} className="text-sm text-fg" />;
}

/** Ein einzelner Verweis, etwa die Quelle, aus der die Aufgabe entstand. */
export function TaskRefChip({ value }: { value: string }): JSX.Element {
  return <ResolvedRefChip value={value} resolve={resolve} />;
}

/** Was von anderswo auf diese Aufgabe zeigt. */
export function TaskBacklinks({ refValue }: { refValue: string }): JSX.Element {
  const load = useMemo(() => createBacklinksLoader(refValue, { resolve }), [refValue]);
  return <BacklinksPanel load={load} />;
}
