import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  PagesArchiveArgs,
  PagesCreateArgs,
  PagesGetArgs,
  PagesHistoryArgs,
  FavoritesListArgs,
  FavoritesSetArgs,
  PagesListArgs,
  PagesMoveArgs,
  PagesRestoreArgs,
  PagesSearchArgs,
  PagesTreeArgs,
  PagesUpdateArgs,
  splitTags,
} from './schemas';
import { appendMarkdown, escapeLike } from './pages';

const ID = '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001';

describe('tool arguments — what an agent can get wrong', () => {
  it('rejects unknown arguments instead of silently ignoring them', () => {
    expect(PagesCreateArgs.safeParse({ title: 'A', content: 'x', contentMd: '' }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, body: 'x' }).success).toBe(false);
    expect(PagesListArgs.safeParse({ query: 'x' }).success).toBe(false);
    expect(PagesGetArgs.safeParse({ id: ID, withChildren: true }).success).toBe(false);
  });

  it('requires a UUID as id — no SQL, no path', () => {
    for (const id of ['', '1', "' or 1=1 --", '../etc', `${ID} `, ID.toUpperCase().replace(/-/g, '')]) {
      expect(PagesGetArgs.safeParse({ id }).success).toBe(false);
      expect(PagesArchiveArgs.safeParse({ id }).success).toBe(false);
    }
    expect(PagesGetArgs.safeParse({ id: ID }).success).toBe(true);
  });

  it('checks the title at both limits and trims it', () => {
    expect(PagesCreateArgs.parse({ title: '  Leave  ', contentMd: '' }).title).toBe('Leave');
    expect(PagesCreateArgs.safeParse({ title: '   ', contentMd: '' }).success).toBe(false);
    expect(PagesCreateArgs.safeParse({ title: 'x'.repeat(LIMITS.titleMax), contentMd: '' }).success).toBe(true);
    expect(PagesCreateArgs.safeParse({ title: 'x'.repeat(LIMITS.titleMax + 1), contentMd: '' }).success).toBe(
      false,
    );
  });

  it('requires contentMd on create but allows empty content', () => {
    expect(PagesCreateArgs.safeParse({ title: 'A' }).success).toBe(false);
    expect(PagesCreateArgs.parse({ title: 'A', contentMd: '' })).toEqual({ title: 'A', contentMd: '', tags: [] });
  });

  it('limits the content', () => {
    const tooLong = 'x'.repeat(LIMITS.contentMax + 1);
    expect(PagesCreateArgs.safeParse({ title: 'A', contentMd: tooLong }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, appendMd: tooLong }).success).toBe(false);
  });

  it('normalises tags: lowercase, trimmed, no duplicates', () => {
    const parsed = PagesCreateArgs.parse({ title: 'A', contentMd: '', tags: [' Leave', 'leave', 'Café'] });
    expect(parsed.tags).toEqual(['leave', 'café']);
  });

  it('rejects broken tags and too many tags', () => {
    for (const tag of ['', ' ', 'with space', '-leading', 'a,b', 'x'.repeat(LIMITS.tagMax + 1)]) {
      expect(PagesCreateArgs.safeParse({ title: 'A', contentMd: '', tags: [tag] }).success).toBe(false);
    }
    const many = Array.from({ length: LIMITS.tagsMax + 1 }, (_, index) => `t${index}`);
    expect(PagesCreateArgs.safeParse({ title: 'A', contentMd: '', tags: many }).success).toBe(false);
  });

  it('pages.update: contentMd and appendMd exclude each other', () => {
    const result = PagesUpdateArgs.safeParse({ id: ID, contentMd: 'a', appendMd: 'b' });
    expect(result.success).toBe(false);
  });

  it('pages.update: no change is an error', () => {
    expect(PagesUpdateArgs.safeParse({ id: ID }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, appendMd: '' }).success).toBe(false);
    expect(PagesUpdateArgs.safeParse({ id: ID, tags: [] }).success).toBe(true);
    expect(PagesUpdateArgs.safeParse({ id: ID, appendMd: '- new' }).success).toBe(true);
  });

  it('pages.search: search text required, limit bounded, default 10', () => {
    expect(PagesSearchArgs.safeParse({ query: '  ' }).success).toBe(false);
    expect(PagesSearchArgs.parse({ query: 'leave' })).toEqual({ query: 'leave', limit: LIMITS.searchLimitDefault });
    for (const limit of [0, -1, LIMITS.searchLimitMax + 1, 1.5, '10']) {
      expect(PagesSearchArgs.safeParse({ query: 'x', limit }).success).toBe(false);
    }
  });

  it('pages.history: limit bounded', () => {
    expect(PagesHistoryArgs.parse({ id: ID }).limit).toBe(LIMITS.historyLimitDefault);
    expect(PagesHistoryArgs.safeParse({ id: ID, limit: LIMITS.historyLimitMax + 1 }).success).toBe(false);
  });

  it('accepts no non-objects as arguments', () => {
    for (const input of [null, undefined, 'x', 42, [], [ID]]) {
      expect(PagesGetArgs.safeParse(input).success).toBe(false);
      expect(PagesListArgs.safeParse(input).success).toBe(false);
    }
    expect(PagesListArgs.safeParse({}).success).toBe(true);
  });
});

