/**
 * Loslegen: Apps mit dem eigenen Assistenten bauen und ändern. Der Inhalt
 * kommt aus `src/lib/loslegen.ts`; derselbe Text ist der MCP-Prompt
 * `get_started`.
 */

import { Card, CardBody, CardHeader } from '@openapps/ui';
import Link from 'next/link';
import { loslegenSchritte } from '../../../lib/loslegen';
import { PageHeader } from '../page-header';

export const dynamic = 'force-dynamic';

export default function LoslegenPage() {
  const schritte = loslegenSchritte();
  return (
    <section className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Get started"
        description="Your own assistant builds and changes apps for you. This is how you connect it to the platform."
      />
      <ol className="flex flex-col gap-4">
        {schritte.map((schritt, i) => (
          <li key={schritt.titel}>
            <Card>
              <CardHeader title={`${String(i + 1)}. ${schritt.titel}`} as="h2" />
              <CardBody>
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-fg-muted">{schritt.text}</p>
                  {schritt.befehle === undefined ? null : (
                    <pre className="overflow-x-auto rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-xs text-fg">
                      {schritt.befehle.join('\n')}
                    </pre>
                  )}
                  {schritt.punkte === undefined ? null : (
                    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-fg-muted">
                      {schritt.punkte.map((punkt) => (
                        <li key={punkt}>{punkt}</li>
                      ))}
                    </ul>
                  )}
                  {schritt.verweis === undefined ? null : (
                    <Link
                      href={schritt.verweis.href}
                      className="self-start text-sm font-medium text-primary underline underline-offset-4"
                    >
                      {schritt.verweis.text}
                    </Link>
                  )}
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
