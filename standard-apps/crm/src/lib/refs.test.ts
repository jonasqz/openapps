import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAppManifest } from '@openapps/app-manifest';
import { parseSetRefs } from '@openapps/sdk';
import { CRM_OBJECT_TYPES, crmRefsReport, hasRefs, resolveCrmObjects, subjectPath } from './refs';

/**
 * Verweise im CRM (ADR 0023), ohne Datenbank. Riskant: eine Meldung, die die
 * Plattform ablehnt; ein Resolver, der fremde Ids an die Datenbank gibt;
 * ein Manifest, das Objektarten nennt, die der Resolver nicht kennt.
 */

const manifest = parseAppManifest(
  JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')),
);

describe('Manifest', () => {
  it('erklaert genau die Objektarten des Resolvers und beantragt set_refs fuer sich', () => {
    expect((manifest.objects ?? []).map((object) => object.type)).toEqual([...CRM_OBJECT_TYPES]);
    expect(new Set((manifest.objects ?? []).map((object) => object.resolver))).toEqual(
      new Set(['crm.resolve']),
    );
    expect(manifest.requestedGrants).toContainEqual(
      expect.objectContaining({
        subjectKind: 'app',
        subjectId: 'crm',
        verb: 'execute',
        resource: { kind: 'tool', app: 'platform', name: 'set_refs' },
      }),
    );
  });
});

describe('crmRefsReport', () => {
  it('meldet die Verweise aus Betreff und Text einer Notiz', () => {
    const report = crmRefsReport({
      type: 'activity',
      id: '0c000000-0000-4000-8000-000000000001',
      title: 'Call with @{human:kim@example.com}',
      texts: ['Call with @{human:kim@example.com}', 'Follow up in @{tasks:task:42}'],
      path: subjectPath({ deal_id: 'd1', contact_id: null, company_id: 'c1' }),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      actor: 'u_sales',
    });
    expect(parseSetRefs(report, new Date('2026-01-02T00:00:00.000Z'))).toMatchObject({
      source: 'crm:activity:0c000000-0000-4000-8000-000000000001',
      path: '/deals/d1',
      actor: 'user:u_sales',
      targets: [
        { ref: 'human:kim@example.com', kind: 'mention' },
        { ref: 'tasks:task:42', kind: 'link' },
      ],
    });
    expect(hasRefs('plain text', null)).toBe(false);
  });
});

describe('resolveCrmObjects', () => {
  it('fragt die Datenbank nicht nach Ids, die keine UUID sind', async () => {
    const seen: unknown[] = [];
    const q = (async (_sql: string, params: readonly unknown[] = []) => {
      seen.push(params);
      return [];
    }) as Parameters<typeof resolveCrmObjects>[0];
    expect(await resolveCrmObjects(q, { type: 'deal', ids: ["x' or '1'='1"] })).toEqual({ objects: [] });
    expect(seen).toEqual([]);
  });

  it('zeigt bei Deals die Stage als Status und verlinkt auf die Seite des Bezugs', async () => {
    const q = (async () => [
      {
        id: '0d000000-0000-4000-8000-000000000001',
        title: 'Website relaunch',
        status: 'won',
        deal_id: '0d000000-0000-4000-8000-000000000001',
        contact_id: null,
        company_id: null,
        updated_at: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]) as unknown as Parameters<typeof resolveCrmObjects>[0];
    const result = await resolveCrmObjects(q, {
      type: 'deal',
      ids: ['0d000000-0000-4000-8000-000000000001'],
    });
    expect(result.objects[0]).toMatchObject({
      title: 'Website relaunch',
      path: '/deals/0d000000-0000-4000-8000-000000000001',
    });
    expect(result.objects[0]?.status).toBeDefined();
  });
});
