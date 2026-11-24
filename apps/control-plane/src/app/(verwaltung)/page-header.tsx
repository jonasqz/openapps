import type { JSX, ReactNode } from 'react';

/** Kopf einer Verwaltungsseite, in derselben Form wie die Seiten der Apps. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {actions}
    </header>
  );
}
