import { describe, expect, it } from 'vitest';
import { draftKey, isStale, parseDraft, serializeDraft } from './draft';
import { insertAt, insertCodeBlock, pageLinkMarkdown, toggleLineBlock, wrapInline } from './editing';
import { extractPageLinks, parseMarkdown } from './markdown';
import { LIMITS } from './schemas';

const ID = '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001';

describe('editor blocks', () => {
  it('turns the current line into a heading and puts the cursor after the prefix', () => {
    expect(toggleLineBlock('', 0, 0, 'heading')).toEqual({ text: '## ', selectionStart: 3, selectionEnd: 3 });
    const edit = toggleLineBlock('one\ntwo', 5, 5, 'heading');
    expect(edit.text).toBe('one\n## two');
  });

  it('prefixes every selected line and toggles back', () => {
    const on = toggleLineBlock('a\nb\nc', 0, 3, 'checklist');
    expect(on.text).toBe('- [ ] a\n- [ ] b\nc');
    const off = toggleLineBlock(on.text, on.selectionStart, on.selectionEnd, 'checklist');
    expect(off.text).toBe('a\nb\nc');
  });

  it('replaces another block prefix instead of stacking it', () => {
    expect(toggleLineBlock('- item', 0, 0, 'checklist').text).toBe('- [ ] item');
    expect(toggleLineBlock('- [x] done', 0, 0, 'quote').text).toBe('> done');
  });

  it('wraps a code block on its own lines', () => {
    const edit = insertCodeBlock('before x after', 7, 8);
    expect(edit.text).toBe('before \n```\nx\n```\n after');
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('x');
  });

  it('wraps inline marks and inserts text', () => {
    expect(wrapInline('a b', 2, 3, '**')).toEqual({ text: 'a **b**', selectionStart: 4, selectionEnd: 5 });
    expect(insertAt('ab', 1, 1, 'X')).toEqual({ text: 'aXb', selectionStart: 2, selectionEnd: 2 });
  });

  it('survives selections outside the text', () => {
    expect(() => toggleLineBlock('abc', 99, -5, 'bullet')).not.toThrow();
    expect(insertAt('abc', 99, 99, '!').text).toBe('abc!');
  });

  it('builds page links the parser reads back, whatever the title contains', () => {
    for (const title of ['Plain', 'With [brackets]', 'a](javascript:alert(1))', '**bold** _x_ `c`', 'back\\slash']) {
      const markdown = pageLinkMarkdown({ id: ID, title });
      expect(extractPageLinks(markdown), title).toEqual([ID]);
    }
  });
});

describe('drafts in the browser', () => {
  it('has separate keys per page and per parent of a new page', () => {
    expect(draftKey({ pageId: ID })).not.toBe(draftKey({ parentId: ID }));
    expect(draftKey({ parentId: null })).not.toBe(draftKey({ parentId: ID }));
  });

  it('round-trips a draft', () => {
    const draft = { contentMd: '# x', savedAt: '2026-11-27T10:00:00.000Z', baseUpdatedAt: null };
    expect(parseDraft(serializeDraft(draft))).toEqual(draft);
  });

  it('treats anything malformed as no draft', () => {
    for (const raw of [
      null,
      '',
      'not json',
      'null',
      '"text"',
      '{}',
      JSON.stringify({ contentMd: 1, savedAt: '2026-11-27T10:00:00.000Z', baseUpdatedAt: null }),
      JSON.stringify({ contentMd: 'x', savedAt: 'yesterday', baseUpdatedAt: null }),
      JSON.stringify({ contentMd: 'x', savedAt: '2026-11-27T10:00:00.000Z', baseUpdatedAt: 5 }),
      JSON.stringify({ contentMd: 'x'.repeat(LIMITS.contentMax + 1), savedAt: '2026-11-27T10:00:00.000Z', baseUpdatedAt: null }),
    ]) {
      expect(parseDraft(raw), String(raw).slice(0, 40)).toBeUndefined();
    }
  });

  it('notices when the page changed after the draft began', () => {
    const draft = { contentMd: 'x', savedAt: '2026-11-27T10:00:00.000Z', baseUpdatedAt: '2026-11-27T09:00:00.000Z' };
    expect(isStale(draft, '2026-11-27T09:00:00.000Z')).toBe(false);
    expect(isStale(draft, '2026-11-27T09:30:00.000Z')).toBe(true);
  });
});

describe('checklists', () => {
  it('parses open and done items and keeps plain items plain', () => {
    const [list] = parseMarkdown('- [ ] open\n- [x] done\n- [X] also done\n- plain\n- [] not a box');
    expect(list).toMatchObject({ type: 'list', checked: [false, true, true, null, null] });
    if (list?.type !== 'list') throw new Error('expected a list');
    expect(list.items[0]).toEqual([{ type: 'text', text: 'open' }]);
    expect(list.items[4]).toEqual([{ type: 'text', text: '[] not a box' }]);
  });
});
