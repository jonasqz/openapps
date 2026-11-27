'use client';

import { useRouter } from 'next/navigation';
import { useState, type JSX } from 'react';
import { Button, Textarea } from '@openapps/ui';
import { commentAction } from '@/app/actions';

const MAX = 5000;

/**
 * Kommentar schreiben. Tool: `tasks.comment`.
 *
 * Ein einzelnes Feld mit Knopf, kein `FormPattern`: Das Muster kennt kein
 * mehrzeiliges Feld und bringt eine eigene Ueberschrift mit. Die Pruefung ist
 * dieselbe wie im Tool (leer, hoechstens 5000 Zeichen), der Fehler steht
 * sichtbar am Feld.
 */
export function CommentBox({ taskId }: { taskId: string }): JSX.Element {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    if (body.trim() === '') {
      setError('Comment is empty.');
      return;
    }
    if (body.trim().length > MAX) {
      setError(`Comment can have at most ${MAX} characters.`);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const result = await commentAction(taskId, body);
      if (result.ok) {
        setBody('');
        router.refresh();
      } else {
        setError(result.fieldErrors.body ?? result.formError ?? 'The comment was not saved.');
      }
    } catch {
      setError('No connection to the server. Your text is still here; try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Textarea
        label="Add a comment"
        rows={3}
        value={body}
        maxLength={MAX}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void submit();
        }}
        hint="Plain text. Ctrl+Enter or ⌘+Enter sends it."
        {...(error === undefined ? {} : { error })}
      />
      <div className="flex justify-end">
        <Button size="sm" loading={pending} onClick={() => void submit()}>
          Comment
        </Button>
      </div>
    </div>
  );
}
