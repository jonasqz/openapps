'use client';

import { useMemo, type JSX } from 'react';
import {
  BacklinksPanel,
  createActionsLoader,
  createBacklinksLoader,
  createMentionSearch,
  createRefResolver,
  MentionPicker,
  RefActionsMenu,
  ResolvedRefChip,
  type MentionOption,
} from '@openapps/ui';

/**
 * Verweise zwischen Apps im Wiki (ADR 0023). Chips, Rueckverweise, Picker
 * und Aktionen laden im Browser ueber `/_platform/…` auf dem gemeinsamen
 * Host, die Person aus ihrer Session. Der Server des Wikis ist nicht
 * beteiligt und sieht keine Titel anderer Apps. Ein Aufloeser fuer die
 * ganze Seite, damit alle Chips in einer Anfrage laden.
 */
const resolve = createRefResolver();
const mentionSearch = createMentionSearch('wiki');

export function WikiRefChip({ value }: { value: string }): JSX.Element {
  return <ResolvedRefChip value={value} resolve={resolve} />;
}

/**
 * Rueckverweise aus **anderen** Apps. Die Links zwischen Wiki-Seiten zeigt
 * die Seite schon selbst (`page_links`).
 */
export function WikiBacklinks({ refValue }: { refValue: string }): JSX.Element {
  const load = useMemo(() => createBacklinksLoader(refValue, { resolve }), [refValue]);
  return <BacklinksPanel load={load} title="Referenced in other apps" excludeApps={['wiki']} />;
}

/** Personen erwaehnen und Objekte verlinken; die Auswahl geht als Verweis an den Editor. */
export function WikiMentionPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (option: MentionOption) => void;
  onCancel: () => void;
}): JSX.Element {
  return <MentionPicker search={mentionSearch} onSelect={onSelect} onCancel={onCancel} autoFocus />;
}

/**
 * „Create task from section“ (ADR 0023 E): die Aktionen anderer Apps fuer
 * diese Seite, mit dem gewaehlten Abschnitt als Auszug. Jede Aktion ist ein
 * Link in die Ziel-App; die Person bestaetigt dort.
 */
export function WikiSectionActions({
  refValue,
  sections,
}: {
  refValue: string;
  sections: readonly { heading: string; excerpt: string }[];
}): JSX.Element {
  const load = useMemo(() => createActionsLoader(refValue), [refValue]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {sections.map((section, index) => (
        <div
          key={`${String(index)}-${section.heading}`}
          data-wiki-section={section.heading}
          className="flex min-w-0 flex-col gap-1"
        >
          <p className="truncate text-sm text-fg">{section.heading}</p>
          <RefActionsMenu
            load={load}
            excerpt={() => section.excerpt}
            label="Create task from section"
            only={(action) => action.app === 'tasks'}
          />
        </div>
      ))}
    </div>
  );
}
