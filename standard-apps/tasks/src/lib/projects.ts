import { ToolInputError } from '@openapps/sdk';
import { pgCode, query } from './db';
import type { ProjectCreateArgs } from './schemas';

/** Projekte gruppieren Aufgaben. Eine Aufgabe gehoert zu hoechstens einem. */

export interface Project {
  id: string;
  name: string;
  description: string;
  openCount: number;
  overdueCount: number;
  doneCount: number;
  createdBy: string;
  createdAt: string;
}

interface ProjectRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string;
  open_count: number;
  overdue_count: number;
  done_count: number;
  created_by: string;
  created_at: Date;
}

const toProject = (row: ProjectRow): Project => ({
  id: row.id,
  name: row.name,
  description: row.description,
  openCount: row.open_count,
  overdueCount: row.overdue_count,
  doneCount: row.done_count,
  createdBy: row.created_by,
  createdAt: row.created_at.toISOString(),
});

const SELECT_PROJECT = `
  select p.id, p.name, p.description, p.created_by, p.created_at,
         count(t.id) filter (where t.status <> 'done')::int as open_count,
         count(t.id) filter (where t.status <> 'done' and t.due_date < current_date)::int as overdue_count,
         count(t.id) filter (where t.status = 'done')::int as done_count
    from projects p
    left join tasks t on t.project_id = p.id`;

/** Alle Projekte nach Name. Es sind wenige; eine Seitenteilung braucht es nicht. */
export async function listProjects(): Promise<Project[]> {
  const rows = await query<ProjectRow>(
    `${SELECT_PROJECT} group by p.id order by lower(p.name) limit 500`,
  );
  return rows.map(toProject);
}

export async function createProject(input: ProjectCreateArgs, actor: string): Promise<Project> {
  let id: string | undefined;
  try {
    const rows = await query<{ id: string }>(
      `insert into projects (name, description, created_by) values ($1, $2, $3) returning id`,
      [input.name, input.description ?? '', actor],
    );
    id = rows[0]?.id;
  } catch (error) {
    if (pgCode(error) === '23505') {
      const message = `A project named "${input.name}" already exists. Use projects.list to get its id.`;
      throw new ToolInputError(message, [{ path: ['name'], message }]);
    }
    throw error;
  }
  if (id === undefined) throw new Error('insert returned no row');
  const rows = await query<ProjectRow>(`${SELECT_PROJECT} where p.id = $1 group by p.id`, [id]);
  const row = rows[0];
  if (row === undefined) throw new Error('project vanished after insert');
  return toProject(row);
}
