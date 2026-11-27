import type { SearchHit, SearchToolResult } from '@openapps/sdk';
import type { Query } from './db';
import type { SearchArgs } from './schemas';
import { likePattern } from './tasks';
import { isStatus, STATUS_LABELS } from './workflow';

/**
 * `search` — Tasks als Quelle der Suche ueber alle Apps (ADR 0021): Aufgaben
 * (Titel, Beschreibung) und Projekte (Name, Beschreibung), im festen Format
 * der Plattform. Kein Rechte-Code: Wer suchen darf, hat die Plattform
 * entschieden; hier wird nur gesucht.
 *
 * `ilike` statt Volltext, wie `tasks.list` mit `query`: Titel sind kurz und
 * oft Namen. Rangfolge: Titel beginnt mit dem Suchtext, Titel enthaelt ihn,
 * nur die Beschreibung; je Stufe offene vor erledigten Aufgaben, dann zuletzt
 * geaenderte zuerst. Ohne Index, bis die Tabelle das verlangt.
 */

export type TaskHitKind = 'task' | 'project';

export interface TaskSearchRow extends Record<string, unknown> {
  kind: TaskHitKind;
  id: string;
  title: string;
  /** Aufgabe: Status; Projekt: null. */
  status: string | null;
  /** Aufgabe: Projektname; Projekt: Beschreibung. */
  detail: string | null;
  score: number;
}

export const TASK_SEARCH_SQL = `
  select * from (
    select 'task' as kind, t.id::text as id, t.title, t.status,
           p.name as detail,
           case when t.title ilike $2 then 0 when t.title ilike $1 then 1 else 2 end as score,
           case when t.status = 'done' then 1 else 0 end as done,
           t.updated_at as changed_at
      from tasks t
      left join projects p on p.id = t.project_id
     where t.title ilike $1 or t.description ilike $1
    union all
    select 'project', p.id::text, p.name, null::text,
           nullif(p.description, ''),
           case when p.name ilike $2 then 0 when p.name ilike $1 then 1 else 2 end,
           0,
           p.created_at
      from projects p
     where p.name ilike $1 or p.description ilike $1
  ) hits
  order by score, done, changed_at desc, kind, id
  limit $3`;

/** Wie `likePattern`, aber nur am Anfang. Fuer die Rangfolge. */
function prefixPattern(text: string): string {
  return likePattern(text).slice(1);
}

export async function searchTasks(query: Query, args: SearchArgs): Promise<SearchToolResult> {
  const rows = await query<TaskSearchRow>(TASK_SEARCH_SQL, [
    likePattern(args.query),
    prefixPattern(args.query),
    args.limit,
  ]);
  return { hits: rows.map(toTaskSearchHit) };
}

export function toTaskSearchHit(row: TaskSearchRow): SearchHit {
  const status = row.status !== null && isStatus(row.status) ? STATUS_LABELS[row.status] : null;
  const snippet = [status, row.detail].filter((part): part is string => part !== null && part !== '').join(' · ');
  const id = encodeURIComponent(row.id);
  return {
    id: row.id,
    title: row.title,
    // Projekte haben keine eigene Seite; die Liste, gefiltert auf das Projekt.
    url: row.kind === 'task' ? `/task/${id}` : `/all?project=${id}`,
    kind: row.kind,
    ...(snippet === '' ? {} : { snippet }),
  };
}
