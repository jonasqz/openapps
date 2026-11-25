import { describe, expect, it } from 'vitest';
import { chunkText, overlapTail, splitHard, splitSentences } from './chunk';

const sentence = (n: number) =>
  `Satz ${n} beschreibt eine Regel der Nordlicht GmbH mit genug Worten, damit er zählt.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');

/** Alle Woerter eines Textes, ohne Satzzeichen. */
const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? [];

describe('chunkText', () => {
  it('liefert für leeren Text und reinen Leerraum keine Abschnitte', () => {
    for (const text of ['', '   ', '\n\n\n', '\t \r\n \r\n']) {
      expect(chunkText(text)).toEqual([]);
    }
  });

  it('gibt einen kurzen Text als einen getrimmten Abschnitt zurück', () => {
    expect(chunkText('  Kurzer Text.  ')).toEqual(['Kurzer Text.']);
  });

  it('packt kurze Absätze zusammen, solange die Ziellänge reicht', () => {
    const text = ['Erster Absatz.', 'Zweiter Absatz.', 'Dritter Absatz.'].join('\n\n');
    expect(chunkText(text)).toEqual(['Erster Absatz.\n\nZweiter Absatz.\n\nDritter Absatz.']);
  });

  it('überschreitet nie die Höchstlänge und lässt keinen Abschnitt leer', () => {
    const texts = [
      Array.from({ length: 12 }, (_, i) => paragraph(i * 10, 4)).join('\n\n'),
      paragraph(0, 80),
      'x'.repeat(5000),
      ('Wort '.repeat(900) + '\n\n').repeat(3),
      Array.from({ length: 40 }, (_, i) => `Kurz ${i}.`).join('\n\n'),
    ];
    for (const text of texts) {
      const chunks = chunkText(text);
      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(1200);
        expect(chunk.trim()).toBe(chunk);
        expect(chunk).not.toBe('');
      }
    }
  });

  it('trifft bei langem Text ungefähr die Ziellänge', () => {
    const text = Array.from({ length: 20 }, (_, i) => paragraph(i * 10, 3)).join('\n\n');
    const chunks = chunkText(text);
    const inner = chunks.slice(0, -1);
    expect(inner.length).toBeGreaterThan(3);
    for (const chunk of inner) {
      expect(chunk.length).toBeGreaterThanOrEqual(400);
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
  });

  it('trennt an Absatzgrenzen, wenn sie reichen', () => {
    // Drei Absaetze zu je ~500 Zeichen: zwei passen nicht unter 800, also
    // endet jeder Abschnitt an einem Absatzende.
    const paragraphs = [paragraph(0, 6), paragraph(10, 6), paragraph(20, 6)];
    const chunks = chunkText(paragraphs.join('\n\n'));
    expect(chunks).toHaveLength(3);
    chunks.forEach((chunk, index) => expect(chunk.endsWith(paragraphs[index]!)).toBe(true));
  });

  it('trennt einen zu langen Absatz an Satzgrenzen, nicht mitten im Satz', () => {
    const text = paragraph(0, 40); // ein Absatz, ~3400 Zeichen
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toMatch(/zählt\.$/);
    }
  });

  it('trennt einen Satz ohne Satzzeichen an Wortgrenzen', () => {
    const text = Array.from({ length: 400 }, (_, i) => `wort${i}`).join(' ');
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    const all = new Set(words(text));
    for (const chunk of chunks) {
      for (const word of words(chunk)) expect(all.has(word), word).toBe(true);
    }
  });

  it('trennt erst als letzte Notlösung hart, und dann ohne Zeichen zu verlieren', () => {
    const text = 'a'.repeat(3000);
    const chunks = chunkText(text, { overlap: 0 });
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(1200);
  });

  it('zerreißt beim harten Trennen kein Surrogatpaar', () => {
    const text = '😀'.repeat(1500);
    for (const chunk of chunkText(text, { overlap: 0 })) {
      expect(chunk).not.toMatch(/[\ud800-\udbff]$/);
      expect(chunk).not.toMatch(/^[\udc00-\udfff]/);
      expect(chunk.length).toBeLessThanOrEqual(1200);
    }
  });

  it('beginnt jeden weiteren Abschnitt mit dem Ende des vorigen (Überlappung)', () => {
    const text = paragraph(0, 40);
    const chunks = chunkText(text);
    for (let i = 1; i < chunks.length; i += 1) {
      const previous = chunks[i - 1]!;
      const current = chunks[i]!;
      const tail = overlapTail(previous, 150);
      expect(tail.length).toBeGreaterThanOrEqual(75);
      expect(tail.length).toBeLessThanOrEqual(225);
      expect(current.startsWith(tail)).toBe(true);
    }
  });

  it('verliert kein Wort: jedes Wort des Textes steht in einem Abschnitt', () => {
    const text = Array.from({ length: 15 }, (_, i) => paragraph(i * 10, 1 + (i % 7))).join('\n\n');
    const covered = new Set(chunkText(text).flatMap(words));
    for (const word of words(text)) expect(covered.has(word), word).toBe(true);
  });

  it('behandelt Windows-Zeilenenden und mehrfache Leerzeilen wie Absätze', () => {
    expect(chunkText('Eins.\r\n\r\n\r\nZwei.')).toEqual(['Eins.\n\nZwei.']);
    expect(chunkText('Eins.\r\n \t\r\nZwei.')).toEqual(['Eins.\n\nZwei.']);
  });

  it('fasst Leerraum innerhalb einer Zeile zusammen, behält aber einfache Zeilenumbrüche', () => {
    expect(chunkText('Liste:\n-  eins\n-   zwei')).toEqual(['Liste:\n- eins\n- zwei']);
  });

  it('ist deterministisch', () => {
    const text = paragraph(0, 30);
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it('weist unsinnige Optionen ab', () => {
    expect(() => chunkText('x', { target: 0 })).toThrow(RangeError);
    expect(() => chunkText('x', { target: 900, max: 800 })).toThrow(RangeError);
    expect(() => chunkText('x', { overlap: 800 })).toThrow(RangeError);
    expect(() => chunkText('x', { overlap: -1 })).toThrow(RangeError);
    expect(() => chunkText('x', { max: 1.5 })).toThrow(RangeError);
  });
});

describe('splitSentences', () => {
  it('trennt nach Punkt, Ausrufe- und Fragezeichen und schließenden Anführungszeichen', () => {
    expect(splitSentences('Eins. Zwei! Drei? „Vier.“ Fünf… Sechs')).toEqual([
      'Eins.',
      'Zwei!',
      'Drei?',
      '„Vier.“',
      'Fünf…',
      'Sechs',
    ]);
  });

  it('trennt nicht in Zahlen wie 0,30 oder 1.500', () => {
    expect(splitSentences('Es gibt 0,30 Euro. Ab 1.500 Euro gilt mehr.')).toEqual([
      'Es gibt 0,30 Euro.',
      'Ab 1.500 Euro gilt mehr.',
    ]);
  });
});

describe('splitHard', () => {
  it('bevorzugt eine Wortgrenze in der hinteren Hälfte', () => {
    expect(splitHard('aaaa bbbb cccc', 10)).toEqual(['aaaa bbbb', 'cccc']);
  });

  it('trennt hart, wenn keine Wortgrenze da ist', () => {
    expect(splitHard('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

describe('overlapTail', () => {
  it('beginnt an einem Satzanfang, der der gewünschten Länge am nächsten liegt', () => {
    const chunk = `${'Vorne steht viel. '.repeat(20)}Der letzte Satz ist kürzer als die Überlappung, deshalb kommt der Satz davor mit.`;
    const tail = overlapTail(chunk, 150);
    expect(chunk.endsWith(tail)).toBe(true);
    expect(tail).toMatch(/^(Vorne|Der) /);
    // Satzanfaenge liegen 18 Zeichen auseinander; der gewaehlte ist der naechste an 150.
    expect(Math.abs(tail.length - 150)).toBeLessThanOrEqual(9);
  });

  it('fällt ohne Satzgrenze auf eine Wortgrenze zurück', () => {
    const chunk = Array.from({ length: 100 }, (_, i) => `wort${i}`).join(' ');
    const tail = overlapTail(chunk, 150);
    expect(chunk.endsWith(` ${tail}`)).toBe(true);
    expect(tail.length).toBeGreaterThanOrEqual(75);
    expect(tail.length).toBeLessThanOrEqual(150);
  });

  it('nimmt nie mehr als die Hälfte eines kurzen Abschnitts', () => {
    expect(overlapTail('Kurz. Text.', 150).length).toBeLessThanOrEqual(5);
  });

  it('ist leer bei Überlappung 0', () => {
    expect(overlapTail('Irgendein Text.', 0)).toBe('');
  });
});
