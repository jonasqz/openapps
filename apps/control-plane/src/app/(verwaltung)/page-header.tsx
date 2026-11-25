import { PageHeader as UiPageHeader, type PageHeaderCrumb } from '@openapps/ui';
import type { JSX, ReactNode } from 'react';

/**
 * Kopf einer Verwaltungsseite. Duenne Huelle um `PageHeader` aus
 * `@openapps/ui`, damit Verwaltung und Apps denselben Kopf tragen
 * (Serifentitel, Mono-Eyebrow, Haarlinie darunter).
 */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow = 'Admin',
  breadcrumbs,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
  breadcrumbs?: readonly PageHeaderCrumb[];
}): JSX.Element {
  return (
    <UiPageHeader
      title={title}
      eyebrow={eyebrow}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
      {...(breadcrumbs === undefined ? {} : { breadcrumbs })}
    />
  );
}
