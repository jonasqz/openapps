/**
 * Die Anmeldung. Ein Satz, ein Knopf — und ein Fehlerzustand, weil der
 * haeufigste Fall nicht der gelungene Login ist, sondern die abgelehnte
 * Domain: Wer sich mit einer E-Mail ausserhalb von
 * AUTH_ALLOWED_EMAIL_DOMAINS anmeldet, wird abgewiesen und landet hier.
 *
 * Diese Seite ist in Spec 1.3 eine oeffentliche Ausnahme (`/login`). Sie
 * braucht keinen leeren Zustand, aber einen Fehlerzustand.
 */

import type { JSX } from 'react';
import { SignInWithGoogle } from './sign-in-with-google';

export const dynamic = 'force-dynamic';

/** Fehlercodes vom Rueckweg in Worte. Unbekanntes bleibt allgemein. */
const MESSAGES: Record<string, string> = {
  rejected:
    'This sign-in was rejected. Only email addresses from the domains approved ' +
    'for this instance are allowed.',
  access_denied: 'The sign-in was cancelled at Google.',
  unable_to_create_user:
    'No account is created for this email address. It is outside the ' + 'approved domains.',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Nur eigene Pfade als Rueckweg, nie eine fremde URL: sonst wird die
 * Login-Seite zur Weiterleitung fuer jeden, der einen Link verschickt.
 *
 * Offen: Der Forward-Auth schickt `?next=https://<app-host>/...`, also eine
 * absolute URL auf eine **andere** Domain. Die wird hier verworfen, und der
 * Nutzer landet nach dem Login auf `/`. Sie zuzulassen heisst,
 * `trustedOrigins` von Better Auth auf die registrierten App-Domains zu
 * setzen — eine Entscheidung, nicht eine Zeile.
 */
function safeCallback(next: string | undefined): string {
  if (next === undefined || next === '') return '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const params = (await searchParams) ?? {};
  const code = first(params.error);
  const error =
    code === undefined
      ? undefined
      : (MESSAGES[code] ??
        // Bewusst ohne "bitte erneut versuchen": Der haeufigste unbekannte
        // Code ist eine abgelehnte Domain, und da hilft ein zweiter Versuch
        // nicht. Lieber sagen, wo die Antwort liegt.
        'Sign-in failed. Check whether your address is approved for this instance, ' +
          'and otherwise contact your administrator.');

  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="max-w-prose text-sm">
        The control plane manages the apps, deployments and grants of this instance. Access goes
        through your organisation's Google account; without a grant, everything stays locked.
      </p>
      <SignInWithGoogle
        callbackUrl={safeCallback(first(params.next))}
        {...(error === undefined ? {} : { initialError: error })}
      />
    </section>
  );
}
