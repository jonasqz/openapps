import type { JSX, ReactNode } from 'react';
import { Badge, EmptyState, ErrorState } from '@openapps/ui';
import type { Activity } from '@/lib/crm';
import { ACTIVITY_KIND_LABELS } from '@/lib/domain';
import { formatDateTime } from '@/lib/format';
import { TextLink } from './links';
import { CrmRefText } from './Refs';

/**
 * Zeitleiste: Aktivitaeten, neueste zuerst. Serverfaehig, ohne Funktionen.
 * Dieselben Eintraege liefern `activities.list` und die `*.get`-Tools.
 *
 * `hide` blendet den Bezug aus, auf dessen Seite die Zeitleiste steht (auf der
 * Deal-Seite muss nicht an jedem Eintrag der Deal stehen).
 */
export function Timeline({
  activities,
  failed = false,
  hide = [],
  emptyAction,
}: {
  activities: readonly Activity[];
  failed?: boolean;
  hide?: readonly ('deal' | 'contact' | 'company')[];
  emptyAction?: ReactNode;
}): JSX.Element {
  if (failed) {
    return (
      <ErrorState
        title="Timeline could not be loaded"
        description="The database did not respond. Reload the page."
      />
    );
  }
  if (activities.length === 0) {
    return (
      <EmptyState
        title="Nothing logged yet"
        description="Log a note, a call, an email or a meeting. Stage changes and finished next steps appear here on their own."
        {...(emptyAction === undefined ? {} : { action: emptyAction })}
      />
    );
  }
  return (
    <ol className="flex min-w-0 flex-col">
      {activities.map((activity) => (
        <li key={activity.id} className="min-w-0 border-l border-border-strong pb-5 pl-4 last:pb-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge>{ACTIVITY_KIND_LABELS[activity.kind]}</Badge>
            <CrmRefText text={activity.subject} className="text-sm font-medium text-fg" />
          </div>
          {activity.body === null ? null : (
            <p className="mt-2 text-sm text-fg">
              <CrmRefText text={activity.body} />
            </p>
          )}
          <p className="mt-2 flex min-w-0 flex-wrap gap-x-2 text-xs text-fg-muted [overflow-wrap:anywhere]">
            <span>{formatDateTime(activity.happenedAt)}</span>
            {!hide.includes('company') && activity.companyId !== null && activity.companyName !== null ? (
              <TextLink href={`/companies/${activity.companyId}`}>{activity.companyName}</TextLink>
            ) : null}
            {!hide.includes('contact') && activity.contactId !== null && activity.contactName !== null ? (
              <TextLink href={`/contacts/${activity.contactId}`}>{activity.contactName}</TextLink>
            ) : null}
            {!hide.includes('deal') && activity.dealId !== null && activity.dealTitle !== null ? (
              <TextLink href={`/deals/${activity.dealId}`}>{activity.dealTitle}</TextLink>
            ) : null}
            <span>{`by ${activity.createdBy}`}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}
