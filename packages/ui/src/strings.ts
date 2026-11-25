/**
 * Alle festen Texte des Design Systems an einer Stelle.
 *
 * Die Texte sind einsprachig englisch (ADR 0016) — es gibt kein i18n. Aber kein fester Text steht
 * mehr in einer Komponente: Mehrsprachigkeit ist damit später der Austausch
 * dieses einen Moduls statt eines Umbaus jeder Komponente.
 *
 * Eine App kann einzelne Texte ersetzen:
 *
 * ```ts
 * import { overrideStrings } from '@openapps/ui';
 * overrideStrings({ form: { submit: 'Submit request' } });
 * ```
 *
 * Komponenten lesen die Texte beim Rendern (nicht beim Importieren), deshalb
 * wirkt ein Austausch auch nach dem ersten Rendern. Wo eine Komponente heute
 * schon eine Text-Prop hat (`loadingLabel`, `emptyLabel`, …), gewinnt die Prop.
 *
 * `src/strings.test.ts` prüft, dass keine Komponenten-, Muster- oder
 * Shell-Datei einen sichtbaren Text selbst enthält.
 */

export interface UiStrings {
  readonly common: {
    /** Allgemeiner Ladehinweis, z. B. im Knopf und im Spinner. */
    readonly loading: string;
    readonly retry: string;
    readonly cancel: string;
    readonly save: string;
    readonly saving: string;
    readonly close: string;
    /** Zusatz für Screenreader an einem Pflichtfeld-Label. */
    readonly requiredSuffix: string;
  };
  readonly select: {
    readonly empty: string;
  };
  readonly table: {
    readonly emptyTitle: string;
    /** „Loading <caption>…" */
    readonly loadingLabel: (caption: string) => string;
    /** Platzhalter für ein leeres Feld in einer Zelle. */
    readonly emptyValue: string;
    readonly yes: string;
    readonly no: string;
    /**
     * Ein Datum in einer Zelle. Muss ohne Zeitzone und ohne
     * Spracheinstellung des Browsers auskommen: Die Tabelle rendert auf dem
     * Server und hydriert im Browser, sonst stehen dort zwei Zeichenketten.
     */
    readonly date: (value: Date) => string;
  };
  readonly pagination: {
    readonly label: string;
    readonly previous: string;
    readonly next: string;
    readonly empty: string;
    /** „1–20 of 1234 · Page 1 of 62" */
    readonly range: (from: number, to: number, total: number, page: number, pages: number) => string;
  };
  readonly tabs: {
    readonly empty: string;
  };
  readonly dialog: {
    readonly close: string;
  };
  readonly toast: {
    /** Name des Schließen-Knopfs an einer Meldung. */
    readonly close: (title: string) => string;
  };
  readonly errorState: {
    readonly correlationId: string;
  };
  readonly list: {
    readonly searchPlaceholder: string;
    readonly resetFilters: string;
    readonly resetFiltersShort: string;
    readonly reload: string;
  };
  readonly form: {
    readonly submit: string;
    readonly submitting: string;
    readonly cancel: string;
    readonly required: string;
    readonly confirmRequired: string;
    readonly invalidEmail: string;
    readonly invalidNumber: string;
    /** „Check 3 fields" */
    readonly summary: (count: number) => string;
  };
  readonly detail: {
    readonly loading: string;
  };
  readonly shell: {
    readonly productName: string;
    readonly skipToContent: string;
    readonly openNavigation: string;
    readonly closeNavigation: string;
    /** „Leave navigation" */
    readonly navigationLabel: (appName: string) => string;
  };
  readonly appSwitcher: {
    readonly action: string;
    readonly placeholder: string;
    readonly empty: string;
    /** Überschrift für Apps ohne Kategorie im Manifest. */
    readonly defaultCategory: string;
  };
  readonly userMenu: {
    readonly signedOut: string;
    readonly profile: string;
    readonly signOut: string;
    /** „Profile and sign out, signed in as Anna Example" */
    readonly label: (name: string) => string;
  };
  readonly notifications: {
    readonly title: string;
    readonly markAllRead: string;
    readonly unreadSuffix: string;
    readonly emptyTitle: string;
    readonly emptyDescription: string;
    readonly errorTitle: string;
    readonly loading: string;
    /** Name des Glocken-Knopfs, mit der Zahl ungelesener Meldungen. */
    readonly label: (unread: number) => string;
  };
  readonly platformShell: {
    /** Name des Bereichs mit allen Apps. */
    readonly appsLabel: string;
    /** Name der ganzen Leiste. */
    readonly sidebarLabel: string;
    /** Link der Marke links oben zur Plattform. */
    readonly home: string;
    /** Die App hat keine eigenen Bereiche. */
    readonly sectionsEmpty: string;
    readonly collapse: string;
    readonly expand: string;
    readonly newApp: string;
    readonly newAgent: string;
    readonly admin: string;
    readonly settings: string;
    readonly getStarted: string;
    readonly signOut: string;
    readonly theme: string;
    readonly themeSystem: string;
    readonly themeLight: string;
    readonly themeDark: string;
    readonly loadingUser: string;
    /** „Account menu, signed in as Anna Example" */
    readonly userMenuLabel: (name: string) => string;
    readonly newAppTitle: string;
    readonly newAppDescription: string;
    readonly newAppName: string;
    readonly newAppNameHint: string;
    readonly newAppPurpose: string;
    readonly newAppPurposePlaceholder: string;
    readonly newAppCommand: string;
    /** Platzhalter im Befehl, solange nichts beschrieben ist. */
    readonly newAppCommandEmpty: string;
    readonly newAppExplanation: string;
    readonly newAppConnect: string;
    readonly copy: string;
    readonly copied: string;
    readonly copyFailed: string;
    readonly copyFailedDescription: string;
    readonly copiedDescription: string;
  };
  readonly developer: {
    readonly toastProviderMissing: string;
  };
}

