/**
 * Die Hülle der Verwaltung: Apps, Agents, Freigaben. Die Login-Seite liegt
 * außerhalb dieser Routengruppe, damit vor der Anmeldung kein Menü steht.
 *
 * Wer nicht angemeldet ist, geht auf den Login. Was jemand sieht, entscheidet
 * jede Seite selbst über das Rechtemodell; die Shell zeigt nur die Navigation.
 */

import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/actor';
import { actorFromSession } from '../../lib/session';
import { shellPlatformFor } from '../../lib/shell-nav';
import { VerwaltungShell } from './shell';

export const dynamic = 'force-dynamic';

export default async function VerwaltungLayout({ children }: { children: ReactNode }) {
  const request = new Request('http://control-plane/', { headers: await headers() });
  const user = await currentUser(request);
  if (user === null) redirect('/login');
  const platform = await shellPlatformFor(actorFromSession(user));

  return (
    <VerwaltungShell
      user={{ id: user.userId, email: user.email, groups: user.groups }}
      platform={platform}
    >
      {children}
    </VerwaltungShell>
  );
}
