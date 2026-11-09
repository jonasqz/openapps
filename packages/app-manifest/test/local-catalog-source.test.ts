import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CatalogSourceError, LocalCatalogSource, ManifestValidationError } from '../src/index.js';
import { validManifest } from './fixtures.js';

function catalog(apps: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'openapps-catalog-'));
  for (const [folder, manifest] of Object.entries(apps)) {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, 'app.json'), JSON.stringify(manifest), 'utf8');
  }
  return root;
}

describe('LocalCatalogSource', () => {
  it('listet Manifeste und gibt eines nach Namen zurück', async () => {
    const source = new LocalCatalogSource({
      directory: catalog({ projektliste: validManifest() }),
    });
    const entries = await source.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourceId).toBe('local');
    expect((await source.get('projektliste'))?.manifest.displayName).toBe('Projektliste');
  });

  it('gibt undefined für eine unbekannte App zurück', async () => {
    const source = new LocalCatalogSource({ directory: catalog({}) });
    expect(await source.get('gibts-nicht')).toBeUndefined();
    expect(await source.list()).toEqual([]);
  });

  it('wirft, wenn der Ordnername nicht zum Manifest-Namen passt', async () => {
    const source = new LocalCatalogSource({ directory: catalog({ crm: validManifest() }) });
    await expect(source.get('crm')).rejects.toThrowError(CatalogSourceError);
  });

  it('wirft bei einem ungültigen Manifest mit Pfad in der Meldung', async () => {
    const source = new LocalCatalogSource({
      directory: catalog({ kaputt: { manifestVersion: 1 } }),
    });
    await expect(source.list()).rejects.toThrowError(ManifestValidationError);
  });

  it('lässt keinen Pfad-Ausbruch über get() zu', async () => {
    const source = new LocalCatalogSource({ directory: catalog({}) });
    await expect(source.get('../../etc')).rejects.toThrowError(CatalogSourceError);
  });

  it('wirft, wenn das Verzeichnis nicht lesbar ist', async () => {
    const source = new LocalCatalogSource({ directory: join(tmpdir(), 'openapps-gibts-nicht') });
    await expect(source.list()).rejects.toThrowError(CatalogSourceError);
  });
});
