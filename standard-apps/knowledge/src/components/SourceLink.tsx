import type { JSX } from 'react';
import { cn, focusRing } from '@openapps/ui';

/**
 * Herkunft eines Dokuments aus einer anderen App, etwa „from Wiki“, mit
 * Link zurueck zur Quelle (ADR 0020). Ein rohes `<a>`, kein `next/link`:
 * Das Ziel liegt in einer anderen App, und `next/link` wuerde den basePath
 * von Knowledge davorsetzen. `href` ist ein Pfad oder eine Adresse aus der
 * signierten Navigation, nie eine Eingabe aus dem Dokument.
 */
export function SourceLink({
  title,
  href,
  className,
}: {
  title: string;
  href: string;
  className?: string;
}): JSX.Element {
  return (
    <a
      href={href}
      className={cn(
        'rounded-sm font-medium text-primary underline-offset-2 hover:underline',
        focusRing,
        className,
      )}
    >
      from {title}
    </a>
  );
}
