import type { JSX, ReactNode } from 'react';
import { Card, CardBody, CardHeader } from '@openapps/ui';

/**
 * Eigenschaften eines Datensatzes als Label/Wert-Liste in einer Karte, fuer
 * die rechte Spalte der Detailseiten. `null` und leere Werte zeigen "–".
 */
export function Properties({
  title,
  items,
}: {
  title: string;
  items: readonly { label: string; value: ReactNode }[];
}): JSX.Element {
  return (
    <Card>
      <CardHeader as="h2" title={title} />
      <CardBody>
        <dl className="grid min-w-0 gap-3">
          {items.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="font-mono text-2xs font-medium uppercase tracking-label text-fg-muted">{item.label}</dt>
              <dd className="mt-0.5 text-sm text-fg [overflow-wrap:anywhere]">
                {item.value === null || item.value === undefined || item.value === '' ? '–' : item.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
