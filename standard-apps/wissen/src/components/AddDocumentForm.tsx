'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { FormPattern, Textarea, type FormValues } from '@openapps/ui';
import { addDocumentAction } from '@/app/actions';
import { CONTENT_MAX, SOURCE_MAX, TITLE_MAX } from '@/lib/schemas';

/**
 * Formular „Dokument hinzufügen“, die UI zum Tool `documents.add`.
 *
 * Titel und Quelle fuehrt `FormPattern` selbst. Der Text ist ein `Textarea`
 * als `children` im Formular und zeigt seinen Fehler wie die anderen sichtbar
 * am Feld.
 */

function validateContent(content: string): string | undefined {
  if (content.trim() === '') return 'Bitte füge den Text des Dokuments ein.';
  if (content.length > CONTENT_MAX) return 'Der Text ist zu lang (höchstens 200.000 Zeichen).';
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
      setFormError('Der Text fehlt noch oder ist zu lang.');
      return;
    }

    const result = await addDocumentAction({
      title: String(values.title ?? ''),
      source: String(values.source ?? ''),
      content,
    });
    if (result.ok) {
      router.push(`/dokumente/${result.id}`);
      router.refresh();
      return;
    }
    if (result.formError !== undefined) setFormError(result.formError);
    const { content: serverContentError, ...fieldErrors } = result.fieldErrors ?? {};
    if (serverContentError !== undefined) setContentError(serverContentError);
    return fieldErrors;
  };

  const hint = 'Klartext. Trenne Absätze durch eine Leerzeile, dann wird an Absatzgrenzen zerlegt.';

  return (
    <FormPattern
      title="Dokument hinzufügen"
      description="Das Dokument wird in Abschnitte zerlegt und ist danach sofort über die Suche auffindbar."
      submitLabel="Dokument speichern"
      onCancel={() => router.push('/dokumente')}
      onSubmit={submit}
      {...(formError === undefined ? {} : { formError })}
      fields={[
        {
          name: 'title',
          label: 'Titel',
          kind: 'text',
          required: true,
          placeholder: 'z. B. Reisekostenrichtlinie',
          validate: (value) =>
            String(value).trim().length > TITLE_MAX ? `Höchstens ${TITLE_MAX} Zeichen.` : undefined,
        },
        {
          name: 'source',
          label: 'Quelle',
          kind: 'text',
          hint: 'Woher das Dokument stammt, z. B. eine URL oder „Handbuch v3“. Optional.',
          validate: (value) =>
            String(value).trim().length > SOURCE_MAX
              ? `Höchstens ${SOURCE_MAX} Zeichen.`
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
