import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/Markdown';
import { Snippet, splitSnippet } from '@/components/Snippet';
import { parseInline, parseMarkdown, safeHref } from './markdown';

const render = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));

describe('safeHref — nur http(s) wird ein Link', () => {
  it('laesst http und https durch', () => {
    expect(safeHref('https://nordlicht.example/a?b=1#c')).toBe('https://nordlicht.example/a?b=1#c');
    expect(safeHref('http://nordlicht.example')).toBe('http://nordlicht.example/');
    expect(safeHref('  HTTPS://Nordlicht.Example  ')).toBe('https://nordlicht.example/');
  });

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'javascript&colon;alert(1)',
    '\u0000javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'file:///etc/passwd',
    'mailto:a@b.example',
    '//evil.example/x',
    '/relativ',
    'relativ',
    '#anker',
    'https:/evil.example',
    'https://',
    'http://exa mple.test',
    '',
  ])('weist %j ab', (href) => {
    expect(safeHref(href)).toBeUndefined();
  });
});

describe('Markdown-Renderer — gefaehrliche Eingaben', () => {
  it('rendert einen javascript:-Link als Text ohne href', () => {
    const html = render('[klick](javascript:alert(document.cookie))');
    expect(html).not.toContain('href');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('klick');
  });

  it('rendert data:- und Protokoll-relative Links nicht als Link', () => {
    for (const source of [
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](//evil.example)',
      '[x](JAVASCRIPT:alert(1))',
      '[x](  javascript:alert(1))',
    ]) {
      expect(render(source)).not.toContain('<a');
    }
  });

  it('escapet HTML im Text, in Code und in Ueberschriften', () => {
    const html = render(
      '# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n`<b>`\n\n```\n<iframe src="x"></iframe>\n```',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;iframe');
  });

  it('kann den Link-Text nicht zum Attribut machen', () => {
    const html = render('[a" onmouseover="alert(1)](https://ok.example)');
    expect(html).toContain('href="https://ok.example/"');
    expect(html).not.toMatch(/<a[^>]* onmouseover=/);
  });

  it('kann aus der URL nicht ausbrechen', () => {
    const html = render('[a](https://ok.example/"onmouseover="alert(1))');
    expect(html).not.toMatch(/<a[^>]* onmouseover=/);
    expect(html).toContain('%22onmouseover=%22');
  });

  it('oeffnet externe Links ohne Zugriff auf das Fenster der App', () => {
    const html = render('[Doku](https://docs.example)');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('bleibt bei boesartig vielen Markierungen schnell', () => {
    const inputs = [
      '**'.repeat(20_000),
      '*a '.repeat(20_000),
      '_a '.repeat(20_000),
      '['.repeat(20_000),
      '[a]('.repeat(10_000),
      '`'.repeat(20_000),
      `${'**'.repeat(50)}x${'**'.repeat(50)}`,
    ];
    const started = Date.now();
    for (const input of inputs) render(input);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('begrenzt die Verschachtelungstiefe', () => {
    const deep = `${'*_'.repeat(200)}x${'_*'.repeat(200)}`;
    expect(() => render(deep)).not.toThrow();
  });
});

describe('Markdown-Parser — Struktur', () => {
  it('erkennt Ueberschriften, Absaetze und Listen', () => {
    const blocks = parseMarkdown('# Titel\n\nErste Zeile\nzweite Zeile\n\n- a\n- b\n\n3. drei\n4. vier');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    const [heading, paragraph, bullets, numbers] = blocks;
    expect(heading).toMatchObject({ type: 'heading', level: 1 });
    expect(paragraph).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'Erste Zeile zweite Zeile' }],
    });
    expect(bullets).toMatchObject({ type: 'list', ordered: false });
    expect(numbers).toMatchObject({ type: 'list', ordered: true, start: 3 });
  });

  it('nimmt Code-Bloecke woertlich', () => {
    const blocks = parseMarkdown('```ts\nconst a = **b**;\n# kein Titel\n```\nnach');
    expect(blocks[0]).toEqual({ type: 'code', lang: 'ts', text: 'const a = **b**;\n# kein Titel' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
  });

  it('nimmt einen offenen Code-Block bis zum Ende', () => {
    expect(parseMarkdown('```\nnie zu')).toEqual([{ type: 'code', lang: '', text: 'nie zu' }]);
  });

  it('erkennt Fett, Kursiv, Code und Links, auch verschachtelt', () => {
    expect(parseInline('**fett *und kursiv*** `code` [Link](https://a.example)')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'fett ' },
          { type: 'em', children: [{ type: 'text', text: 'und kursiv' }] },
        ],
      },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://a.example/', children: [{ type: 'text', text: 'Link' }] },
    ]);
  });

  it('laesst snake_case und offene Markierungen als Text', () => {
    expect(parseInline('max_page_size und 2 * 3 und **offen')).toEqual([
      { type: 'text', text: 'max_page_size und 2 * 3 und **offen' },
    ]);
  });

  it('beachtet Backslash-Escapes', () => {
    expect(parseInline('\\*kein kursiv\\*')).toEqual([{ type: 'text', text: '*kein kursiv*' }]);
  });

  it('macht Markdown-Ueberschriften eine Ebene tiefer, weil der Seitentitel h1 ist', () => {
    const html = render('# Eins\n\n## Zwei\n\n###### Sechs');
    expect(html).toContain('<h2');
    expect(html).toContain('<h3');
    expect(html).toContain('<h6');
    expect(html).not.toContain('<h1');
  });
});

describe('Suchausschnitt', () => {
  it('hebt Treffer in «…» hervor und liest kein Markdown', () => {
    expect(splitSnippet('Alle haben **30 «Urlaubstage»** im Jahr')).toEqual([
      { text: 'Alle haben **30 ', hit: false },
      { text: 'Urlaubstage', hit: true },
      { text: '** im Jahr', hit: false },
    ]);
  });

  it('escapet HTML im Ausschnitt', () => {
    const html = renderToStaticMarkup(createElement(Snippet, { source: '«<script>»alert(1)' }));
    expect(html).not.toContain('<script');
    expect(html).toContain('<strong');
  });

  it('laesst offene Marken als Text stehen', () => {
    expect(splitSnippet('a « b')).toEqual([{ text: 'a « b', hit: false }]);
  });
});
