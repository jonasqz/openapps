import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';
import { focusRing } from '../lib/focus.ts';
import { Spinner } from './Spinner.tsx';
import { strings } from '../strings.ts';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Zeigt einen Spinner, blockiert Klicks und setzt `aria-busy`. */
  loading?: boolean;
  /** Text, der während `loading` gelesen wird. */
  loadingLabel?: string;
  /** Füllt die Breite — auf Phone-Breite der Normalfall. */
  fullWidth?: boolean;
  children: ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border border-primary bg-primary text-primary-fg hover:border-primary-hover hover:bg-primary-hover',
  secondary: 'border border-border-strong bg-bg text-fg hover:border-fg hover:bg-surface',
  ghost: 'border border-transparent bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg',
  danger: 'border border-danger bg-danger text-danger-fg hover:border-danger-hover hover:bg-danger-hover',
};

/**
 * Mindesthöhe statt fester Höhe: ein sehr langer Text lässt den Knopf wachsen,
 * statt abgeschnitten zu werden.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-8 shrink-0 whitespace-nowrap px-4 py-1 text-sm gap-1.5',
  md: 'min-h-10 px-5 py-2 text-sm gap-2',
  lg: 'min-h-12 px-6 py-2.5 text-base gap-2',
};

/**
 * Die Klassen eines Knopfs, für Elemente, die wie ein Knopf aussehen, aber
 * keiner sind: vor allem Links zum Seitenwechsel (`next/link`). So kopiert
 * keine App die Optik und bleibt beim nächsten Redesign zurück.
 */
export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
}: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {}): string {
  return cn(
    'inline-flex min-w-0 items-center justify-center rounded-full font-medium',
    'transition-colors duration-150',
    focusRing,
    VARIANT[variant],
    SIZE[size],
    fullWidth && 'w-full',
  );
}

/** Klassen für einen Textverweis: Text in Vordergrundfarbe, Unterstrich in Blaugrau. */
export const textLinkClasses = cn(
  'rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4',
  'transition-colors duration-150 hover:decoration-primary',
  focusRing,
);

/**
 * Knopf als Pille: die einzige runde Form im System, damit Bedienbares sofort
 * von Flächen (eckig, Haarlinie) zu unterscheiden ist.
 *
 * Knopf. Zustände: normal, hover, fokussiert, deaktiviert, lädt.
 *
 * Sehr langer Text bricht nicht aus — der Knopf wächst in der Höhe statt die
 * Zeile zu sprengen (`whitespace-normal` plus `text-left` ab zwei Zeilen wäre
 * falsch, deshalb bleibt der Text mittig und bricht an Wortgrenzen).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    fullWidth = false,
    className,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
): JSX.Element {
  const isDisabled = disabled === true || loading;
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        buttonClasses({ variant, size, fullWidth }),
        'disabled:cursor-not-allowed disabled:opacity-50',
        'overflow-hidden',
        className,
      )}
    >
      {loading ? <Spinner size="sm" label={loadingLabel ?? strings.common.loading} /> : null}
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
    </button>
  );
});
