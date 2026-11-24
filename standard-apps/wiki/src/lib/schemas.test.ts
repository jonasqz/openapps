import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  PagesArchiveArgs,
  PagesCreateArgs,
  PagesGetArgs,
  PagesHistoryArgs,
  PagesListArgs,
  PagesSearchArgs,
  PagesUpdateArgs,
  splitTags,
} from './schemas';
import { appendMarkdown, escapeLike } from './pages';

const ID = '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001';

describe('Tool-Argumente — was ein Agent falsch machen kann', () => {
  it('weist unbekannte Argumente ab, statt sie still zu ignorieren', () => {
    expect(PagesCreateArgs.safeParse({ title: 'A', content: 'x', contentMd: '' }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, body: 'x' }).success).toBe(false);
    expect(PagesListArgs.safeParse({ query: 'x' }).success).toBe(false);
    expect(PagesGetArgs.safeParse({ id: ID, withChildren: true }).success).toBe(false);
  });

  it('verlangt eine UUID als Id — kein SQL, kein Pfad', () => {
    for (const id of ['', '1', "' or 1=1 --", '../etc', `${ID} `, ID.toUpperCase().replace(/-/g, '')]) {
      expect(PagesGetArgs.safeParse({ id }).success).toBe(false);
      expect(PagesArchiveArgs.safeParse({ id }).success).toBe(false);
    }
    expect(PagesGetArgs.safeParse({ id: ID }).success).toBe(true);
  });

  it('prueft den Titel an beiden Grenzen und trimmt ihn', () => {
    expect(PagesCreateArgs.parse({ title: '  Urlaub  ', contentMd: '' }).title).toBe('Urlaub');
    expect(PagesCreateArgs.safeParse({ title: '   ', contentMd: '' }).success).toBe(false);
    expect(PagesCreateArgs.safeParse({ title: 'x'.repeat(LIMITS.titleMax), contentMd: '' }).success).toBe(true);
    expect(PagesCreateArgs.safeParse({ title: 'x'.repeat(LIMITS.titleMax + 1), contentMd: '' }).success).toBe(
      false,
    );
  });

  it('verlangt contentMd beim Anlegen, erlaubt aber leeren Inhalt', () => {
    expect(PagesCreateArgs.safeParse({ title: 'A' }).success).toBe(false);
    expect(PagesCreateArgs.parse({ title: 'A', contentMd: '' })).toEqual({ title: 'A', contentMd: '', tags: [] });
  });

  it('begrenzt den Inhalt', () => {
    const tooLong = 'x'.repeat(LIMITS.contentMax + 1);
    expect(PagesCreateArgs.safeParse({ title: 'A', contentMd: tooLong }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, appendMd: tooLong }).success).toBe(false);
  });

  it('normalisiert Tags: klein, getrimmt, ohne Dubletten', () => {
    const parsed = PagesCreateArgs.parse({ title: 'A', contentMd: '', tags: [' Urlaub', 'urlaub', 'Übersicht'] });
    expect(parsed.tags).toEqual(['urlaub', 'übersicht']);
  });

  it('weist kaputte Tags und zu viele Tags ab', () => {
    for (const tag of ['', ' ', 'mit leer', '-vorne', 'a,b', 'x'.repeat(LIMITS.tagMax + 1)]) {
      expect(PagesCreateArgs.safeParse({ title: 'A', contentMd: '', tags: [tag] }).success).toBe(false);
    }
    const many = Array.from({ length: LIMITS.tagsMax + 1 }, (_, index) => `t${index}`);
    expect(PagesCreateArgs.safeParse({ title: 'A', contentMd: '', tags: many }).success).toBe(false);
  });

  it('pages.update: contentMd und appendMd schliessen sich aus', () => {
    const result = PagesUpdateArgs.safeParse({ id: ID, contentMd: 'a', appendMd: 'b' });
    expect(result.success).toBe(false);
  });

  it('pages.update: ohne Aenderung ist es ein Fehler', () => {
    expect(PagesUpdateArgs.safeParse({ id: ID }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, appendMd: '' }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, tags: [] }).success).toBe(true);
    expect(PagesUpdateArgs.safeParse({ id: ID, appendMd: '- neu' }).success).toBe(true);
  });

  it('pages.search: Suchtext Pflicht, limit begrenzt, Standard 10', () => {
    expect(PagesSearchArgs.safeParse({ query: '  ' }).success).toBe(false);
    expect(PagesSearchArgs.parse({ query: 'urlaub' })).toEqual({ query: 'urlaub', limit: LIMITS.searchLimitDefault });
    for (const limit of [0, -1, LIMITS.searchLimitMax + 1, 1.5, '10']) {
      expect(PagesSearchArgs.safeParse({ query: 'x', limit }).success).toBe(false);
    }
  });

  it('pages.history: limit begrenzt', () => {
    expect(PagesHistoryArgs.parse({ id: ID }).limit).toBe(LIMITS.historyLimitDefault);
    expect(PagesHistoryArgs.safeParse({ id: ID, limit: LIMITS.historyLimitMax + 1 }).success).toBe(false);
  });

  it('nimmt keine Nicht-Objekte als Argumente', () => {
    for (const input of [null, undefined, 'x', 42, [], [ID]]) {
      expect(PagesGetArgs.safeParse(input).success).toBe(false);
      expect(PagesListArgs.safeParse(input).success).toBe(false);
    }
    expect(PagesListArgs.safeParse({}).success).toBe(true);
  });
});

describe('Hilfen', () => {
  it('appendMarkdown haengt als eigenen Block an', () => {
    expect(appendMarkdown('', '- neu')).toBe('- neu');
    expect(appendMarkdown('Alt\n\n\n', '- neu')).toBe('Alt\n\n- neu');
    expect(appendMarkdown('Alt', '\n\n## Neu')).toBe('Alt\n\n## Neu');
  });

  it('escapeLike nimmt % und _ woertlich', () => {
    expect(escapeLike('100%_sicher\\')).toBe('100\\%\\_sicher\\\\');
  });

  it('splitTags trennt an Kommas und verwirft Leeres', () => {
    expect(splitTags(' a, b ,, c ,')).toEqual(['a', 'b', 'c']);
    expect(splitTags('')).toEqual([]);
  });
});
