/**
 * Next-Konfiguration der Control Plane. Absichtlich klein: die Logik liegt in
 * `src/domain`, nicht im Framework.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // `pg` und die Scanner-Prozesse laufen nur im Node-Runtime, nie im Browser.
  serverExternalPackages: ['pg'],
  experimental: {
    // Die Domaene wird als TypeScript-Quelle aus dem Workspace importiert.
    externalDir: true,
  },
};

export default nextConfig;
