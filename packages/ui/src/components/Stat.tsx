import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export interface StatProps {
  /** Was gezählt wird, kurz: „Apps live“. */
  label: string;
  /** Der Wert. Zahlen bitte schon formatiert übergeben. */
  value: ReactNode;
  /** Eine Zeile Kontext darunter: „2 with findings“. */
  hint?: ReactNode;
  /** Ton des Hinweises. Farbe verstärkt nur, der Text trägt die Aussage. */
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  /** Macht die Kachel zum Link, z. B. auf die gefilterte Liste. */
  href?: string;
  className?: string;
}

const TONE = {
  neutral: 'text-fg-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
} as const;

/**
 * Kennzahl-Kachel: Mono-Label, große Zahl in der Display-Serife, eine Zeile
 * Kontext. Mehrere Kacheln stehen in `StatGroup`, getrennt durch Haarlinien.
 */
export function Stat({ label, value, hint, tone = 'neutral', href, className }: StatProps): JSX.Element {
  const body = (
    <>
      <span className="font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">{label}</span>
      <span className="mt-2 block font-display text-4xl font-normal tabular-nums tracking-display text-fg">
        {value}
      </span>
      {hint === undefined ? null : <span className={cn('mt-1 block text-xs', TONE[tone])}>{hint}</span>}
    </>
  );
  const base = 'flex min-w-0 flex-col bg-bg px-5 py-4';
  return href === undefined ? (
    <div className={cn(base, className)}>{body}</div>
  ) : (
    <a
      href={href}
      className={cn(
        base,
        'transition-colors duration-150 hover:bg-surface outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      {body}
    </a>
  );
}

export interface StatGroupProps {
  children: ReactNode;
  className?: string;
}

/** Raster aus Kennzahlen mit Haarlinien dazwischen, auf Phone-Breite zweispaltig. */
export function StatGroup({ children, className }: StatGroupProps): JSX.Element {
  return (
    <div
      className={cn(
        'grid min-w-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}
