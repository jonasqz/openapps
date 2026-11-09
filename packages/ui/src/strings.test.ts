import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { germanStrings, overrideStrings, resetStrings, strings } from './strings.ts';

const srcRoot = dirname(fileURLToPath(import.meta.url));

/** Komponenten, Muster und Shell — hier darf kein fester Text mehr stehen. */
const SCANNED = ['components', 'patterns', 'shell'];

function filesIn(folder: string): string[] {
  return readdirSync(join(srcRoot, folder))
    .filter((name) => /\.tsx?$/.test(name) && !name.includes('.test.'))
    .map((name) => join(srcRoot, folder, name));
}

/** Kommentare raus — eine Erklärung auf Deutsch ist kein Oberflächentext. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const LETTERS = /[A-Za-zÄÖÜäöüß]{2,}/;

/**
 * Text zwischen zwei JSX-Tags: eine Zeile, keine Code-Zeichen.
 * Die Einschränkung ist nötig, weil `useRef<HTMLDivElement>(null)` sonst wie
 * JSX-Text aussieht. Preis: ein JSX-Text mit Klammer oder Doppelpunkt rutscht
 * durch — den fangen die Netze 2 bis 5.
 */
const JSX_TEXT = /(?<![=-])>([^<>{}();=|&?:\n]+)</g;

/** Zeichen, die in Tailwind-Klassen nicht vorkommen, in deutscher Prosa schon. */
const GERMAN_ONLY = /[ÄÖÜäöüß…„“»«–·]/;

/** Props, deren Wert auf der Oberfläche landet oder vorgelesen wird. */
const TEXT_PROPS = [
  'aria-label',
  'aria-description',
  'alt',
  'title',
  'label',
  'description',
  'placeholder',
  'srPrefix',
  'loadingLabel',
  'emptyLabel',
  'signedOutLabel',
];

interface Finding {
  file: string;
  text: string;
  why: string;
}

/**
 * Sucht sichtbaren deutschen Text in einer Quelldatei.
 *
 * Vier Netze, absichtlich eng gefasst statt „alles, was nach Wort aussieht" —
 * sonst würde jede Tailwind-Klasse gemeldet:
 *  1. Text direkt im JSX (`>Weiter<`)
 *  2. Zeichenketten an Text-Props (`aria-label="…"`, `placeholder="…"`)
 *  3. Zeichenketten als Vorgabewert hinter `??`
 *  4. Zeichenketten mit Umlaut, ß oder typografischem Zeichen — die gibt es
 *     in keiner Klasse und in keinem Bezeichner
 *  5. `throw new Error('…')`
 */
