'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FormPattern, Select, Tabs, Textarea, type FormValues } from '@openapps/ui';
import { Markdown } from '@/components/Markdown';
import { WikiMentionPicker } from '@/components/Refs';
import { draftKey, isStale, parseDraft, serializeDraft, type Draft } from '@/lib/draft';
import {
  insertAt,
  insertCodeBlock,
  pageLinkMarkdown,
  toggleLineBlock,
  wrapInline,
  type Edit,
  type LineBlock,
} from '@/lib/editing';
import { formatDateTime } from '@/lib/format';
import { LIMITS, Tags, Title, splitTags } from '@/lib/schemas';
import { createPageAction, updatePageAction, type ActionResult } from './actions';
import type { MentionOption } from '@openapps/ui';

/**
 * Anlegen und Bearbeiten einer Seite. Titel und Tags laufen durch
 * `FormPattern` (Validierung sichtbar am Feld), der Inhalt durch einen
 * Markdown-Editor aus `Textarea` und `Tabs` des Design Systems: Schreiben,
 * Vorschau, eine Leiste fuer Bloecke (Ueberschrift, Liste, Checkliste, Zitat,
 * Code), Links auf andere Seiten und „Mention or link“: Personen erwaehnen und
 * Objekte anderer Apps verlinken (ADR 0023). Eingefuegt wird nur der Verweis
 * `@{app:typ:id}`, nie ein Titel; die Plattform loest ihn beim Lesen mit den
 * Rechten der lesenden Person auf.
 *
 * Waehrend des Schreibens legt der Editor einen Entwurf im Browser ab (siehe
 * `lib/draft.ts`). Gespeichert wird erst mit „Save“ ueber die Server Actions,
 * die dieselben Funktionen wie `pages.create` und `pages.update` rufen.
 */

export type PageFormProps = (
  | {
      mode: 'create';
      parent: { id: string; title: string } | null;
    }
  | {
      mode: 'edit';
      id: string;
      initial: { title: string; tags: string[]; contentMd: string };
      /** Stand der Seite beim Oeffnen, um veraltete Entwuerfe zu erkennen. */
      updatedAt: string;
    }
) & {
  /** Seiten fuer „Link to page“. `null`: konnten nicht geladen werden. */
  linkTargets: ReadonlyArray<{ id: string; title: string }> | null;
};

const firstIssue = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? undefined : result.error?.issues[0]?.message;

/** Wartezeit nach dem letzten Tastendruck, bis der Entwurf geschrieben wird. */
const DRAFT_DELAY_MS = 800;

const BLOCKS: ReadonlyArray<{ kind: LineBlock | 'code'; label: string }> = [
  { kind: 'heading', label: 'Heading' },
  { kind: 'bullet', label: 'List' },
  { kind: 'numbered', label: 'Numbered' },
  { kind: 'checklist', label: 'Checklist' },
  { kind: 'quote', label: 'Quote' },
  { kind: 'code', label: 'Code' },
];

