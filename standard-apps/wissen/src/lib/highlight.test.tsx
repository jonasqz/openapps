import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Highlighted } from '@/components/Highlighted';
import { parseHighlights, stripHighlights } from './highlight';

describe('parseHighlights', () => {
  it('zerlegt «»-Markierungen in markierte und normale Stücke', () => {
    expect(parseHighlights('Die «Kilometerpauschale» beträgt «0,30» Euro')).toEqual([
      { text: 'Die ', marked: false },
      { text: 'Kilometerpauschale', marked: true },
      { text: ' beträgt ', marked: false },
      { text: '0,30', marked: true },
      { text: ' Euro', marked: false },
    ]);
  });

  it('lässt unpaarige Zeichen als Text stehen', () => {
    expect(parseHighlights('»Zitat« ohne Ende «offen')).toEqual([
      { text: '»Zitat« ohne Ende «offen', marked: false },
    ]);
    expect(parseHighlights('nur » zu')).toEqual([{ text: 'nur » zu', marked: false }]);
  });

  it('erzeugt keine leeren Stücke', () => {
    expect(parseHighlights('«»')).toEqual([]);
    expect(parseHighlights('')).toEqual([]);
    expect(parseHighlights('«a»«b»')).toEqual([{ text: 'ab', marked: true }]);
  });

  it('stripHighlights gibt den Text ohne Markierung zurück', () => {
    expect(stripHighlights('a «b» c')).toBe('a b c');
  });
});

describe('Highlighted', () => {
  it('rendert Markierungen als <mark>', () => {
    const html = renderToStaticMarkup(<Highlighted text="Die «Hotelobergrenze» gilt" />);
    expect(html).toMatch(/<mark[^>]*>Hotelobergrenze<\/mark>/);
    expect(html).not.toContain('«');
    expect(html).not.toContain('»');
  });

  it('lässt kein HTML aus dem Dokument durch, auch nicht in einer Markierung', () => {
    const html = renderToStaticMarkup(
      <Highlighted text={'<script>alert(1)</script> «<img src=x onerror=alert(1)>» <b>fett</b>'} />,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toMatch(/<mark[^>]*>&lt;img src=x onerror=alert\(1\)&gt;<\/mark>/);
    // Ausser <mark> und <span> entsteht kein Element.
    const tags = [...html.matchAll(/<([a-z]+)/g)].map((match) => match[1]);
    expect(new Set(tags)).toEqual(new Set(['span', 'mark']));
  });
});
