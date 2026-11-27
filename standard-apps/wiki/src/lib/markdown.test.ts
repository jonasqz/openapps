import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/Markdown';
import { Snippet, splitSnippet } from '@/components/Snippet';
import { extractPageLinks, parseInline, parseMarkdown, safeHref } from './markdown';

const render = (source: string): string => renderToStaticMarkup(createElement(Markdown, { source }));

describe('safeHref — only http(s) becomes a link', () => {
  it('lets http and https through', () => {
    expect(safeHref('https://northlight.example/a?b=1#c')).toBe('https://northlight.example/a?b=1#c');
    expect(safeHref('http://northlight.example')).toBe('http://northlight.example/');
    expect(safeHref('  HTTPS://Northlight.Example  ')).toBe('https://northlight.example/');
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
    '/relative',
    'relative',
    '#anchor',
    'https:/evil.example',
    'https://',
    'http://exa mple.test',
    '',
  ])('rejects %j', (href) => {
    expect(safeHref(href)).toBeUndefined();
  });
});

describe('Markdown renderer — dangerous input', () => {
  it('renders a javascript: link as text without href', () => {
    const html = render('[click](javascript:alert(document.cookie))');
    expect(html).not.toContain('href');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).toContain('click');
  });

  it('does not render data: and protocol-relative links as links', () => {
    for (const source of [
      '[x](data:text/html,<script>alert(1)</script>)',
      '[x](//evil.example)',
      '[x](JAVASCRIPT:alert(1))',
      '[x](  javascript:alert(1))',
    ]) {
      expect(render(source)).not.toContain('<a');
    }
  });

  it('escapes HTML in text, code and headings', () => {
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

  it('cannot turn the link text into an attribute', () => {
    const html = render('[a" onmouseover="alert(1)](https://ok.example)');
    expect(html).toContain('href="https://ok.example/"');
    expect(html).not.toMatch(/<a[^>]* onmouseover=/);
  });

  it('cannot break out of the URL', () => {
    const html = render('[a](https://ok.example/"onmouseover="alert(1))');
    expect(html).not.toMatch(/<a[^>]* onmouseover=/);
    expect(html).toContain('%22onmouseover=%22');
  });

  it('opens external links without access to the app window', () => {
    const html = render('[Docs](https://docs.example)');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
  });

  it('stays fast with maliciously many markers', () => {
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

  it('limits the nesting depth', () => {
    const deep = `${'*_'.repeat(200)}x${'_*'.repeat(200)}`;
    expect(() => render(deep)).not.toThrow();
  });
});

describe('Markdown parser — structure', () => {
  it('recognises headings, paragraphs and lists', () => {
    const blocks = parseMarkdown('# Title\n\nFirst line\nsecond line\n\n- a\n- b\n\n3. three\n4. four');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'paragraph', 'list', 'list']);
    const [heading, paragraph, bullets, numbers] = blocks;
    expect(heading).toMatchObject({ type: 'heading', level: 1 });
    expect(paragraph).toEqual({
      type: 'paragraph',
      children: [{ type: 'text', text: 'First line second line' }],
    });
    expect(bullets).toMatchObject({ type: 'list', ordered: false });
    expect(numbers).toMatchObject({ type: 'list', ordered: true, start: 3 });
  });

  it('takes code blocks literally', () => {
    const blocks = parseMarkdown('```ts\nconst a = **b**;\n# no title\n```\nafter');
    expect(blocks[0]).toEqual({ type: 'code', lang: 'ts', text: 'const a = **b**;\n# no title' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
  });

  it('takes an unclosed code block to the end', () => {
    expect(parseMarkdown('```\nnever closed')).toEqual([{ type: 'code', lang: '', text: 'never closed' }]);
  });

  it('recognises bold, italic, code and links, nested too', () => {
    expect(parseInline('**bold *and italic*** `code` [Link](https://a.example)')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', text: 'bold ' },
          { type: 'em', children: [{ type: 'text', text: 'and italic' }] },
        ],
      },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'code' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://a.example/', children: [{ type: 'text', text: 'Link' }] },
    ]);
  });

  it('leaves snake_case and unclosed markers as text', () => {
    expect(parseInline('max_page_size and 2 * 3 and **open')).toEqual([
      { type: 'text', text: 'max_page_size and 2 * 3 and **open' },
    ]);
  });

  it('honours backslash escapes', () => {
    expect(parseInline('\\*not italic\\*')).toEqual([{ type: 'text', text: '*not italic*' }]);
  });

  it('moves Markdown headings one level down because the page title is h1', () => {
    const html = render('# One\n\n## Two\n\n###### Six');
    expect(html).toContain('<h2');
    expect(html).toContain('<h3');
    expect(html).toContain('<h6');
    expect(html).not.toContain('<h1');
  });
});