describe('new tools in 0.2.0 — arguments', () => {
  const OTHER = '6f1c2a4e-1b7d-4c2a-9e51-0a0000000002';

  it('pages.move: parentId is required, a UUID or null, never the page itself', () => {
    expect(PagesMoveArgs.safeParse({ id: ID }).success).toBe(false);
    expect(PagesMoveArgs.safeParse({ id: ID, parentId: undefined }).success).toBe(false);
    expect(PagesMoveArgs.parse({ id: ID, parentId: null })).toEqual({ id: ID, parentId: null });
    expect(PagesMoveArgs.parse({ id: ID, parentId: OTHER })).toEqual({ id: ID, parentId: OTHER });
    const self = PagesMoveArgs.safeParse({ id: ID, parentId: ID });
    expect(self.success).toBe(false);
    expect(self.error?.issues[0]?.message).toMatch(/own parent/);
    for (const parentId of ['', 'top', 0, false, [OTHER]]) {
      expect(PagesMoveArgs.safeParse({ id: ID, parentId }).success).toBe(false);
    }
    expect(PagesMoveArgs.safeParse({ id: ID, parentId: null, position: 1 }).success).toBe(false);
  });

  it('pages.restore: revisionId is a positive number as a string', () => {
    expect(PagesRestoreArgs.parse({ id: ID, revisionId: '42' })).toEqual({ id: ID, revisionId: '42' });
    for (const revisionId of ['0', '-1', '01', '1.5', '1e3', ' 1', 42, '', '9'.repeat(19)]) {
      expect(PagesRestoreArgs.safeParse({ id: ID, revisionId }).success).toBe(false);
    }
  });

  it('pages.tree: only an optional rootId', () => {
    expect(PagesTreeArgs.parse({})).toEqual({});
    expect(PagesTreeArgs.safeParse({ rootId: ID }).success).toBe(true);
    expect(PagesTreeArgs.safeParse({ rootId: 'x' }).success).toBe(false);
  });

  it('pages.list: sort and limit are bounded', () => {
    expect(PagesListArgs.parse({ sort: 'updated', limit: 5 })).toEqual({ sort: 'updated', limit: 5 });
    for (const input of [{ sort: 'title; drop' }, { limit: 501 }, { limit: 0 }, { limit: 2.5 }]) {
      expect(PagesListArgs.safeParse(input).success).toBe(false);
    }
  });

  it('favorites: favorite must be a boolean, and nobody picks another owner', () => {
    expect(FavoritesSetArgs.safeParse({ id: ID, favorite: true }).success).toBe(true);
    expect(FavoritesSetArgs.safeParse({ id: ID }).success).toBe(false);
    expect(FavoritesSetArgs.safeParse({ id: ID, favorite: 'true' }).success).toBe(false);
    expect(FavoritesSetArgs.safeParse({ id: ID, favorite: true, userId: 'usr_other' }).success).toBe(false);
    expect(FavoritesListArgs.safeParse({ userId: 'usr_other' }).success).toBe(false);
  });
});

describe('helpers', () => {
  it('appendMarkdown appends as a separate block', () => {
    expect(appendMarkdown('', '- new')).toBe('- new');
    expect(appendMarkdown('Old\n\n\n', '- new')).toBe('Old\n\n- new');
    expect(appendMarkdown('Old', '\n\n## New')).toBe('Old\n\n## New');
  });

  it('escapeLike takes % and _ literally', () => {
    expect(escapeLike('100%_sure\\')).toBe('100\\%\\_sure\\\\');
  });

  it('splitTags splits at commas and drops empty parts', () => {
    expect(splitTags(' a, b ,, c ,')).toEqual(['a', 'b', 'c']);
    expect(splitTags('')).toEqual([]);
  });
});