/** `localStorage` kann fehlen, voll oder gesperrt sein; dann gibt es keinen Entwurf. */
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function PageForm(props: PageFormProps): JSX.Element {
  const router = useRouter();
  const initialContent = props.mode === 'edit' ? props.initial.contentMd : '';
  const baseUpdatedAt = props.mode === 'edit' ? props.updatedAt : null;
  const key =
    props.mode === 'edit' ? draftKey({ pageId: props.id }) : draftKey({ parentId: props.parent?.id ?? null });

  const [content, setContent] = useState(initialContent);
  const [contentError, setContentError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState('write');
  const [pendingDraft, setPendingDraft] = useState<Draft | undefined>(undefined);
  const [draftStatus, setDraftStatus] = useState<string | undefined>(undefined);
  const [linkChoice, setLinkChoice] = useState('');
  const [mentioning, setMentioning] = useState(false);

  const textarea = useRef<HTMLTextAreaElement>(null);
  const nextSelection = useRef<{ start: number; end: number } | null>(null);
  // Erst nach dem Blick auf einen alten Entwurf wird geschrieben, sonst
  // ueberschriebe der leere Start einen Entwurf, bevor er angeboten wurde.
  const draftChecked = useRef(false);

  const cancelTarget =
    props.mode === 'edit'
      ? `/pages/${props.id}`
      : props.parent === null
        ? '/'
        : `/pages/${props.parent.id}`;

  // Beim Oeffnen: liegt ein Entwurf, der vom gespeicherten Stand abweicht?
  useEffect(() => {
    const draft = parseDraft(readStorage(key));
    if (draft !== undefined && draft.contentMd !== initialContent) setPendingDraft(draft);
    draftChecked.current = true;
    // `key` und `initialContent` bleiben fuer eine geoeffnete Seite gleich,
    // der Effekt laeuft also einmal.
  }, [key, initialContent]);

  // Entwurf schreiben, verzoegert. Solange ein alter Entwurf angeboten wird,
  // bleibt er unangetastet.
  useEffect(() => {
    if (!draftChecked.current || pendingDraft !== undefined) return undefined;
    const timer = setTimeout(() => {
      if (content === initialContent) {
        writeStorage(key, null);
        setDraftStatus(undefined);
        return;
      }
      const savedAt = new Date().toISOString();
      const ok = writeStorage(key, serializeDraft({ contentMd: content, savedAt, baseUpdatedAt }));
      setDraftStatus(
        ok
          ? `Draft saved in this browser at ${formatDateTime(savedAt)}.`
          : 'This browser does not allow saving a draft. Save the page to keep your text.',
      );
    }, DRAFT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [content, initialContent, key, baseUpdatedAt, pendingDraft]);

  // Auswahl nach einer Bearbeitung aus der Leiste wieder setzen.
  useLayoutEffect(() => {
    const selection = nextSelection.current;
    const element = textarea.current;
    if (selection === null || element === null) return;
    nextSelection.current = null;
    element.focus();
    element.setSelectionRange(selection.start, selection.end);
  }, [content]);

  const apply = (edit: (text: string, start: number, end: number) => Edit): void => {
    // In der Vorschau gibt es kein Textfeld: dann ans Ende anfuegen.
    const element = textarea.current;
    const text = element?.value ?? content;
    const start = element?.selectionStart ?? text.length;
    const end = element?.selectionEnd ?? text.length;
    const result = edit(text, start, end);
    nextSelection.current = { start: result.selectionStart, end: result.selectionEnd };
    setContent(result.text);
    setTab('write');
  };

  const onBlock = (kind: LineBlock | 'code'): void => {
    apply((text, start, end) =>
      kind === 'code' ? insertCodeBlock(text, start, end) : toggleLineBlock(text, start, end, kind),
    );
  };

  const onLink = (id: string): void => {
    const target = props.linkTargets?.find((page) => page.id === id);
    setLinkChoice('');
    if (target === undefined) return;
    apply((text, start, end) => insertAt(text, start, end, pageLinkMarkdown(target)));
  };

  const onMention = (option: MentionOption): void => {
    setMentioning(false);
    apply((text, start, end) => insertAt(text, start, end, `@{${option.ref}}`));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const keyName = event.key.toLowerCase();
    if (keyName === 'b' || keyName === 'i') {
      event.preventDefault();
      apply((text, start, end) => wrapInline(text, start, end, keyName === 'b' ? '**' : '*'));
    } else if (keyName === 'enter') {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const restoreDraft = (): void => {
    if (pendingDraft === undefined) return;
    setContent(pendingDraft.contentMd);
    setPendingDraft(undefined);
  };

  const discardDraft = (): void => {
    writeStorage(key, null);
    setPendingDraft(undefined);
    setDraftStatus(undefined);
  };

  const submit = async (values: FormValues): Promise<Record<string, string> | void> => {
    setFormError(undefined);
    if (content.length > LIMITS.contentMax) {
      setContentError(`Content must have at most ${LIMITS.contentMax} characters`);
      return;
    }
    setContentError(undefined);

    const title = String(values.title ?? '');
    const tags = splitTags(String(values.tags ?? ''));
    let result: ActionResult;
    try {
      result =
        props.mode === 'create'
          ? await createPageAction({
              title,
              contentMd: content,
              tags,
              ...(props.parent === null ? {} : { parentId: props.parent.id }),
            })
          : await updatePageAction({ id: props.id, title, contentMd: content, tags });
    } catch {
      setFormError('Saving failed. Your text is kept as a draft in this browser. Try again.');
      return;
    }

    if (result.ok) {
      writeStorage(key, null);
      router.push(`/pages/${result.id}`);
      router.refresh();
      return;
    }
    const { contentMd, ...fieldErrors } = result.fieldErrors ?? {};
    setContentError(contentMd);
    if (result.formError !== undefined) setFormError(result.formError);
    return fieldErrors;
  };

  const stale = pendingDraft !== undefined && isStale(pendingDraft, baseUpdatedAt);

  return (
    <FormPattern
      title={props.mode === 'create' ? 'New page' : 'Edit page'}
      {...(props.mode === 'create' && props.parent !== null
        ? { description: `Subpage of “${props.parent.title}”` }
        : {})}
      fields={[
        {
          kind: 'text',
          name: 'title',
          label: 'Title',
          required: true,
          validate: (value) => firstIssue(Title.safeParse(value)),
        },
        {
          kind: 'text',
          name: 'tags',
          label: 'Tags',
          hint: 'Comma-separated, e.g. people, leave',
          validate: (value) => firstIssue(Tags.safeParse(splitTags(String(value)))),
        },
      ]}
      initialValues={
        props.mode === 'edit'
          ? { title: props.initial.title, tags: props.initial.tags.join(', ') }
          : { title: '', tags: '' }
      }
      submitLabel={props.mode === 'create' ? 'Create page' : 'Save'}
      onCancel={() => router.push(cancelTarget)}
      onSubmit={submit}
      {...(formError === undefined ? {} : { formError })}
    >
      {pendingDraft === undefined ? null : (
        <div
          role="status"
          className="flex min-w-0 flex-col gap-3 rounded-md border border-border-strong bg-surface p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="min-w-0 text-fg">
            You have an unsaved draft from {formatDateTime(pendingDraft.savedAt)}.
            {stale ? ' The page has changed since then; restoring replaces the text in the editor.' : ''}
          </p>
          <span className="flex shrink-0 gap-2">
            <Button size="sm" variant="secondary" onClick={discardDraft}>
              Discard draft
            </Button>
            <Button size="sm" onClick={restoreDraft}>
              Restore draft
            </Button>
          </span>
        </div>
      )}

      <div className="flex min-w-0 flex-col gap-3">
        <div role="toolbar" aria-label="Insert block" className="flex min-w-0 flex-wrap items-end gap-2">
          {BLOCKS.map((block) => (
            <Button key={block.kind} size="sm" variant="secondary" onClick={() => onBlock(block.kind)}>
              {block.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={mentioning}
            onClick={() => setMentioning((open) => !open)}
          >
            Mention or link
          </Button>
          {props.linkTargets === null ? (
            <span className="text-xs text-fg-muted">Pages for links could not be loaded.</span>
          ) : (
            <Select
              label="Link to page"
              hideLabel
              placeholder="Link to page…"
              emptyLabel="No other pages yet"
              options={props.linkTargets.map((page) => ({ value: page.id, label: page.title }))}
              value={linkChoice}
              onChange={(event) => onLink(event.target.value)}
              fieldClassName="w-field"
            />
          )}
        </div>

        {mentioning ? (
          <div className="rounded-md border border-border p-3">
            <WikiMentionPicker onSelect={onMention} onCancel={() => setMentioning(false)} />
          </div>
        ) : null}

        <Tabs
          label="Editor"
          tabId={tab}
          onTabChange={setTab}
          items={[
            {
              id: 'write',
              label: 'Write',
              content: (
                <Textarea
                  ref={textarea}
                  label="Content (Markdown)"
                  hint="# Heading, - list, - [ ] checklist, > quote, **bold** (⌘B), *italic* (⌘I), [link](https://…), @{human:email} mentions. ⌘Enter saves."
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  onKeyDown={onKeyDown}
                  rows={20}
                  spellCheck
                  monospace
                  {...(contentError === undefined ? {} : { error: contentError })}
                />
              ),
            },
            {
              id: 'preview',
              label: 'Preview',
              content: (
                <div className="min-h-24 rounded-md border border-border p-4">
                  {content.trim() === '' ? (
                    <p className="text-sm text-fg-muted">Nothing to preview yet.</p>
                  ) : (
                    <Markdown source={content} />
                  )}
                </div>
              ),
            },
          ]}
        />
        <p className="text-xs text-fg-muted" aria-live="polite">
          {pendingDraft !== undefined
            ? 'Draft saving is paused until you restore or discard the draft above.'
            : (draftStatus ?? 'Changes are kept as a draft in this browser until you save.')}
        </p>
      </div>
    </FormPattern>
  );
}
