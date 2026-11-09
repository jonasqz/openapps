/**
 * `@openapps/ui` wird als TypeScript-Quelle ausgeliefert (wie shadcn/ui), nicht
 * als gebautes Paket. Deshalb muss Next es mitübersetzen.
 */
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ['@openapps/ui'],
  reactStrictMode: true,
};
