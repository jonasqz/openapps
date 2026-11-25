import type { HTMLAttributes, JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.ts';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

/** Tastenkürzel, z. B. `⌘K`. Mono, Haarlinie, keine Farbe. */
export function Kbd({ className, children, ...rest }: KbdProps): JSX.Element {
  return (
    <kbd
      {...rest}
      className={cn(
        'inline-flex items-center justify-center rounded-sm border border-border bg-surface px-1.5',
        'font-mono text-2xs font-medium text-fg-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
