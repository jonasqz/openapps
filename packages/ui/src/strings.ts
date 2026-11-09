/**
 * Alle festen Texte des Design Systems an einer Stelle.
 *
 * v1 ist einsprachig deutsch — es gibt kein i18n. Aber kein fester Text steht
 * mehr in einer Komponente: Mehrsprachigkeit ist damit später der Austausch
 * dieses einen Moduls statt eines Umbaus jeder Komponente.
 *
 * Eine App kann einzelne Texte ersetzen:
 *
 * ```ts
 * import { overrideStrings } from '@openapps/ui';
 * overrideStrings({ form: { submit: 'Antrag einreichen' } });
 * ```
 *
 * Komponenten lesen die Texte beim Rendern (nicht beim Importieren), deshalb
 * wirkt ein Austausch auch nach dem ersten Rendern. Wo eine Komponente heute
 * schon eine Text-Prop hat (`loadingLabel`, `emptyLabel`, …), gewinnt die Prop.
 *
 * `src/strings.test.ts` prüft, dass keine Komponenten-, Muster- oder
 * Shell-Datei einen sichtbaren deutschen Text mehr selbst enthält.
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
    /** „<Tabellenname> lädt …" */
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
    /** „1–20 von 1234 · Seite 1 von 62" */
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
    /** „3 Felder prüfen" */
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
    /** „Navigation von Urlaub" */
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
    /** „Profil und Abmelden, angemeldet als Anna Beispiel" */
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
  readonly developer: {
    readonly toastProviderMissing: string;
  };
}

/** Die deutschen Texte von v1. */
const de: UiStrings = {
  common: {
    loading: 'Lädt …',
    retry: 'Erneut versuchen',
    cancel: 'Abbrechen',
    save: 'Speichern',
    saving: 'Wird gespeichert …',
    close: 'Schließen',
    requiredSuffix: ' (Pflichtfeld)',
  },
  select: {
    empty: 'Keine Auswahl verfügbar',
  },
  table: {
    emptyTitle: 'Noch keine Einträge',
    loadingLabel: (caption) => `${caption} lädt …`,
    emptyValue: '—',
    yes: 'Ja',
    no: 'Nein',
    date: (value) =>
      `${String(value.getUTCDate()).padStart(2, '0')}.${String(value.getUTCMonth() + 1).padStart(2, '0')}.${value.getUTCFullYear()}`,
  },
  pagination: {
    label: 'Seitenweiterschaltung',
    previous: 'Zurück',
    next: 'Weiter',
    empty: 'Keine Einträge',
    range: (from, to, total, page, pages) =>
      `${from}–${to} von ${total} · Seite ${page} von ${pages}`,
  },
  tabs: {
    empty: 'Keine Reiter vorhanden',
  },
  dialog: {
    close: 'Dialog schließen',
  },
  toast: {
    close: (title) => `Meldung „${title}“ schließen`,
  },
  errorState: {
    correlationId: 'Kennung: ',
  },
  list: {
    searchPlaceholder: 'Suchen …',
    resetFilters: 'Filter zurücksetzen',
    resetFiltersShort: 'Zurücksetzen',
    reload: 'Erneut laden',
  },
  form: {
    submit: 'Speichern',
    submitting: 'Wird gespeichert …',
    cancel: 'Abbrechen',
    required: 'Bitte ausfüllen.',
    confirmRequired: 'Bitte bestätigen.',
    invalidEmail: 'Bitte eine gültige E-Mail-Adresse angeben.',
    invalidNumber: 'Bitte eine Zahl angeben.',
    summary: (count) => `${count} ${count === 1 ? 'Feld' : 'Felder'} prüfen`,
  },
  detail: {
    loading: 'Einzelheiten werden geladen …',
  },
  shell: {
    productName: 'openapps',
    skipToContent: 'Zum Inhalt springen',
    openNavigation: 'Navigation öffnen',
    closeNavigation: 'Navigation schließen',
    navigationLabel: (appName) => `Navigation von ${appName}`,
  },
  appSwitcher: {
    action: 'App wechseln',
    placeholder: 'App wählen',
    empty: 'Keine App freigegeben',
    defaultCategory: 'Apps',
  },
  userMenu: {
    signedOut: 'Nicht angemeldet',
    profile: 'Profil',
    signOut: 'Abmelden',
    label: (name) => `Profil und Abmelden, angemeldet als ${name}`,
  },
  notifications: {
    title: 'Benachrichtigungen',
    markAllRead: 'Alle gelesen',
    unreadSuffix: '(ungelesen)',
    emptyTitle: 'Nichts Neues',
    emptyDescription: 'Hier erscheinen Hinweise aus Ihren Apps.',
    errorTitle: 'Benachrichtigungen nicht geladen',
    loading: 'Benachrichtigungen werden geladen …',
    label: (unread) =>
      unread === 0
        ? 'Benachrichtigungen, keine ungelesenen'
        : `Benachrichtigungen, ${unread} ungelesen`,
  },
  developer: {
    toastProviderMissing: 'useToast braucht einen <ToastProvider> darüber.',
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
  (Object.keys(de) as Group[]).map((group) => [group, { ...de[group] }]),
) as unknown as UiStrings;

/** Einzelne Texte ersetzen. Nicht genannte Texte bleiben, wie sie sind. */
export function overrideStrings(override: StringsOverride): void {
  for (const group of Object.keys(override) as Group[]) {
    const patch = override[group];
    if (patch === undefined) continue;
    Object.assign(strings[group], patch);
  }
}

/** Alles auf die ausgelieferten deutschen Texte zurücksetzen (für Tests). */
export function resetStrings(): void {
  for (const group of Object.keys(de) as Group[]) {
    Object.assign(strings[group], de[group]);
  }
}

export { de as germanStrings };
