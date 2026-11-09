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
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-hover',
  ghost: 'bg-transparent text-fg hover:bg-surface-hover',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover',
};

/**
 * Mindesthöhe statt fester Höhe: ein sehr langer Text lässt den Knopf wachsen,
 * statt abgeschnitten zu werden.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 py-1 text-sm gap-1.5',
  md: 'min-h-10 px-4 py-2 text-sm gap-2',
  lg: 'min-h-12 px-6 py-2.5 text-base gap-2',
};

/**
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
        'inline-flex min-w-0 items-center justify-center rounded-md font-medium',
        'transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'overflow-hidden',
        focusRing,
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? <Spinner size="sm" label={loadingLabel ?? strings.common.loading} /> : null}
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
    </button>
  );
});
