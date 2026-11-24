'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import {
  FieldShell,
  FormPattern,
  controlBase,
  controlBorder,
  cn,
  describedBy,
  focusRing,
  useFieldIds,
  type FormValues,
} from '@openapps/ui';
import { LIMITS, Tags, Title, splitTags } from '@/lib/schemas';
import { createPageAction, updatePageAction, type ActionResult } from './actions';

/**
 * Anlegen und Bearbeiten einer Seite. Titel und Tags laufen durch
 * `FormPattern` (Validierung sichtbar am Feld), der Markdown-Inhalt durch ein
 * mehrzeiliges Feld in derselben `FieldShell` wie alle Felder des Design
 * Systems — `FormPattern` kennt kein mehrzeiliges Feld.
 *
 * Gespeichert wird ueber die Server Actions, die dieselben Funktionen wie die
 * Tools `pages.create` und `pages.update` rufen.
 */

export type PageFormProps =
  | {
      mode: 'create';
      parent: { id: string; title: string } | null;
    }
  | {
      mode: 'edit';
      id: string;
      initial: { title: string; tags: string[]; contentMd: string };
    };

const firstIssue = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? undefined : result.error?.issues[0]?.message;

export function PageForm(props: PageFormProps): JSX.Element {
  const router = useRouter();
  const ids = useFieldIds();
  const [content, setContent] = useState(props.mode === 'edit' ? props.initial.contentMd : '');
  const [contentError, setContentError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const cancelTarget = props.mode === 'edit' ? `/pages/${props.id}` : props.parent === null ? '/' : `/pages/${props.parent.id}`;

  const submit = async (values: FormValues): Promise<Record<string, string> | void> => {
    setFormError(undefined);
    if (content.length > LIMITS.contentMax) {
      setContentError(`Inhalt darf höchstens ${LIMITS.contentMax} Zeichen haben`);
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
      setFormError('Speichern ist fehlgeschlagen. Prüfe die Verbindung und versuche es erneut.');
      return;
    }

    if (result.ok) {
      router.push(`/pages/${result.id}`);
      router.refresh();
      return;
    }
    const { contentMd, ...fieldErrors } = result.fieldErrors ?? {};
    setContentError(contentMd);
    if (result.formError !== undefined) setFormError(result.formError);
    return fieldErrors;
  };

  return (
    <FormPattern
      title={props.mode === 'create' ? 'Neue Seite' : 'Seite bearbeiten'}
      {...(props.mode === 'create' && props.parent !== null
        ? { description: `Unterseite von „${props.parent.title}“` }
        : {})}
      fields={[
        {
          kind: 'text',
          name: 'title',
          label: 'Titel',
          required: true,
          validate: (value) => firstIssue(Title.safeParse(value)),
        },
        {
          kind: 'text',
          name: 'tags',
          label: 'Tags',
          hint: 'Durch Komma getrennt, z. B. personal, urlaub',
          validate: (value) => firstIssue(Tags.safeParse(splitTags(String(value)))),
        },
      ]}
      initialValues={
        props.mode === 'edit'
          ? { title: props.initial.title, tags: props.initial.tags.join(', ') }
          : { title: '', tags: '' }
      }
      submitLabel={props.mode === 'create' ? 'Seite anlegen' : 'Speichern'}
      onCancel={() => router.push(cancelTarget)}
      onSubmit={submit}
      {...(formError === undefined ? {} : { formError })}
    >
      <FieldShell
        inputId={ids.inputId}
        label="Inhalt (Markdown)"
        hint="# Überschrift, - Liste, **fett**, *kursiv*, `Code`, [Link](https://…)"
        hintId={ids.hintId}
        errorId={ids.errorId}
        {...(contentError === undefined ? {} : { error: contentError })}
      >
        <textarea
          id={ids.inputId}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={18}
          spellCheck
          aria-invalid={contentError !== undefined || undefined}
          aria-describedby={describedBy([ids.hintId, contentError !== undefined && ids.errorId])}
          className={cn(controlBase, controlBorder(contentError !== undefined), 'py-2 font-mono', focusRing)}
        />
      </FieldShell>
    </FormPattern>
  );
}
