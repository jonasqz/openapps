import type { JSX } from 'react';
import { themeScript } from './platform.ts';

/**
 * Setzt die gemerkte Darstellung (hell/dunkel) vor dem ersten Bild, ohne
 * Aufblitzen. Gehoert in `<head>` des Root-Layouts; dazu
 * `suppressHydrationWarning` auf `<html>`, weil das Skript `data-theme` setzt,
 * bevor React hydriert.
 *
 * Ohne `'use client'`: rendert auf dem Server, und die App braucht kein
 * eigenes `dangerouslySetInnerHTML`.
 */
export function ThemeScript(): JSX.Element {
  return <script dangerouslySetInnerHTML={{ __html: themeScript }} />;
}
