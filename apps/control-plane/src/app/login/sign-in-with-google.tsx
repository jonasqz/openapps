'use client';

/**
 * Der Knopf. Er ruft denselben Endpunkt, den auch ein Agent rufen wuerde
 * (`POST /api/auth/sign-in/social`), und folgt der zurueckgegebenen URL zu
 * Google. Kein eigener Auth-Code: die Entscheidung trifft Better Auth.
 *
 * Fehlerzustand statt stiller Rueckkehr: eine abgelehnte Domain, ein
 * abgebrochener Login oder ein Netzfehler landen sichtbar im `ErrorState`.
 */

import { Button, ErrorState } from '@openapps/ui';
import { useState } from 'react';
import type { JSX } from 'react';

export interface SignInWithGoogleProps {
  /** Wohin nach dem Login. Kommt vom Forward-Auth als `?next=`. */
  readonly callbackUrl: string;
  /** Fehler aus dem Rueckweg (`/login?error=...`), schon in Worten. */
  readonly initialError?: string;
}

export function SignInWithGoogle({
  callbackUrl,
  initialError,
}: SignInWithGoogleProps): JSX.Element {
  const [error, setError] = useState<string | undefined>(initialError);
  const [pending, setPending] = useState(false);

  async function start(): Promise<void> {
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: callbackUrl,
          // Scheitert der Rueckweg — etwa weil die Domain nicht zugelassen
          // ist —, landet der Nutzer wieder hier, mit Grund.
          errorCallbackURL: '/login?error=abgelehnt',
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const url =
        typeof payload === 'object' && payload !== null && 'url' in payload
          ? (payload as { url?: unknown }).url
          : undefined;

      if (!response.ok || typeof url !== 'string' || url === '') {
        setError(
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message?: unknown }).message)
            : 'Die Anmeldung konnte nicht gestartet werden.',
        );
        setPending(false);
        return;
      }
      window.location.assign(url);
    } catch {
      setError('Die Anmeldung konnte nicht gestartet werden. Netzwerkfehler.');
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error === undefined ? null : (
        <ErrorState
          title="Anmeldung nicht möglich"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void start()}>
              Erneut versuchen
            </Button>
          }
        />
      )}
      <Button loading={pending} loadingLabel="Weiterleitung zu Google" onClick={() => void start()}>
        Mit Google anmelden
      </Button>
    </div>
  );
}
