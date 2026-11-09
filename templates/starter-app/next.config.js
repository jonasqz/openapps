/**
 * `@openapps/ui` wird als TypeScript-Quelle ausgeliefert (wie shadcn/ui), nicht
 * als gebautes Paket. Deshalb muss Next es mitübersetzen.
 *
 * `basePath`: Jede App liegt unter einem Pfad auf der gemeinsamen Domain
 * (`https://<domain>/<app>`, ADR 0007) — nicht auf einer eigenen Subdomain.
 * Ohne `basePath` baut Next alle Verweise, Bilder und JavaScript-Dateien von
 * `/` aus; die App lädt dann die Dateien der Plattform statt ihrer eigenen und
 * ist kaputt, sobald sie das erste Bild lädt.
 *
 * Den Wert setzt die Control Plane pro Deployment in `OPENAPPS_APP_BASE_PATH`.
 * Schreibe ihn nicht fest hinein: Das Review-Gate prüft, dass er aus genau
 * dieser Variable kommt, und ein fester Pfad bleibt stehen, wenn die App
 * einmal umzieht.
 *
 * Next backt `basePath` in den **Build**. Die Variable muss also schon beim
 * `next build` gesetzt sein, nicht erst beim Start.
 *
 * Lokal ist die Variable leer, und das ist richtig: `pnpm dev` läuft auf `/`.
 */

/**
 * Der Pfad in der Form, die Next verlangt: entweder leer oder mit `/` davor
 * und ohne `/` am Ende. Ein unbrauchbarer Wert bricht den Build ab — ein
 * stillschweigend verworfener `basePath` wäre ein Fehler, der erst im Browser
 * auffällt.
 */
function basePath() {
  const raw = (process.env.OPENAPPS_APP_BASE_PATH ?? '').trim().replace(/\/+$/, '');
  if (raw === '') return '';
  if (!/^\/[a-z0-9][a-z0-9-]*$/.test(raw)) {
    throw new Error(
      `OPENAPPS_APP_BASE_PATH ist "${raw}" — erwartet wird /<app-name> ` +
        '(Kleinbuchstaben, Ziffern, Bindestrich) oder ein leerer Wert für den lokalen Lauf.',
    );
  }
  return raw;
}

/** @type {import('next').NextConfig} */
export default {
  basePath: basePath(),
  transpilePackages: ['@openapps/ui'],
  reactStrictMode: true,
};
