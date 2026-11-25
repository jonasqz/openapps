/**
 * Die Leiste der Verwaltung (ADR 0017). Apps bekommen ihre Navigation als
 * signierten Header vom Gateway; die Verwaltung ist selbst die Quelle und
 * fragt die Domaene direkt.
 *
 * Im lokalen Betrieb (`OPENAPPS_BACKEND=lokal`) zeigen die Links auf die
 * beiden Proxys am Loopback (ADR 0013, 0014), nicht auf die Hosts, die es
 * nur auf einem Server gibt. Dieselben Adressen wie in `lokal-ansehen.ts`.
 */

import type { ShellPlatform } from '@openapps/ui';
import { appPathFor, platformNavFor } from '../domain';
import type { Actor } from '../domain/types';
import { DEFAULT_ANSICHT_ORIGIN, DEFAULT_ANSICHT_PLATFORM_URL } from '../infra/lokal-ansehen';
import { readEnv } from './env';
import { domainContext } from './runtime';

export async function shellPlatformFor(actor: Actor): Promise<ShellPlatform | null> {
  try {
    const nav = await platformNavFor(domainContext(), actor, {
      controlPlaneHost: readEnv().controlPlaneHost,
    });
    const { v: _v, ...platform } = nav;
    if (process.env.OPENAPPS_BACKEND !== 'lokal') return platform;

    const origin = (process.env.ANSEHEN_ORIGIN ?? DEFAULT_ANSICHT_ORIGIN).replace(/\/+$/, '');
    return {
      ...platform,
      platformUrl: process.env.ANSEHEN_PLATFORM_URL ?? DEFAULT_ANSICHT_PLATFORM_URL,
      apps: platform.apps.map((app) => ({ ...app, href: `${origin}${appPathFor(app.name)}` })),
    };
  } catch {
    // Die Leiste ist Anzeige. Faellt sie aus, steht die Verwaltung trotzdem.
    return null;
  }
}
