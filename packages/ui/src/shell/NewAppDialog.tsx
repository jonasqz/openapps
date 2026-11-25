'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Button } from '../components/Button.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { Input } from '../components/Input.tsx';
import { Textarea } from '../components/Textarea.tsx';
import { useToast } from '../components/Toast.tsx';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { strings } from '../strings.ts';
import { NEW_APP_COMMAND, newAppCommand } from './platform.ts';

export interface NewAppDialogProps {
  open: boolean;
  onClose: () => void;
  /** `${platformUrl}/get-started`. `null` blendet den Link aus. */
  getStartedHref: string | null;
}

/**
 * „New app“ legt nichts an. Der Dialog baut nur den Befehl fuer den eigenen
 * Assistenten; anlegen bleibt `create_app` (ADR 0017, CLAUDE.md 1).
 */
export function NewAppDialog({ open, onClose, getStartedHref }: NewAppDialogProps): JSX.Element | null {
  const toast = useToast();
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const commandRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const command = newAppCommand(name, purpose);

  // Jedes Oeffnen beginnt leer, damit kein halber Entwurf von gestern steht.
  // Fokus ins erste Feld: Der Dialog setzt ihn sonst auf „Schliessen“. Der
  // Effekt des Dialogs (Kind) laeuft vorher und merkt sich den Ausloeser.
  useEffect(() => {
    if (open) {
      nameRef.current?.focus();
    } else {
      setName('');
      setPurpose('');
    }
  }, [open]);

  const selectCommand = (): void => {
    const node = commandRef.current;
    const selection = typeof window === 'undefined' ? null : window.getSelection();
    if (node === null || selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = useCallback(async (): Promise<void> => {
    if (command === null) return;
    let copied = false;
    try {
      // Ohne sicheren Kontext (http) gibt es keine Zwischenablage.
      if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
        await navigator.clipboard.writeText(command);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!copied) {
      // Zweiter Weg fuer Browser, die die Zwischenablage verweigern (eingebettete
      // Vorschau, http): markieren und den alten Kopierbefehl versuchen. Bleibt
      // markiert, falls auch das scheitert — dann kopiert die Person selbst.
      selectCommand();
      try {
        copied = typeof document.execCommand === 'function' && document.execCommand('copy');
      } catch {
        copied = false;
      }
    }
    if (copied) {
      toast.show({ title: strings.platformShell.copied, description: strings.platformShell.copiedDescription, tone: 'success' });
      return;
    }
    toast.show({
      title: strings.platformShell.copyFailed,
      description: strings.platformShell.copyFailedDescription,
      tone: 'warning',
    });
  }, [command, toast]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={strings.platformShell.newAppTitle}
      description={strings.platformShell.newAppDescription}
      footer={
        <div className="flex w-full min-w-0 flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {getStartedHref === null ? (
            <span />
          ) : (
            <a
              href={getStartedHref}
              className={cn(
                'min-w-0 rounded-sm text-sm text-fg-muted underline decoration-border-strong underline-offset-4',
                'hover:text-fg hover:decoration-fg',
                focusRing,
              )}
            >
              {strings.platformShell.newAppConnect}
            </a>
          )}
          <Button onClick={() => void copy()} disabled={command === null}>
            <span className="inline-flex items-center gap-2 align-middle">
              <CopyIcon />
              {strings.platformShell.copy}
            </span>
          </Button>
        </div>
      }
    >
      <form
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void copy();
        }}
      >
        <Input
          ref={nameRef}
          label={strings.platformShell.newAppName}
          hint={strings.platformShell.newAppNameHint}
          value={name}
          maxLength={80}
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          label={strings.platformShell.newAppPurpose}
          placeholder={strings.platformShell.newAppPurposePlaceholder}
          value={purpose}
          rows={4}
          maxLength={2000}
          required
          onChange={(event) => setPurpose(event.target.value)}
        />
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">
            {strings.platformShell.newAppCommand}
          </p>
          <div className="min-w-0 rounded-lg border border-border bg-surface px-3 py-2.5">
            <code
              ref={commandRef}
              data-testid="oa-new-app-command"
              className={cn(
                'block min-w-0 whitespace-pre-wrap font-mono text-sm [overflow-wrap:anywhere]',
                command === null ? 'text-fg-subtle' : 'text-fg',
              )}
            >
              {command ?? `${NEW_APP_COMMAND} ${strings.platformShell.newAppCommandEmpty}`}
            </code>
          </div>
          <p className="text-xs text-fg-muted">{strings.platformShell.newAppExplanation}</p>
        </div>
      </form>
    </Dialog>
  );
}

function CopyIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h.5" strokeLinecap="round" />
    </svg>
  );
}
