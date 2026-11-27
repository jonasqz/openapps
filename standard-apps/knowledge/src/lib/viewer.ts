import { getNavigation, getReadableApps } from '@openapps/sdk';
import { headers } from 'next/headers';
import type { Visibility } from './visibility';

/**
 * Was die Seiten ueber den Betrachter wissen muessen, aus den signierten
 * Headern der Plattform: welche Apps er lesen darf (ADR 0020) und, nur zur
 * Anzeige, Titel und Adresse dieser Apps aus der Navigation (ADR 0017).
 *
 * Nur im Server aufrufen. Wirft wegen der Header nie: ohne gueltige Liste
 * nur Dokumente ohne Quell-App, ohne Navigation der App-Name als Titel.
 * `headers()` steht bewusst nicht im try/catch (ADR 0019).
 */
export interface SourceAppInfo {
  readonly title: string;
  /** Adresse der App ohne abschliessenden Schraegstrich. */
  readonly href: string;
}

export interface Viewer {
  readonly visibility: Visibility;
  readonly sourceApps: ReadonlyMap<string, SourceAppInfo>;
}

export async function currentViewer(): Promise<Viewer> {
  const requestHeaders = await headers();
  const readableApps = getReadableApps(requestHeaders);
  const nav = getNavigation(requestHeaders);
  const sourceApps = new Map<string, SourceAppInfo>();
  for (const app of nav?.apps ?? []) {
    sourceApps.set(app.name, { title: app.title, href: app.href.replace(/\/+$/, '') });
  }
  return { visibility: { readableApps }, sourceApps };
}

/**
 * Titel und Link einer Quell-App fuer die Anzeige. Ohne Navigation ein
 * Pfad auf derselben Domain (`/<app>`), wie alle Apps liegen (ADR 0007).
 */
export function sourceAppDisplay(
  viewer: Viewer,
  sourceApp: string,
  sourcePath: string | null,
): { title: string; href: string } {
  const info = viewer.sourceApps.get(sourceApp);
  const base = info?.href ?? `/${sourceApp}`;
  const title = info?.title ?? sourceApp.charAt(0).toUpperCase() + sourceApp.slice(1);
  return { title, href: `${base}${sourcePath ?? ''}` };
}
