import type { AppManifest } from './manifest.js';

/**
 * Quellen-Abstraktion für den Katalog (docs/04-app-manifest.md).
 *
 * Die Control Plane liest Apps nur über dieses Interface. In v1 gibt es
 * ausschließlich `LocalCatalogSource`. Das Interface existiert jetzt, damit
 * später ein öffentlicher Community-Katalog und private Kataloge als weitere
 * Implementierungen dazukommen, ohne dass sich Apps oder Control Plane ändern.
 *
 * Absichtlich klein: `list()` und `get(name)`. Kein Installieren, kein Suchen,
 * kein Paginieren — Installieren ist derselbe Weg wie Deployen und liegt in der
 * Control Plane, nicht in der Quelle.
 */
export interface CatalogSource {
  /** Stabiler Bezeichner der Quelle, z. B. `local`. Teil der Herkunft eines Eintrags. */
  readonly id: string;

  /** Alle Manifeste der Quelle. Leere Quelle: leeres Array, kein Fehler. */
  list(): Promise<readonly CatalogEntry[]>;

  /** Ein Manifest nach App-Name, oder `undefined`, wenn die Quelle es nicht kennt. */
  get(name: string): Promise<CatalogEntry | undefined>;
}

/** Ein Manifest plus Herkunft, damit die Control Plane weiß, woher es kam. */
export interface CatalogEntry {
  readonly sourceId: string;
  /** Wo die Quelle das Manifest gefunden hat — ein Dateipfad, eine URL. Für Fehlermeldungen. */
  readonly location: string;
  readonly manifest: AppManifest;
}

/** Fehler einer Katalog-Quelle. Ein ungültiges Manifest wirft `ManifestValidationError`. */
export class CatalogSourceError extends Error {
  readonly sourceId: string;

  constructor(sourceId: string, message: string, options?: { cause?: unknown }) {
    super(`[${sourceId}] ${message}`, options);
    this.name = 'CatalogSourceError';
    this.sourceId = sourceId;
  }
}
