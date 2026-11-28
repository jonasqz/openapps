'use client';

import { useMemo, type JSX } from 'react';
import {
  BacklinksPanel,
  createActionsLoader,
  createBacklinksLoader,
  createRefResolver,
  RefActionsMenu,
  RefText,
} from '@openapps/ui';
import { refSegments } from '@/lib/ref-segments';

/**
 * Verweise zwischen Apps im CRM (ADR 0023). Chips, Rueckverweise und
 * Aktionen laden im Browser ueber `/_platform/…` auf dem gemeinsamen Host,
 * die Person aus ihrer Session. Der Server des CRM ist nicht beteiligt und
 * sieht keine Titel anderer Apps. Ein Aufloeser fuer die ganze Seite.
 */
const resolve = createRefResolver();

/** Text einer Notiz oder eines naechsten Schritts, `@{…}` als Chips. */
export function CrmRefText({ text, className }: { text: string; className?: string }): JSX.Element {
  const segments = useMemo(() => refSegments(text), [text]);
  return <RefText segments={segments} resolve={resolve} {...(className === undefined ? {} : { className })} />;
}

/** Was von anderswo auf diese Firma, diesen Kontakt oder Deal zeigt. */
export function CrmBacklinks({ refValue }: { refValue: string }): JSX.Element {
  const load = useMemo(() => createBacklinksLoader(refValue, { resolve }), [refValue]);
  return <BacklinksPanel load={load} excludeApps={['crm']} />;
}

/** „Create task“ aus einem Deal (Aktion der Ziel-App, ADR 0023 E). */
export function CrmActions({ refValue, excerpt }: { refValue: string; excerpt: string }): JSX.Element {
  const load = useMemo(() => createActionsLoader(refValue), [refValue]);
  return <RefActionsMenu load={load} excerpt={() => excerpt} />;
}
