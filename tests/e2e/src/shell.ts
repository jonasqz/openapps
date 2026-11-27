/**
 * Lesen der gemeinsamen Leiste (`PlatformShell`, ADR 0017). Nur ueber das,
 * was die Leiste jeder App gleich rendert: die Seitenleiste
 * (`aria-label="Sidebar"`), darin die Navigation `Apps`, das Kontomenue.
 * Nichts haengt am Inhalt einer App.
 */

import type { Locator, Page } from '@playwright/test';

export function sidebar(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Sidebar' });
}

/**
 * Die Namen der Apps, die die Leiste verlinkt. Gezaehlt werden nur absolute
 * Links auf `<appsOrigin>/<name>`, so wie Gateway und Ansehen-Proxy sie
 * bilden. Eigene Bereiche einer App sind relativ und fallen heraus.
 */
export async function navAppNames(page: Page, appsOrigin: string): Promise<string[]> {
  const nav = sidebar(page).getByRole('navigation', { name: 'Apps' });
  await nav.waitFor();
  const hrefs = await nav
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  const origin = appsOrigin.replace(/\/+$/, '');
  const names = new Set<string>();
  for (const href of hrefs) {
    if (!href.startsWith(`${origin}/`)) continue;
    const match = /^\/([a-z][a-z0-9-]{1,40})\/?$/.exec(href.slice(origin.length));
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names].sort();
}

/** Die Adresse, die das Kontomenue nennt (`Account menu, signed in as …`). */
export async function signedInAs(page: Page): Promise<string> {
  const button = sidebar(page).getByRole('button', { name: /^Account menu, signed in as / });
  const label = (await button.getAttribute('aria-label')) ?? '';
  return label.replace(/^Account menu, signed in as /, '');
}

/**
 * Der Link `Admin` im Fuss der Leiste. Es gibt ihn nur, wenn die Plattform
 * die Person als Administrator meldet; die aktuelle App heisst in der
 * Verwaltung ebenfalls „Admin", ist aber kein Link (`aria-current`).
 */
export function adminLink(page: Page): Locator {
  return sidebar(page)
    .getByRole('link', { name: 'Admin', exact: true })
    .and(page.locator(':not([aria-current])'));
}
