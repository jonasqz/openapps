/**
 * Die Verwaltung (Control Plane) ueber den Ansehen-Proxy auf 8091 (ADR 0014):
 * als `admin` erreichbar und mit Admin-Bereich, als `user` ohne. Gelesen wird
 * nur, was die Leiste und `/settings` jeder Person zeigen, plus die Antwort
 * der API auf schreibende Versuche.
 */

import { expect, test, type Page } from '@playwright/test';
import { OperatorMcp } from '../src/mcp';
import { adminLink, signedInAs } from '../src/shell';
import { ADMIN_URL, roleEmails } from '../src/stack';

const emails = roleEmails();

async function asRole(page: Page, role: 'admin' | 'user'): Promise<void> {
  const response = await page.goto(`${ADMIN_URL}/_local/as/${role}`);
  expect(response?.status(), `switching to ${role}`).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/');
}

test.describe('admin area as admin', () => {
  test('is reachable and shows the admin link', async ({ page }) => {
    await asRole(page, 'admin');
    expect(await signedInAs(page)).toBe(emails.admin);
    await expect(adminLink(page)).toHaveCount(1);
  });

  test('settings show the signed-in person', async ({ page }) => {
    await asRole(page, 'admin');
    const response = await page.goto(`${ADMIN_URL}/settings`);
    expect(response?.status()).toBe(200);
    // Im Inhalt, nicht nur im Kontomenue der Leiste.
    await expect(page.getByRole('main')).toContainText(emails.admin);
  });

  test('a write request from a foreign origin is rejected', async ({ page }) => {
    await asRole(page, 'admin');
    const response = await page.request.post(`${ADMIN_URL}/api/grants`, {
      headers: { origin: 'https://evil.invalid' },
      data: {
        subjectKind: 'user',
        subjectId: 'e2e-foreign-origin',
        verb: 'read',
        resourceKind: 'app',
        resourceId: '*',
      },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
  });
});

test.describe('admin area as user without grants', () => {
  test('shows no admin link', async ({ page }) => {
    await asRole(page, 'user');
    expect(await signedInAs(page)).toBe(emails.user);
    await expect(adminLink(page)).toHaveCount(0);
  });

  test('settings show the user, not the admin', async ({ page }) => {
    await asRole(page, 'user');
    const response = await page.goto(`${ADMIN_URL}/settings`);
    expect(response?.status()).toBe(200);
    const main = page.getByRole('main');
    await expect(main).toContainText(emails.user);
    await expect(main).not.toContainText(emails.admin);
  });

  test('cannot grant itself access or create agents through the API', async ({ page }) => {
    await asRole(page, 'user');
    const own = { origin: ADMIN_URL };

    const grant = await page.request.post(`${ADMIN_URL}/api/grants`, {
      headers: own,
      data: {
        subjectKind: 'user',
        subjectId: 'e2e-self-grant',
        verb: 'read',
        resourceKind: 'app',
        resourceId: '*',
      },
      maxRedirects: 0,
    });
    const agentName = `e2e-denied-${Date.now().toString(36)}`;
    const agent = await page.request.post(`${ADMIN_URL}/api/agents`, {
      headers: own,
      data: { name: agentName },
      maxRedirects: 0,
    });

    // Ging doch etwas durch, wird es sofort zurueckgenommen, bevor der Test
    // scheitert: Ein offener Fehler darf keine Freigabe im Stapel lassen.
    if (grant.ok() || agent.ok()) {
      const mcp = await OperatorMcp.connect();
      try {
        if (grant.ok()) {
          const body = (await grant.json()) as { grant?: { id?: string } };
          if (typeof body.grant?.id === 'string') await mcp.revoke(body.grant.id);
        }
        if (agent.ok()) await mcp.call('disable_agent', { name: agentName });
      } finally {
        await mcp.close();
      }
    }

    expect(grant.status()).toBe(403);
    expect(agent.status()).toBe(403);
  });
});
