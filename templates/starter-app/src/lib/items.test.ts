import { describe, expect, it } from 'vitest';
import { ItemInput } from './items';

/**
 * Das Muster für Tests in einer App: prüfe die Validierung und die Grenzen,
 * nicht das Glückliche-Pfad-Offensichtliche. Was eine Datenbank braucht, gehört
 * in einen eigenen Test gegen eine Testinstanz — nicht hierher.
 *
 * Ersetze diese Datei, wenn du `items` durch deine eigenen Tabellen ersetzt.
 */
describe('ItemInput', () => {
  it('nimmt einen Titel an und entfernt umgebende Leerzeichen', () => {
    const parsed = ItemInput.parse({ title: '  Angebot prüfen  ' });
    expect(parsed.title).toBe('Angebot prüfen');
  });

  it('weist einen leeren Titel ab, auch wenn er nur aus Leerzeichen besteht', () => {
    for (const title of ['', '   ', '\t\n']) {
      expect(ItemInput.safeParse({ title }).success).toBe(false);
    }
  });

  it('weist einen Titel über 200 Zeichen ab', () => {
    expect(ItemInput.safeParse({ title: 'x'.repeat(200) }).success).toBe(true);
    expect(ItemInput.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
  });

  it('weist ab, was gar kein Titel ist', () => {
    for (const input of [{}, { title: 42 }, { title: null }, null, 'Angebot']) {
      expect(ItemInput.safeParse(input).success).toBe(false);
    }
  });
});
