import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';

export interface SkeletonProps {
  /** Breite und Höhe über Klassen, z. B. `h-4 w-1/2`. */
  className?: string;
}

/**
 * Platzhalter, solange Daten laden. Rein dekorativ: Den Ladezustand nennt
 * ein `Spinner` mit Text oder `aria-busy` am Container.
 */
export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn('block h-4 w-full animate-pulse rounded-sm bg-surface-muted', className)}
    />
  );
}