export function findGermanText(file: string, rawSource?: string): Finding[] {
  const source = stripComments(rawSource ?? readFileSync(file, 'utf8'));
  const findings: Finding[] = [];

  for (const match of source.matchAll(JSX_TEXT)) {
    const text = match[1]!.trim();
    if (text !== '' && LETTERS.test(text)) {
      findings.push({ file, text, why: 'Text direkt im JSX' });
    }
  }

  for (const prop of TEXT_PROPS) {
    const pattern = new RegExp(`${prop}=(?:"([^"]+)"|'([^']+)')`, 'g');
    for (const match of source.matchAll(pattern)) {
      const text = match[1] ?? match[2] ?? '';
      if (LETTERS.test(text)) {
        findings.push({ file, text, why: `Zeichenkette an ${prop}` });
      }
    }
  }

  for (const match of source.matchAll(/\?\?\s*(?:'([^']+)'|"([^"]+)")/g)) {
    const text = match[1] ?? match[2] ?? '';
    // Ein kleingeschriebenes Einzelwort ist ein technischer Wert ('info',
    // 'page'), kein Oberflächentext. Alles mit Leerzeichen, Großbuchstabe am
    // Anfang oder Umlaut ist einer.
    const looksLikeProse = / /.test(text) || /^[A-ZÄÖÜ]/.test(text) || GERMAN_ONLY.test(text);
    if (LETTERS.test(text) && looksLikeProse) {
      findings.push({ file, text, why: 'Vorgabewert hinter ??' });
    }
  }

  for (const match of source.matchAll(/(?:'([^'\n]+)'|"([^"\n]+)"|`([^`\n]+)`)/g)) {
    const text = match[1] ?? match[2] ?? match[3] ?? '';
    if (GERMAN_ONLY.test(text)) {
      findings.push({ file, text, why: 'Umlaut oder typografisches Zeichen' });
    }
  }

  for (const match of source.matchAll(/throw new Error\(\s*(?:'([^']+)'|"([^"]+)")/g)) {
    findings.push({ file, text: match[1] ?? match[2] ?? '', why: 'Fehlertext' });
  }

  return findings;
}

describe('Alle festen Texte liegen in src/strings.ts', () => {
  it.each(SCANNED)('%s enthält keinen sichtbaren deutschen Text mehr', (folder) => {
    const findings = filesIn(folder).flatMap((file) => findGermanText(file));
    const report = findings
      .map((f) => `${f.file.replace(srcRoot, 'src')}: ${f.why} — "${f.text}"`)
      .join('\n');
    expect(findings, `Diese Texte gehören nach src/strings.ts:\n${report}`).toHaveLength(0);
  });

  it('greift, wenn jemand wieder einen Text einbaut — jedes einzelne Netz', () => {
    const cases: ReadonlyArray<[string, string]> = [
      ['Text direkt im JSX', 'const a = <button>Speichern</button>;'],
      ['Zeichenkette an aria-label', 'const b = <input aria-label="Suche nach Antrag" />;'],
      ['Vorgabewert hinter ??', "const c = name ?? 'Unbekannt';"],
      ['Umlaut oder typografisches Zeichen', "const d = cn('x', isOn && 'y'), e = 'Lädt';"],
      ['Fehlertext', "throw new Error('Kaputt gegangen');"],
    ];
    for (const [why, code] of cases) {
      const found = findGermanText('test.tsx', code);
      expect(found.map((f) => f.why), code).toContain(why);
    }
  });

  it('meldet korrekten Code nicht', () => {
    const clean = [
      "import { strings } from '../strings.ts';",
      'const a = <button>{strings.form.submit}</button>;',
      'const b = <input aria-label={strings.list.searchPlaceholder} />;',
      "const c = tone ?? 'info';",
      "const d = cn('flex min-w-0 items-center gap-2', isOn && 'bg-primary text-primary-fg');",
      'const e = <span aria-hidden="true">✕</span>;',
      'const f = useRef<HTMLDivElement>(null);',
      "const g = <div role=\"status\" aria-live=\"polite\" />;",
    ].join('\n');
    expect(findGermanText('test.tsx', clean)).toEqual([]);
  });
});

describe('Texte ersetzen', () => {
  it('ersetzt einzelne Texte und lässt den Rest stehen', () => {
    resetStrings();
    overrideStrings({ form: { submit: 'Antrag einreichen' } });
    expect(strings.form.submit).toBe('Antrag einreichen');
    expect(strings.form.cancel).toBe(germanStrings.form.cancel);
    resetStrings();
    expect(strings.form.submit).toBe(germanStrings.form.submit);
  });

  it('verändert die ausgelieferten Texte nicht', () => {
    resetStrings();
    overrideStrings({ shell: { productName: 'Beispiel GmbH' } });
    expect(germanStrings.shell.productName).toBe('openapps');
    resetStrings();
  });

  it('deckt jede Gruppe und jeden Schlüssel ab', () => {
    for (const [group, values] of Object.entries(germanStrings)) {
      for (const [key, value] of Object.entries(values)) {
        expect(['string', 'function'], `${group}.${key}`).toContain(typeof value);
        if (typeof value === 'string') {
          expect(value.length, `${group}.${key} ist leer`).toBeGreaterThan(0);
        }
      }
    }
  });
});
