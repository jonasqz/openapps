'use client';

import { useState } from 'react';
import type { JSX } from 'react';
import { useRouter } from 'next/navigation';
import { FormPattern, Textarea, type FormValues } from '@openapps/ui';
import { LIMITS, Tags, Title, splitTags } from '@/lib/schemas';
import { createPageAction, updatePageAction, type ActionResult } from './actions';

/**
 * Anlegen und Bearbeiten einer Seite. Titel und Tags laufen durch
 * `FormPattern` (Validierung sichtbar am Feld), der Markdown-Inhalt durch
 * `Textarea` aus dem Design System — `FormPattern` kennt kein mehrzeiliges
 * Feld.
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
  const [content, setContent] = useState(props.mode === 'edit' ? props.initial.contentMd : '');
  const [contentError, setContentError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const cancelTarget =
    props.mode === 'edit'
      ? `/pages/${props.id}`
      : props.parent === null
        ? '/'
        : `/pages/${props.parent.id}`;

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
      setFormError('Saving failed. Check your connection and try again.');
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
      <Textarea
        label="Content (Markdown)"
        hint="# Heading, - list, **bold**, *italic*, `code`, [link](https://…)"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        rows={18}
        spellCheck
        monospace
        {...(contentError === undefined ? {} : { error: contentError })}
      />
    </FormPattern>
  );
}
