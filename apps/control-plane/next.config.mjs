/**
 * Next-Konfiguration der Control Plane. Absichtlich klein: die Logik liegt in
 * `src/domain`, nicht im Framework.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // `@openapps/ui` wird als TypeScript-Quelle ausgeliefert (wie shadcn/ui),
  // nicht als gebautes Paket. Ohne diese Zeile kommt rohes TSX im Browser an.
  transpilePackages: ['@openapps/ui'],
  // `pg` und die Scanner-Prozesse laufen nur im Node-Runtime, nie im Browser.
  serverExternalPackages: ['pg'],
  experimental: {
    // Die Domaene wird als TypeScript-Quelle aus dem Workspace importiert.
    externalDir: true,
  },
};

export default nextConfig;
