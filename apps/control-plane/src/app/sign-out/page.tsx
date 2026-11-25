'use client';

/**
 * Abmelden als Seite (ADR 0017). Die Leiste jeder App verlinkt hierher, weil
 * sie selbst kein Cookie der Control Plane hat und kein POST an einen fremden
 * Host schicken soll. Diese Seite liegt auf dem Host der Control Plane und
 * ruft Better Auth von dort. Danach geht es zum Login.
 */

import { ErrorState, Spinner } from '@openapps/ui';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

export default function SignOutPage(): JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void fetch('/api/auth/sign-out', { method: 'POST' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        window.location.assign('/login');
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-4 text-fg">
      {failed ? (
        <ErrorState
          title="Sign-out failed"
          description="Your session could not be ended. Reload the page to try again."
        />
      ) : (
        <Spinner label="Signing out…" className="text-sm text-fg-muted" />
      )}
    </main>
  );
}
