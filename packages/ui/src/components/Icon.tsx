import type { JSX } from 'react';
import { cn } from '../lib/cn.ts';

/**
 * Ein kleiner, eigener Satz Linien-Icons (1.5px Strich, 20er Raster).
 *
 * Keine Icon-Bibliothek: Der UI-Linter erlaubt keine fremden UI-Pakete, und
 * die Navigation braucht nur eine Handvoll Zeichen. Icons sind immer
 * dekorativ (`aria-hidden`) — die Bedeutung trägt der Text daneben.
 *
 * Serverfähig: keine Hooks, keine Funktionen in Props. Eine Server-Komponente
 * kann `<Icon name="apps" />` als `icon` in die Navigation reichen.
 */
const PATHS = {
  home: 'M3.5 9 10 3.5 16.5 9v7a1 1 0 0 1-1 1h-3.5v-5h-4v5H4.5a1 1 0 0 1-1-1Z',
  apps: 'M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z',
  agents:
    'M6 7.5h8a2 2 0 0 1 2 2V14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2ZM10 7.5V4.5M8 11.5h.01M12 11.5h.01M10 4.5h.01',
  grants: 'M10 2.75 16 5v4.5c0 3.6-2.6 6.6-6 7.75-3.4-1.15-6-4.15-6-7.75V5Zm-2.5 7.5 1.75 1.75L12.75 8.5',
  groups:
    'M7.5 9.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5ZM2.75 16.5c0-2.6 2.1-4.5 4.75-4.5s4.75 1.9 4.75 4.5M13.5 4.25a2.75 2.75 0 0 1 0 5.25M15 12.25c1.4.6 2.25 2.1 2.25 4.25',
  audit: 'M5.5 2.75h6.5l3.5 3.5v10a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-12.5a1 1 0 0 1 1-1ZM12 2.75v3.5h3.5M7.5 10h5M7.5 13h5',
  plug: 'M7.5 2.75v3.5M12.5 2.75v3.5M5.5 6.25h9V9a4.5 4.5 0 0 1-9 0ZM10 13.5v3.75',
  book: 'M4 4.25A1.5 1.5 0 0 1 5.5 2.75H16v12H5.5A1.5 1.5 0 0 0 4 16.25ZM4 16.25a1.5 1.5 0 0 0 1.5 1.5H16v-3',
  search: 'M8.75 14.5a5.75 5.75 0 1 0 0-11.5 5.75 5.75 0 0 0 0 11.5ZM13 13l4 4',
  bell: 'M5 8a5 5 0 0 1 10 0c0 5.5 2 7 2 7H3s2-1.5 2-7M8.5 17.25a1.75 1.75 0 0 0 3 0',
  plus: 'M10 4v12M4 10h12',
  check: 'M4.5 10.5 8 14l7.5-8',
  close: 'M5 5l10 10M15 5 5 15',
  'chevron-right': 'M8 5l5 5-5 5',
  'chevron-down': 'M5 8l5 5 5-5',
  'arrow-up-right': 'M6.5 13.5l7-7M7.5 6.5h6v6',
  settings:
    'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM10 2.75v2M10 15.25v2M17.25 10h-2M4.75 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9',
  database:
    'M10 7.25c3.45 0 6.25-1.01 6.25-2.25S13.45 2.75 10 2.75 3.75 3.76 3.75 5 6.55 7.25 10 7.25ZM3.75 5v10c0 1.24 2.8 2.25 6.25 2.25s6.25-1.01 6.25-2.25V5M3.75 10c0 1.24 2.8 2.25 6.25 2.25s6.25-1.01 6.25-2.25',
  terminal: 'M3.5 4.5h13v11h-13zM6.5 8l2.5 2-2.5 2M10.5 12.5h3',
} as const;

export type IconName = keyof typeof PATHS;

export interface IconProps {
  name: IconName;
  /** Größe in Tailwind-Schritten. `sm` = 16px, `md` = 20px. */
  size?: 'sm' | 'md';
  className?: string;
}

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, size = 'sm', className }: IconProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('shrink-0', size === 'sm' ? 'h-4 w-4' : 'h-5 w-5', className)}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
