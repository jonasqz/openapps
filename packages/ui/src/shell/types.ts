import type { ReactNode } from 'react';

/**
 * Der angemeldete Nutzer. Die Shell baut **keinen** Login — die App bekommt
 * den Nutzer aus `@openapps/sdk` (aus den Gateway-Headern) und gibt ihn als
 * Prop herein. `null` heißt: noch nicht geladen.
 */
export interface ShellUser {
  id: string;
  email: string;
  /** Anzeigename. Fehlt er, zeigt die Shell die E-Mail. */
  name?: string;
  /** Gruppen aus `X-Auth-Groups`. Nur zur Anzeige, nie zur Rechteprüfung. */
  groups?: readonly string[];
  /** Kürzel im Avatar. Fehlt es, wird es aus Name oder E-Mail gebildet. */
  initials?: string;
}

export interface ShellNavItem {
  id: string;
  label: string;
  href: string;
  /** Dekoratives Zeichen links. */
  icon?: ReactNode;
  /** Zahl rechts, z. B. offene Aufgaben. */
  badge?: number;
  /** Aktiver Eintrag. Genau einer ist aktiv. */
  current?: boolean;
}

export interface ShellNavGroup {
  /** Überschrift der Gruppe. Entfällt bei einer einzigen Gruppe. */
  title?: string;
  items: readonly ShellNavItem[];
}

export interface ShellApp {
  id: string;
  name: string;
  href: string;
  /** Kategorie aus `app.json`. Gruppiert den App-Wechsler. */
  category?: string;
  current?: boolean;
}

export interface ShellNotification {
  id: string;
  title: string;
  /** ISO-Zeitstempel. Die Shell formatiert ihn nicht um. */
  at?: string;
  body?: string;
  read?: boolean;
  href?: string;
}

/**
 * Eine App in der gemeinsamen Leiste (ADR 0017). Kommt vom Gateway, nicht
 * aus der App: nur Apps, die die Person lesen darf.
 */
export interface ShellPlatformApp {
  /** Technischer Name, z. B. `crm`. Vergleich mit `appName` der Shell. */
  name: string;
  /** Anzeigename, z. B. „CRM“. */
  title: string;
  /** Kategorie aus `app.json`. Gruppiert erst ab vielen Apps. */
  category?: string | null;
  /** Absolute Adresse der App. Alles außer http(s) und `/` fällt weg. */
  href: string;
}

/**
 * Navigationsdaten der Plattform aus `X-Auth-Nav` (ADR 0017). Anzeige, keine
 * Freigabe: Ob jemand eine App öffnen darf, entscheidet die Forward-Auth.
 */
export interface ShellPlatform {
  /** Adresse der Control Plane, z. B. `https://admin.example.com`. */
  platformUrl: string;
  apps: readonly ShellPlatformApp[];
  /** Zeigt „New app“. */
  canCreateApps: boolean;
  /** Zeigt „Admin“. */
  isAdmin: boolean;
}

/** Darstellung: dem System folgen oder hell/dunkel erzwingen. */
export type ShellTheme = 'system' | 'light' | 'dark';
