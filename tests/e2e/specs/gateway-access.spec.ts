/**
 * Der echte Weg: Browser -> Traefik -> Forward-Auth -> App, auf
 * `https://apps.local.test:8443`. Default-Deny, Freigabe, Widerruf, die
 * Leiste nach Freigaben und gefaelschte Header.
 *
 * Die Person ist `user@<erste erlaubte Domain>`, dieselbe wie die Rolle
 * `user` auf 8091. Freigaben setzt und entzieht `operator` ueber den
 * Plattform-MCP. Jede Freigabe, die dieser Test vergibt, nimmt er am Ende
 * zurueck, auch wenn ein Schritt scheitert.
 */

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { forgedIdentityHeaders, forgedNavHeaders, gatewayGet } from '../src/gateway';
import { OperatorMcp, type ListedApp } from '../src/mcp';
import { mintUserSession, type MintedSession } from '../src/session';
import { adminLink, navAppNames, signedInAs } from '../src/shell';
import { ADMIN_URL, APPS_HOST, CP_HOST, GATEWAY_URL, VIEW_URL, roleEmails } from '../src/stack';

/** So bildet die Forward-Auth die Links der Leiste (`visibleAppsFor`). */
const GATEWAY_NAV_ORIGIN = `https://${APPS_HOST}`;

test.describe.configure({ mode: 'serial' });

let mcp: OperatorMcp;
let session: MintedSession;
let appA: ListedApp;
let appB: ListedApp;
const granted = new Map<string, string>();

