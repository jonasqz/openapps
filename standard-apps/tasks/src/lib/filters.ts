import { z } from 'zod';
import type { TaskListArgs } from './schemas';
import { isStatus, type Status } from './workflow';

/**
 * Filter der Liste und des Boards aus der Adresse (`?status=open&assignee=me`).
 * Die Adresse kommt vom Browser und ist damit Eingabe: Unbekannte Werte
 * fallen weg, statt einen Fehler zu werfen — ein alter Lesezeichen-Link soll
 * die Liste zeigen, nicht eine Fehlerseite.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** Was die Filterleiste anzeigt. Leer heisst: nicht gefiltert. */
export interface FilterValues {
  /** '' | 'open' | Status */
  status: '' | 'open' | Status;
  /** '' | 'me' | 'none' | E-Mail */
  assignee: string;
  /** '' | Projekt-UUID */
  project: string;
  overdue: boolean;
}

const Uuid = z.string().uuid();
const Email = z.string().email().max(200);

function first(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? '').trim();
}

export function parseFilters(params: SearchParams): FilterValues {
  const status = first(params.status);
  const assignee = first(params.assignee).toLowerCase();
  const project = first(params.project);
  return {
    status: status === 'open' || isStatus(status) ? status : '',
    assignee:
      assignee === 'me' || assignee === 'none' || Email.safeParse(assignee).success ? assignee : '',
    project: Uuid.safeParse(project).success ? project : '',
    overdue: first(params.overdue) === '1',
  };
}

/** Die Filter als Argumente fuer `tasks.list`. */
export function toListArgs(filters: FilterValues, limit: number): TaskListArgs {
  const args: TaskListArgs = { limit };
  if (filters.status === 'open') args.completed = false;
  else if (filters.status !== '') args.status = filters.status;
  if (filters.assignee === 'me') args.mine = true;
  else if (filters.assignee === 'none') args.unassigned = true;
  else if (filters.assignee !== '') args.assignee = filters.assignee;
  if (filters.project !== '') args.projectId = filters.project;
  if (filters.overdue) args.overdue = true;
  return args;
}

/** Die Filter als Adresse, ohne leere Werte. */
export function filtersToQuery(filters: FilterValues): string {
  const params = new URLSearchParams();
  if (filters.status !== '') params.set('status', filters.status);
  if (filters.assignee !== '') params.set('assignee', filters.assignee);
  if (filters.project !== '') params.set('project', filters.project);
  if (filters.overdue) params.set('overdue', '1');
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export function isFiltered(filters: FilterValues): boolean {
  return filtersToQuery(filters) !== '';
}