/** Die ausgelieferten Texte, englisch (ADR 0016). */
const en: UiStrings = {
  common: {
    loading: 'Loading…',
    retry: 'Try again',
    cancel: 'Cancel',
    save: 'Save',
    saving: 'Saving…',
    close: 'Close',
    requiredSuffix: ' (required)',
  },
  select: {
    empty: 'No options available',
  },
  table: {
    emptyTitle: 'No entries yet',
    loadingLabel: (caption) => `Loading ${caption}…`,
    emptyValue: '—',
    yes: 'Yes',
    no: 'No',
    // en-GB (TT/MM/JJJJ), fest gebaut statt Intl, aus dem Grund oben.
    date: (value) =>
      `${String(value.getUTCDate()).padStart(2, '0')}/${String(value.getUTCMonth() + 1).padStart(2, '0')}/${value.getUTCFullYear()}`,
  },
  pagination: {
    label: 'Pagination',
    previous: 'Previous',
    next: 'Next',
    empty: 'No entries',
    range: (from, to, total, page, pages) => `${from}–${to} of ${total} · Page ${page} of ${pages}`,
  },
  tabs: {
    empty: 'No tabs available',
  },
  dialog: {
    close: 'Close dialog',
  },
  toast: {
    close: (title) => `Close message “${title}”`,
  },
  errorState: {
    correlationId: 'Reference: ',
  },
  list: {
    searchPlaceholder: 'Search…',
    resetFilters: 'Reset filters',
    resetFiltersShort: 'Reset',
    reload: 'Reload',
  },
  form: {
    submit: 'Save',
    submitting: 'Saving…',
    cancel: 'Cancel',
    required: 'Please fill in this field.',
    confirmRequired: 'Please confirm.',
    invalidEmail: 'Please enter a valid email address.',
    invalidNumber: 'Please enter a number.',
    summary: (count) => `Check ${count} ${count === 1 ? 'field' : 'fields'}`,
  },
  detail: {
    loading: 'Loading details…',
  },
  shell: {
    productName: 'openapps',
    skipToContent: 'Skip to content',
    openNavigation: 'Open navigation',
    closeNavigation: 'Close navigation',
    navigationLabel: (appName) => `${appName} navigation`,
  },
  appSwitcher: {
    action: 'Switch app',
    placeholder: 'Choose an app',
    empty: 'No apps shared with you',
    defaultCategory: 'Apps',
  },
  userMenu: {
    signedOut: 'Not signed in',
    profile: 'Profile',
    signOut: 'Sign out',
    label: (name) => `Profile and sign out, signed in as ${name}`,
  },
  notifications: {
    title: 'Notifications',
    markAllRead: 'Mark all as read',
    unreadSuffix: '(unread)',
    emptyTitle: 'Nothing new',
    emptyDescription: 'Updates from your apps appear here.',
    errorTitle: 'Notifications not loaded',
    loading: 'Loading notifications…',
    label: (unread) =>
      unread === 0 ? 'Notifications, none unread' : `Notifications, ${unread} unread`,
  },
  platformShell: {
    appsLabel: 'Apps',
    sidebarLabel: 'Sidebar',
    home: 'Platform home',
    sectionsEmpty: 'No pages yet',
    collapse: 'Collapse sidebar',
    expand: 'Expand sidebar',
    newApp: 'New app',
    newAgent: 'New agent',
    admin: 'Admin',
    settings: 'Settings',
    getStarted: 'Get started',
    signOut: 'Sign out',
    theme: 'Theme',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    loadingUser: 'Loading account',
    userMenuLabel: (name) => `Account menu, signed in as ${name}`,
    newAppTitle: 'New app',
    newAppDescription: 'Describe the app. Your assistant builds it from the command below.',
    newAppName: 'Name',
    newAppNameHint: 'Short and plain, for example Leave requests.',
    newAppPurpose: 'What should it do?',
    newAppPurposePlaceholder: 'Team members request leave, their lead approves it, HR sees a calendar.',
    newAppCommand: 'Command for your assistant',
    newAppCommandEmpty: '<describe your app>',
    newAppExplanation: 'Paste the command into your assistant. It builds the app for you on this platform.',
    newAppConnect: 'How to connect your assistant',
    copy: 'Copy',
    copied: 'Command copied',
    copiedDescription: 'Paste it into your assistant.',
    copyFailed: 'Could not copy',
    copyFailedDescription: 'Select the command and copy it by hand.',
  },
  developer: {
    toastProviderMissing: 'useToast needs a <ToastProvider> above it.',
  },
};

type Group = keyof UiStrings;

/** Teilweise Ersetzung: Gruppe für Gruppe, Schlüssel für Schlüssel. */
export type StringsOverride = {
  [G in Group]?: Partial<UiStrings[G]>;
};

/**
 * Die Texte, die die Komponenten benutzen.
 *
 * Absichtlich ein veränderliches Objekt und keine Konstante: eine App ersetzt
 * einzelne Texte über `overrideStrings`, ohne jede Komponente neu zu verdrahten.
 */
export const strings: UiStrings = Object.fromEntries(
  (Object.keys(en) as Group[]).map((group) => [group, { ...en[group] }]),
) as unknown as UiStrings;

/** Einzelne Texte ersetzen. Nicht genannte Texte bleiben, wie sie sind. */
export function overrideStrings(override: StringsOverride): void {
  for (const group of Object.keys(override) as Group[]) {
    const patch = override[group];
    if (patch === undefined) continue;
    Object.assign(strings[group], patch);
  }
}

/** Alles auf die ausgelieferten Texte zurücksetzen (für Tests). */
export function resetStrings(): void {
  for (const group of Object.keys(en) as Group[]) {
    Object.assign(strings[group], en[group]);
  }
}

export { en as defaultStrings };