async function withSession(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: session.cookieName,
      value: session.cookieValue,
      domain: APPS_HOST,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function open(page: Page, app: ListedApp): Promise<number> {
  const response = await page.goto(`${GATEWAY_URL}/${app.name}`);
  return response?.status() ?? 0;
}

async function grant(app: ListedApp): Promise<void> {
  granted.set(app.name, await mcp.grantAppRead(session.userId, app.name));
}

async function revoke(app: ListedApp): Promise<void> {
  const id = granted.get(app.name);
  if (id === undefined) throw new Error(`no grant on ${app.name} to revoke`);
  await mcp.revoke(id);
  granted.delete(app.name);
}

/** Was die Verwaltung (8091) der Rolle `user` in der Leiste zeigt. */
async function adminNavAsUser(page: Page): Promise<string[]> {
  await page.goto(`${ADMIN_URL}/_local/as/user`);
  return navAppNames(page, VIEW_URL);
}

test.beforeAll(async () => {
  mcp = await OperatorMcp.connect();
  session = await mintUserSession();
  expect(session.email).toBe(roleEmails().user);

  // Die Person darf vorher nichts. Sonst prueft der Test nicht Default-Deny,
  // sondern einen Rest aus einem frueheren Lauf.
  const existing = await mcp.activeGrantsOfUser(session.userId);
  expect(
    existing.map((g) => `${g.verb} ${g.resource.kind}:${g.resource.id}`),
    `${session.email} must start without grants; revoke them first`,
  ).toEqual([]);

  const apps = await mcp.deployedApps();
  expect(apps.length, 'needs at least two deployed apps').toBeGreaterThanOrEqual(2);
  [appA, appB] = [apps[0] as ListedApp, apps[1] as ListedApp];
});

test.afterAll(async () => {
  for (const id of granted.values()) {
    await mcp?.revoke(id).catch(() => undefined);
  }
  granted.clear();
  await mcp?.close();
});

test('without a session the gateway redirects to the login, also with forged headers', async () => {
  const plain = await gatewayGet(`/${appA.name}`);
  expect(plain.status).toBe(302);
  expect(plain.location ?? '').toContain(`${CP_HOST}/login`);

  const forged = await gatewayGet(`/${appA.name}`, {
    ...forgedIdentityHeaders(roleEmails().admin),
    ...forgedNavHeaders('https://evil.invalid/'),
  });
  expect(forged.status).toBe(302);
  expect(forged.location ?? '').toContain(`${CP_HOST}/login`);
});

test('in the browser, forged identity headers without a session end at the login', async ({
  page,
}) => {
  // Die Login-Seite selbst ist lokal nicht erreichbar (Port 443 statt 8443),
  // und Playwright faengt das Ziel einer Weiterleitung nicht ab. Gezaehlt
  // wird deshalb die Antwort des Gateways auf die Seite selbst.
  const target = `${GATEWAY_URL}/${appA.name}`;
  const answer = page.waitForResponse((response) => response.url() === target);
  await page.setExtraHTTPHeaders(forgedIdentityHeaders(roleEmails().admin));
  await page.goto(target).catch(() => undefined);
  const response = await answer;
  expect(response.status()).toBe(302);
  const location = new URL(response.headers()['location'] ?? '');
  expect(location.host).toBe(CP_HOST);
  expect(location.pathname).toBe('/login');
});

test('an app without a grant is rejected', async ({ page, context }) => {
  await withSession(context);
  expect(await open(page, appA)).toBe(403);
  expect(await open(page, appB)).toBe(403);
  // Auch die Leiste der Verwaltung zeigt dann keine App.
  const adminNav = await adminNavAsUser(page);
  expect(adminNav).not.toContain(appA.name);
  expect(adminNav).not.toContain(appB.name);
});

test('a grant opens exactly that app, and the bar lists only it', async ({ page, context }) => {
  await grant(appA);
  await withSession(context);

  expect(await open(page, appA)).toBe(200);
  expect(await signedInAs(page)).toBe(session.email);
  expect(await navAppNames(page, GATEWAY_NAV_ORIGIN)).toEqual([appA.name]);
  await expect(adminLink(page)).toHaveCount(0);

  expect(await open(page, appB)).toBe(403);
  expect(await adminNavAsUser(page)).toEqual([appA.name]);
});

test('with a second grant the bar lists both, and switching works', async ({ page, context }) => {
  await grant(appB);
  await withSession(context);

  expect(await open(page, appA)).toBe(200);
  expect(await navAppNames(page, GATEWAY_NAV_ORIGIN)).toEqual([appA.name, appB.name].sort());

  // Die Leiste verlinkt die andere App unter der Adresse des Gateways. Lokal
  // haengt Traefik an 8443 statt 443, deshalb mit Port nachgegangen.
  const link = page
    .getByRole('complementary', { name: 'Sidebar' })
    .getByRole('navigation', { name: 'Apps' })
    .locator(`a[href="${GATEWAY_NAV_ORIGIN}/${appB.name}"]`);
  await expect(link).toHaveCount(1);
  const response = await page.goto(`${GATEWAY_URL}/${appB.name}`);
  expect(response?.status()).toBe(200);
  expect(await navAppNames(page, GATEWAY_NAV_ORIGIN)).toEqual([appA.name, appB.name].sort());
  const current = page
    .getByRole('complementary', { name: 'Sidebar' })
    .locator('[aria-current="true"]');
  await expect(current.first()).toHaveAttribute('href', `${GATEWAY_NAV_ORIGIN}/${appB.name}`);
});

test('forged identity and navigation headers are not believed', async ({ page, context }) => {
  await withSession(context);
  await page.setExtraHTTPHeaders({
    ...forgedIdentityHeaders(roleEmails().admin),
    ...forgedNavHeaders('https://evil.invalid/'),
  });

  expect(await open(page, appA)).toBe(200);
  expect(await signedInAs(page)).toBe(session.email);
  await expect(adminLink(page)).toHaveCount(0);
  const hrefs = await page
    .getByRole('complementary', { name: 'Sidebar' })
    .locator('a[href]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  expect(hrefs.filter((href) => href.includes('evil.invalid'))).toEqual([]);
  expect(await navAppNames(page, GATEWAY_NAV_ORIGIN)).toEqual([appA.name, appB.name].sort());
});

test('revoking takes effect on the next request', async ({ page, context }) => {
  await withSession(context);
  expect(await open(page, appA)).toBe(200);

  await revoke(appA);
  expect(await open(page, appA)).toBe(403);

  // Die andere Freigabe gilt weiter, und die Leiste kennt A nicht mehr.
  expect(await open(page, appB)).toBe(200);
  expect(await navAppNames(page, GATEWAY_NAV_ORIGIN)).toEqual([appB.name]);
  expect(await adminNavAsUser(page)).toEqual([appB.name]);

  // Gefaelschte Header helfen nach dem Widerruf auch nicht.
  await page.setExtraHTTPHeaders(forgedIdentityHeaders(roleEmails().admin));
  expect(await open(page, appA)).toBe(403);

  await revoke(appB);
  await page.setExtraHTTPHeaders({});
  expect(await open(page, appB)).toBe(403);
  expect(await adminNavAsUser(page)).toEqual([]);
});
