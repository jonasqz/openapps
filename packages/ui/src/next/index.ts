/**
 * `@openapps/ui/next`: die Teile des Design Systems, die Next.js brauchen
 * (ADR 0019). `next` ist dafuer optionale peerDependency; der Kern
 * `@openapps/ui` importiert nichts von hier.
 */
export { NextPlatformShell } from './NextPlatformShell.tsx';
export type { NextPlatformShellProps } from './NextPlatformShell.tsx';
export type { AppSection } from '../shell/sections.ts';
