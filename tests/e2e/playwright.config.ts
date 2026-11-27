/**
 * Browser-Tests gegen den laufenden lokalen Stapel (infra/lokal). Nicht Teil
 * von `pnpm check`: Sie brauchen Docker und einen gestarteten Stapel.
 *
 *   ./infra/lokal/lokal.sh up -d
 *   pnpm e2e
 *
 * Sicherheit der Artefakte: Traces und Videos sind aus. Ein Trace speichert
 * Header und Cookies, und die Tests tragen ein Operator-Token und eine
 * Session. Bei einem Fehler gibt es nur einen Screenshot.
 */

import { defineConfig, devices } from '@playwright/test';
import { APPS_HOST, CP_HOST } from './src/stack';

export default defineConfig({
  testDir: './specs',
  globalSetup: './src/global-setup.ts',
  // Die Tests teilen Zustand im Stapel (Freigaben einer Person). Einer nach
  // dem anderen, damit kein Test die Freigabe eines anderen sieht.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: process.env.CI !== undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    // Breit genug, dass die Seitenleiste sichtbar ist (`md:flex`).
    viewport: { width: 1280, height: 800 },
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    // Das lokale Zertifikat ist selbst signiert (einrichten.sh).
    ignoreHTTPSErrors: true,
    launchOptions: {
      // Die Hosts des Gateways auf den Loopback, ohne /etc/hosts.
      args: [`--host-resolver-rules=MAP ${APPS_HOST} 127.0.0.1, MAP ${CP_HOST} 127.0.0.1`],
    },
  },
  projects: [{ name: 'chromium' }],
});
