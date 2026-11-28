'use client';

import { Fragment } from 'react';
import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';
import { ResolvedRefChip } from './RefChip.tsx';
import type { ResolveRef } from './platform-refs.ts';

/**
 * Klartext mit Verweisen (ADR 0023): Die App teilt den gespeicherten Text in
 * Abschnitte (`splitRefTokens` aus `@openapps/sdk`), dieser Baustein zeigt
 * Text als Text und jeden Verweis als Chip. Kein Markdown, kein HTML: Text
 * bleibt Text.
 */

export type RefTextSegment = { text: string } | { ref: string };

export interface RefTextProps {
  segments: readonly RefTextSegment[];
  resolve: ResolveRef;
  className?: string;
}

export function RefText({ segments, resolve, className }: RefTextProps): JSX.Element {
  return (
    <span className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', className)}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {'ref' in segment ? (
            <ResolvedRefChip value={segment.ref} resolve={resolve} />
          ) : (
            segment.text
          )}
        </Fragment>
      ))}
    </span>
  );
}
