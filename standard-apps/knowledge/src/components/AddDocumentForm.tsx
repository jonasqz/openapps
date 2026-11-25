'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { FormPattern, Textarea, type FormValues } from '@openapps/ui';
import { addDocumentAction } from '@/app/actions';
import { CONTENT_MAX, SOURCE_MAX, TITLE_MAX } from '@/lib/schemas';

/**
 * Formular „Add document“, die UI zum Tool `documents.add`.
 *
 * Titel und Quelle fuehrt `FormPattern` selbst. Der Text ist ein `Textarea`
 * als `children` im Formular und zeigt seinen Fehler wie die anderen sichtbar
 * am Feld.
 */

function validateContent(content: string): string | undefined {
  if (content.trim() === '') return 'Paste the text of the document.';
  if (content.length > CONTENT_MAX) return 'The text is too long (at most 200,000 characters).';
  return undefined;
}

export function AddDocumentForm(): JSX.Element {
  const router = useRouter();
  const [content, setContent] = useState('');
  const [contentTouched, setContentTouched] = useState(false);
  const [contentError, setContentError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const submit = async (values: FormValues): Promise<Record<string, string> | void> => {
    setFormError(undefined);
    const localContentError = validateContent(content);
    setContentTouched(true);
    setContentError(localContentError);
    if (localContentError !== undefined) {
      setFormError('The text is missing or too long.');
      return;
    }

    const result = await addDocumentAction({
      title: String(values.title ?? ''),
      source: String(values.source ?? ''),
      content,
    });
    if (result.ok) {
      router.push(`/documents/${result.id}`);
      router.refresh();
      return;
    }
    if (result.formError !== undefined) setFormError(result.formError);
    const { content: serverContentError, ...fieldErrors } = result.fieldErrors ?? {};
    if (serverContentError !== undefined) setContentError(serverContentError);
    return fieldErrors;
  };

  const hint =
    'Plain text. Separate paragraphs with a blank line so the split happens at paragraph breaks.';

  return (
    <FormPattern
      title="Add document"
      description="The document is split into sections and can be found through search right away."
      submitLabel="Save document"
      onCancel={() => router.push('/documents')}
      onSubmit={submit}
      {...(formError === undefined ? {} : { formError })}
      fields={[
        {
          name: 'title',
          label: 'Title',
          kind: 'text',
          required: true,
          placeholder: 'e.g. Travel expense policy',
          validate: (value) =>
            String(value).trim().length > TITLE_MAX
              ? `At most ${TITLE_MAX} characters.`
              : undefined,
        },
        {
          name: 'source',
          label: 'Source',
          kind: 'text',
          hint: 'Where the document comes from, e.g. a URL or “Handbook v3”. Optional.',
          validate: (value) =>
            String(value).trim().length > SOURCE_MAX
              ? `At most ${SOURCE_MAX} characters.`
              : undefined,
        },
      ]}
    >
      <Textarea
        label="Text"
        name="content"
        required
        hint={hint}
        rows={14}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          if (contentTouched) setContentError(validateContent(event.target.value));
        }}
        onBlur={() => {
          setContentTouched(true);
          setContentError(validateContent(content));
        }}
        {...(contentError === undefined ? {} : { error: contentError })}
      />
    </FormPattern>
  );
}
