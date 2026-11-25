import type { JSX, ReactNode } from 'react';

/**
 * Zeichen der Leiste. Eigene SVGs statt einer Icon-Bibliothek (keine zweite
 * UI-Bibliothek). Alle 16x16, Strich 1.5, `currentColor` — die Farbe kommt
 * vom Text-Token des Elternelements. Rein dekorativ: `aria-hidden`.
 */
const ICON_SIZE = 'h-4 w-4 shrink-0';

function Icon({ children, className = ICON_SIZE }: { children: ReactNode; className?: string }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export const PlusIcon = (): JSX.Element => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const AgentIcon = (): JSX.Element => (
  <Icon>
    <path d="M8 2.5l1.3 3.2 3.2 1.3-3.2 1.3L8 11.5 6.7 8.3 3.5 7l3.2-1.3z" />
    <path d="M12.5 11v3M11 12.5h3" />
  </Icon>
);

export const SettingsIcon = (): JSX.Element => (
  <Icon>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06M12.42 12.42l-1.06-1.06M4.64 4.64L3.58 3.58" />
  </Icon>
);

export const AdminIcon = (): JSX.Element => (
  <Icon>
    <path d="M8 1.75l5 2v3.5c0 3.1-2.1 5.6-5 7-2.9-1.4-5-3.9-5-7v-3.5z" />
    <path d="M6 8l1.5 1.5L10.5 6.5" />
  </Icon>
);

export const SidebarIcon = (): JSX.Element => (
  <Icon>
    <rect x="2" y="2.75" width="12" height="10.5" rx="2" />
    <path d="M6.25 2.75v10.5" />
  </Icon>
);

export const ChevronsIcon = (): JSX.Element => (
  <Icon>
    <path d="M5.5 6L8 3.5 10.5 6M5.5 10L8 12.5 10.5 10" />
  </Icon>
);

export const SignOutIcon = (): JSX.Element => (
  <Icon>
    <path d="M6.5 13.25h-3a1 1 0 0 1-1-1v-8.5a1 1 0 0 1 1-1h3M10.5 11l3-3-3-3M13.5 8H6" />
  </Icon>
);

export const BookIcon = (): JSX.Element => (
  <Icon>
    <path d="M2.5 3.5c1.8-.6 3.7-.4 5.5.75 1.8-1.15 3.7-1.35 5.5-.75v9c-1.8-.6-3.7-.4-5.5.75-1.8-1.15-3.7-1.35-5.5-.75zM8 4.25v9" />
  </Icon>
);

export const SystemIcon = (): JSX.Element => (
  <Icon>
    <rect x="2" y="3" width="12" height="8.5" rx="1.5" />
    <path d="M6 14h4M8 11.5V14" />
  </Icon>
);

export const SunIcon = (): JSX.Element => (
  <Icon>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.25M8 13.25v1.25M14.5 8h-1.25M2.75 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9" />
  </Icon>
);

export const MoonIcon = (): JSX.Element => (
  <Icon>
    <path d="M13.25 9.6A5.5 5.5 0 0 1 6.4 2.75a5.5 5.5 0 1 0 6.85 6.85z" />
  </Icon>
);

export const MenuIcon = (): JSX.Element => (
  <Icon className="h-5 w-5 shrink-0">
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Icon>
);

export const CloseIcon = (): JSX.Element => (
  <Icon>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

export const ArrowOutIcon = (): JSX.Element => (
  <Icon className="h-3 w-3 shrink-0">
    <path d="M5.5 3.5h7v7M12.5 3.5l-9 9" />
  </Icon>
);
