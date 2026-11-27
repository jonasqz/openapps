/**
 * Der Ansehen-Proxy der Apps auf 8090 (ADR 0013): Er signiert jede Anfrage
 * als `viewer@local.test` und verwirft, was der Browser an Identitaet und
 * Navigation mitschickt. Er ueberspringt die Forward-Auth, deshalb zeigt seine
 * Leiste alle deployten Apps; Freigaben prueft `gateway-access.spec.ts`.
 */

import { expect, test } from '@playwright/test';
import { forgedIdentityHeaders, forgedNavHeaders } from '../src/gateway';
import { OperatorMcp, type ListedApp } from '../src/mcp';
import { adminLink, navAppNames, sidebar, signedInAs } from '../src/shell';
import { VIEW_URL, VIEWER_EMAIL, roleEmails } from '../src/stack';

let apps: readonly ListedApp[] = [];

test.beforeAll(async () => {
  const mcp = await OperatorMcp.connect();
  try {
    apps = await mcp.deployedApps();
  } finally {
    await mcp.close();
  }
  expect(apps.length, 'needs at least two deployed apps').toBeGreaterThanOrEqual(2);
});

test('the bar lists the deployed apps and switches between them', async ({ page }) => {
  const [first, second] = [apps[0] as ListedApp, apps[1] as ListedApp];
  const response = await page.goto(`${VIEW_URL}/${first.name}`);
  expect(response?.status()).toBe(200);
  expect(await navAppNames(page, VIEW_URL)).toEqual(apps.map((a) => a.name).sort());

  await sidebar(page)
    .getByRole('navigation', { name: 'Apps' })
    .locator(`a[href="${VIEW_URL}/${second.name}"]`)
    .click();
  await page.waitForURL(`${VIEW_URL}/${second.name}**`);
  await expect(sidebar(page).locator('[aria-current="true"]').first()).toHaveAttribute(
    'href',
    `${VIEW_URL}/${second.name}`,
  );
});

test('an unknown app path is a 404, not a page', async ({ page }) => {
  const response = await page.goto(`${VIEW_URL}/e2e-no-such-app`);
  expect(response?.status()).toBe(404);
});

test('forged identity and navigation headers from the browser are dropped', async ({ page }) => {
  const app = apps[0] as ListedApp;
  await page.setExtraHTTPHeaders({
    ...forgedIdentityHeaders(roleEmails().admin),
    ...forgedNavHeaders('https://evil.invalid/'),
  });
  const response = await page.goto(`${VIEW_URL}/${app.name}`);
  expect(response?.status()).toBe(200);
  expect(await signedInAs(page)).toBe(VIEWER_EMAIL);
  await expect(adminLink(page)).toHaveCount(0);
  const hrefs = await sidebar(page)
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs.filter((href) => href.includes('evil.invalid'))).toEqual([]);
});
