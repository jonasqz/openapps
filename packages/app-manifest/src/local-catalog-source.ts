import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { CatalogSourceError, type CatalogEntry, type CatalogSource } from './catalog-source.js';
import { parseAppManifestJson } from './validate.js';

export interface LocalCatalogSourceOptions {
  /** Verzeichnis, das pro App einen Unterordner mit `app.json` enthält. */
  readonly directory: string;
  /** Bezeichner der Quelle. Default `local`. */
  readonly id?: string;
  /** Dateiname des Manifests. Default `app.json`. */
  readonly manifestFileName?: string;
}

/**
 * Die einzige Quelle in v1: liest Manifeste aus einem Verzeichnis im Dateisystem.
 *
 * Erwartetes Layout — ein Unterordner pro App, darin das Manifest:
 *
 *     <directory>/<app>/app.json
 *
 * Der Ordnername ist nicht maßgeblich; maßgeblich ist `name` im Manifest. Weicht
 * er ab, ist das ein Fehler, damit `get(name)` und das Verzeichnis nie
 * auseinanderlaufen. Nichts wird zwischengespeichert: jeder Aufruf liest neu, so
 * wirkt eine Änderung sofort — dieselbe Regel wie beim Widerruf von Freigaben.
 */
export class LocalCatalogSource implements CatalogSource {
  readonly id: string;

  private readonly directory: string;
  private readonly manifestFileName: string;

  constructor(options: LocalCatalogSourceOptions) {
    this.id = options.id ?? 'local';
    this.manifestFileName = options.manifestFileName ?? 'app.json';
    this.directory = isAbsolute(options.directory)
      ? options.directory
      : resolve(process.cwd(), options.directory);
  }

  async list(): Promise<readonly CatalogEntry[]> {
    let names: string[];
    try {
      const dirents = await readdir(this.directory, { withFileTypes: true });
      names = dirents.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name);
    } catch (cause) {
      throw new CatalogSourceError(
        this.id,
        `Verzeichnis nicht lesbar: ${this.directory}`,
        cause instanceof Error ? { cause } : undefined,
      );
    }

    const entries: CatalogEntry[] = [];
    for (const name of names.sort()) {
      const entry = await this.readFolder(name);
      if (entry !== undefined) {
        entries.push(entry);
      }
    }

    const seen = new Map<string, string>();
    for (const entry of entries) {
      const previous = seen.get(entry.manifest.name);
      if (previous !== undefined) {
        throw new CatalogSourceError(
          this.id,
          `zwei Manifeste nennen sich '${entry.manifest.name}': ${previous} und ${entry.location}`,
        );
      }
      seen.set(entry.manifest.name, entry.location);
    }

    return entries;
  }

  async get(name: string): Promise<CatalogEntry | undefined> {
    const entry = await this.readFolder(name);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.manifest.name !== name) {
      throw new CatalogSourceError(
        this.id,
        `Ordner '${name}' enthält ein Manifest für '${entry.manifest.name}'`,
      );
    }
    return entry;
  }

  /** Liest einen Unterordner. `undefined`, wenn er kein Manifest enthält. */
  private async readFolder(folder: string): Promise<CatalogEntry | undefined> {
    // Kein Pfad-Ausbruch: nur ein einfacher Ordnername ist erlaubt.
    if (folder === '' || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) {
      throw new CatalogSourceError(this.id, `kein gültiger App-Ordner: '${folder}'`);
    }

    const location = join(this.directory, folder, this.manifestFileName);
    try {
      const stats = await stat(location);
      if (!stats.isFile()) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const text = await readFile(location, 'utf8');
    return { sourceId: this.id, location, manifest: parseAppManifestJson(text, location) };
  }
}
