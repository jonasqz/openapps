import type { SearchHit, SearchToolResult } from '@openapps/sdk';
import type { Query } from './db';
import { STAGE_LABELS, type Stage } from './domain';
import type { SearchArgs } from './schemas';
import { likePattern, prefixPattern } from './search';

/**
 * `search` — das CRM als Quelle der Suche ueber alle Apps (ADR 0021):
 * Firmen (Name, Branche, Website), Kontakte (Name, E-Mail, Telefon, Rolle)
 * und Deals (Titel), im festen Format der Plattform.
 *
 * `ilike` statt Volltext: Gesucht werden Namen und Adressen, keine Texte, und
 * „acme“ soll „ACME GmbH“ finden. Bei der Groesse eines CRM reicht ein Scan;
 * ein Trigramm-Index (pg_trgm) kaeme mit einer eigenen Migration, wenn es
 * langsam wird.
 *
 * Rangfolge: Treffer am Anfang des Namens zuerst, dann im Namen, dann in
 * anderen Feldern; je Stufe zuletzt geaenderte zuerst. Kein Rechte-Code: Wer
 * suchen darf, hat die Plattform vorher entschieden.
 */

export type CrmHitKind = 'company' | 'contact' | 'deal';

export interface CrmSearchRow extends Record<string, unknown> {
  kind: CrmHitKind;
  id: string;
  title: string;
  /** Firma, E-Mail, Rolle, Stage …, je nach Art. Leere Teile fehlen schon. */
  detail: string | null;
  stage: string | null;
  score: number;
}

const PATH: Readonly<Record<CrmHitKind, string>> = {
  company: '/companies',
  contact: '/contacts',
  deal: '/deals',
};

export const CRM_SEARCH_SQL = `
  select * from (
    select 'company' as kind, c.id::text as id, c.name as title,
           nullif(concat_ws(' · ', c.industry, c.website), '') as detail,
           null::text as stage,
           case when c.name ilike $2 then 0 when c.name ilike $1 then 1 else 2 end as score,
           c.updated_at
      from companies c
     where c.name ilike $1 or c.industry ilike $1 or c.website ilike $1
    union all
    select 'contact', p.id::text, p.name,
           nullif(concat_ws(' · ', p.email, p.role, co.name), ''),
           null::text,
           case when p.name ilike $2 then 0 when p.name ilike $1 then 1 else 2 end,
           p.updated_at
      from contacts p
      left join companies co on co.id = p.company_id
     where p.name ilike $1 or p.email ilike $1 or p.phone ilike $1 or p.role ilike $1
    union all
    select 'deal', d.id::text, d.title,
           co.name,
           d.stage,
           case when d.title ilike $2 then 0 else 1 end,
           d.updated_at
      from deals d
      join companies co on co.id = d.company_id
     where d.title ilike $1
  ) hits
  order by score, updated_at desc, kind, id
  limit $3`;

export async function searchCrm(query: Query, args: SearchArgs): Promise<SearchToolResult> {
  const rows = await query<CrmSearchRow>(CRM_SEARCH_SQL, [
    likePattern(args.query),
    prefixPattern(args.query),
    args.limit,
  ]);
  return { hits: rows.map(toCrmSearchHit) };
}

export function toCrmSearchHit(row: CrmSearchRow): SearchHit {
  const stage = row.stage !== null && row.stage in STAGE_LABELS ? STAGE_LABELS[row.stage as Stage] : null;
  const snippet = [row.detail, stage].filter((part): part is string => part !== null && part !== '').join(' · ');
  return {
    id: row.id,
    title: row.title,
    url: `${PATH[row.kind]}/${encodeURIComponent(row.id)}`,
    kind: row.kind,
    ...(snippet === '' ? {} : { snippet }),
  };
}
