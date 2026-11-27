import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeSearchResult } from '@openapps/sdk';
import { parseAppManifest } from '@openapps/app-manifest';
import { CRM_SEARCH_SQL, searchCrm, toCrmSearchHit, type CrmSearchRow } from './crm-search';
import { SearchArgs } from './schemas';

/**
 * Das Such-Tool fuer die Suche ueber alle Apps (ADR 0021), ohne Datenbank:
 * Eingabe, Platzhalter im Suchtext und das feste Format der Antwort.
 */

const manifest = parseAppManifest(JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')));

function row(kind: CrmSearchRow['kind'], extra: Partial<CrmSearchRow> = {}): CrmSearchRow {
  return { kind, id: '0b6a3c1e-1d2f-4c3b-9a8e-5f6d7c8b9a01', title: 'ACME GmbH', detail: null, stage: null, score: 0, ...extra };
}

describe('search', () => {
  it('is the read tool named in the manifest, version 0.3.0', () => {
    expect(manifest.search).toEqual({ tool: 'search' });
    expect(manifest.offeredTools.find((tool) => tool.name === 'search')?.verb).toBe('read');
    expect(manifest.version).toBe('0.3.0');
  });

  it('rejects empty, too long and unknown arguments before the database', () => {
    expect(SearchArgs.safeParse({ query: '  ' }).success).toBe(false);
    expect(SearchArgs.safeParse({ query: 'x'.repeat(201) }).success).toBe(false);
    expect(SearchArgs.safeParse({ query: 'acme', limit: 21 }).success).toBe(false);
    expect(SearchArgs.safeParse({ query: 'acme', q: 'acme' }).success).toBe(false);
    expect(SearchArgs.parse({ query: ' acme ' })).toEqual({ query: 'acme', limit: 5 });
  });

  it('treats % and _ in the query as characters, not wildcards', async () => {
    const calls: unknown[][] = [];
    const fake = async <Row extends Record<string, unknown>>(_sql: string, params: readonly unknown[] = []) => {
      calls.push([...params]);
      return [] as Row[];
    };
    await searchCrm(fake, { query: '100%_a', limit: 3 });
    expect(calls[0]).toEqual(['%100\\%\\_a%', '100\\%\\_a%', 3]);
    // Nur Parameter, kein Suchtext im SQL.
    expect(CRM_SEARCH_SQL).not.toContain('100');
  });

  it('maps every kind to a path in the CRM that the platform accepts', () => {
    const hits = [
      toCrmSearchHit(row('company', { detail: 'Software · acme.example' })),
      toCrmSearchHit(row('contact', { id: '2', title: 'Lena Berg', detail: 'lena@acme.example · CTO · ACME GmbH' })),
      toCrmSearchHit(row('deal', { id: '3', title: 'ACME rollout', detail: 'ACME GmbH', stage: 'proposal' })),
    ];
    expect(hits.map((hit) => hit.url.split('/')[1])).toEqual(['companies', 'contacts', 'deals']);
    expect(hits[2]).toMatchObject({ kind: 'deal', snippet: 'ACME GmbH · Proposal' });
    expect(normalizeSearchResult({ hits }, 5)).toHaveLength(3);
  });

  it('leaves the snippet out when there is nothing to show', () => {
    expect(toCrmSearchHit(row('company'))).not.toHaveProperty('snippet');
  });
});