describe('search snippet', () => {
  it('highlights hits in «…» and does not read Markdown', () => {
    expect(splitSnippet('Everyone gets **30 «days»** a year')).toEqual([
      { text: 'Everyone gets **30 ', hit: false },
      { text: 'days', hit: true },
      { text: '** a year', hit: false },
    ]);
  });

  it('escapes HTML in the snippet', () => {
    const html = renderToStaticMarkup(createElement(Snippet, { source: '«<script>»alert(1)' }));
    expect(html).not.toContain('<script');
    expect(html).toContain('<strong');
  });

  it('leaves unclosed marks as text', () => {
    expect(splitSnippet('a « b')).toEqual([{ text: 'a « b', hit: false }]);
  });
});

describe('page links — [text](page:<uuid>)', () => {
  const ID = '6f1c2a4e-1b7d-4c2a-9e51-0a0000000002';

  it('renders an internal link to /pages/<uuid>, without target=_blank', () => {
    const html = render(`See [Onboarding](page:${ID}).`);
    expect(html).toContain(`href="/pages/${ID}"`);
    expect(html).not.toContain('target="_blank"');
    expect(html).toContain('Onboarding');
  });

  it('normalises the id to lowercase', () => {
    expect(parseInline(`[x](PAGE:${ID.toUpperCase()})`)).toEqual([
      { type: 'pagelink', id: ID, children: [{ type: 'text', text: 'x' }] },
    ]);
  });

  it.each([
    'page:javascript:alert(1)',
    'page:../../admin',
    'page:/etc/passwd',
    `page:${ID}/../x`,
    `page:${ID}?x=1`,
    `page:${ID}#a`,
    'page:',
    'page:6f1c2a4e-1b7d-4c2a-9e51-0a000000000',
    `page:%36f1c2a4e-1b7d-4c2a-9e51-0a0000000002`,
  ])('renders %j as text, never as a link', (url) => {
    const html = render(`[label](${url})`);
    expect(html).not.toContain('<a');
    expect(html).toContain('label');
  });

  it('extracts linked page ids once, in order, and ignores code', () => {
    const other = '6f1c2a4e-1b7d-4c2a-9e51-0a0000000003';
    const source = [
      `# [Head](page:${ID})`,
      '',
      `Text **[bold](page:${other})** and [again](page:${ID}).`,
      '',
      `- [ ] [task](page:${other})`,
      '',
      '```',
      '[in code](page:6f1c2a4e-1b7d-4c2a-9e51-0a0000000009)',
      '```',
      '',
      '`[inline](page:6f1c2a4e-1b7d-4c2a-9e51-0a0000000008)`',
      '',
      '[external](https://example.test)',
    ].join('\n');
    expect(extractPageLinks(source)).toEqual([ID, other]);
    expect(extractPageLinks(source, 1)).toEqual([ID]);
  });
});

describe('checklist rendering', () => {
  it('shows boxes as display only, with a text for screen readers', () => {
    const html = render('- [x] shipped\n- [ ] <script>alert(1)</script>');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<script');
    expect(html).toContain('Done: ');
    expect(html).toContain('Open: ');
    expect(html).toContain('line-through');
  });
});
