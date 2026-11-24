'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
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
import { addDocumentAction } from '@/app/actions';
import { CONTENT_MAX, SOURCE_MAX, TITLE_MAX } from '@/lib/schemas';

/**
 * Formular „Dokument hinzufügen“, die UI zum Tool `documents.add`.
 *
 * Titel und Quelle fuehrt `FormPattern` selbst. Fuer den Text gibt es in
 * `@openapps/ui` noch kein mehrzeiliges Feld; er sitzt deshalb als `children`
 * im Formular, in `FieldShell` mit den Klassen der Eingabefelder, und zeigt
 * seinen Fehler wie die anderen sichtbar am Feld.
 */

function validateContent(content: string): string | undefined {
  if (content.trim() === '') return 'Bitte füge den Text des Dokuments ein.';
  if (content.length > CONTENT_MAX) return 'Der Text ist zu lang (höchstens 200.000 Zeichen).';
  return undefined;
}

export function AddDocumentForm(): JSX.Element {
  const router = useRouter();
  const ids = useFieldIds();
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
  const hasError = contentError !== undefined;

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
            String(value).trim().length > SOURCE_MAX ? `Höchstens ${SOURCE_MAX} Zeichen.` : undefined,
        },
      ]}
    >
      <FieldShell
        inputId={ids.inputId}
        label="Text"
        required
        hint={hint}
        hintId={ids.hintId}
        errorId={ids.errorId}
        {...(contentError === undefined ? {} : { error: contentError })}
      >
        <textarea
          id={ids.inputId}
          name="content"
          rows={14}
          required
          value={content}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy([ids.hintId, hasError && ids.errorId])}
          onChange={(event) => {
            setContent(event.target.value);
            if (contentTouched) setContentError(validateContent(event.target.value));
          }}
          onBlur={() => {
            setContentTouched(true);
            setContentError(validateContent(content));
          }}
          className={cn(controlBase, controlBorder(hasError), 'py-2 leading-relaxed', focusRing)}
        />
      </FieldShell>
    </FormPattern>
  );
}
