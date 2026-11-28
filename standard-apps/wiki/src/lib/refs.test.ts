import { describe, expect, it } from 'vitest';
import { parseSetRefs } from '@openapps/sdk';
import { extractRefTokens, pageSections, parseInline } from './markdown';
import { pageRefsReport } from './refs';

/**
 * Verweise im Wiki (ADR 0023), ohne Datenbank. Riskant: ein Verweis in Code,
 * der doch gemeldet wird; ein Titel im Text statt des Verweises; eine
 * archivierte Seite, die weiter verweist.
 */

describe('Verweise im Markdown', () => {
  it('liest @{…} als Verweis, ungueltige bleiben Text', () => {
    expect(parseInline('Ask @{human:Anna@Example.com} about @{tasks:task:42} @{nope} @{a b}')).toEqual([
      { type: 'text', text: 'Ask ' },
      { type: 'ref', ref: 'human:anna@example.com' },
      { type: 'text', text: ' about ' },
      { type: 'ref', ref: 'tasks:task:42' },
      { type: 'text', text: ' @{nope} @{a b}' },
    ]);
  });

  it('meldet Verweise ausserhalb von Code, ohne Doppel', () => {
    const source = [
      '# Plan',
      'See @{tasks:task:42} and **@{crm:deal:d1}**',
      '- [ ] call @{human:kim@example.com}',
      '`@{tasks:task:99}`',
      '```',
      '@{tasks:task:98}',
      '```',
      'Again @{tasks:task:42}',
    ].join('\n');
    expect(extractRefTokens(source)).toEqual([
      'tasks:task:42',
      'crm:deal:d1',
      'human:kim@example.com',
    ]);
  });

  it('teilt eine Seite in Abschnitte je Ueberschrift', () => {
    const sections = pageSections('Intro\n# One\nA\n## Sub\nB\n# Two\nC\n```\n# not a heading\n```');
    expect(sections.map((s) => s.heading)).toEqual(['One', 'Sub', 'Two']);
    expect(sections[0]?.excerpt).toBe('# One\nA\n## Sub\nB');
    expect(sections[2]?.excerpt).toContain('# not a heading');
  });
});

describe('pageRefsReport', () => {
  const page = {
    id: '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
    title: 'Meeting notes',
    contentMd: 'Ask @{human:kim@example.com}, see @{tasks:task:42}',
    archived: false,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    actor: 'u_anna',
  };

  it('meldet die ganze Menge mit Titel und Pfad der Seite', () => {
    const parsed = parseSetRefs(pageRefsReport(page), new Date('2026-01-02T00:00:00.000Z'));
    expect(parsed).toMatchObject({
      source: 'wiki:page:6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
      title: 'Meeting notes',
      path: '/pages/6f1c2a4e-1b7d-4c2a-9e51-0a0000000001',
      actor: 'user:u_anna',
      targets: [
        { ref: 'human:kim@example.com', kind: 'mention' },
        { ref: 'tasks:task:42', kind: 'link' },
      ],
    });
  });

  it('eine archivierte Seite meldet die leere Menge', () => {
    expect(pageRefsReport({ ...page, archived: true }).targets).toEqual([]);
  });
});
