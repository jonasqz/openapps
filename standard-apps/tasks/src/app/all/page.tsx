import { PageHeader } from '@openapps/ui';
import { FilterBar } from '@/components/FilterBar';
import { ButtonLink } from '@/components/links';
import { TaskTable } from '@/components/TaskTable';
import { isFiltered, parseFilters, toListArgs, type SearchParams } from '@/lib/filters';
import { currentUser } from '@/lib/me';
import { listProjects, type Project } from '@/lib/projects';
import { toRowData } from '@/lib/rows';
import { listAssignees, listTasks, type Task } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

const LIMIT = 200;

/**
 * Alle Aufgaben mit Filtern aus der Adresse (Status, Zuweisung, Projekt,
 * ueberfaellig) und der Suche der Tabelle. Dieselben Filter hat das Tool
 * `tasks.list`.
 */
export default async function AllTasksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filters = parseFilters(await searchParams);
  const user = await currentUser();

  let tasks: Task[] = [];
  let projects: Project[] = [];
  let assignees: string[] = [];
  let failed = false;
  try {
    // "Me" braucht eine Anmeldung; ohne sie faellt der Filter weg statt zu werfen.
    const effective = filters.assignee === 'me' && user === null ? { ...filters, assignee: '' } : filters;
    [tasks, projects, assignees] = await Promise.all([
      listTasks(toListArgs(effective, LIMIT), user?.email ?? null),
      listProjects(),
      listAssignees(),
    ]);
  } catch (error) {
    console.error('[tasks] loading list:', error);
    failed = true;
  }

  const filtered = isFiltered(filters);
  const project = projects.find((candidate) => candidate.id === filters.project);

  return (
    <>
      <PageHeader
        eyebrow="Tasks"
        title={project === undefined ? 'All tasks' : project.name}
        description={
          tasks.length >= LIMIT
            ? `Showing the first ${LIMIT} tasks. Narrow the filters to see the rest.`
            : 'In progress first, then to do by due date, done last.'
        }
        actions={
          <ButtonLink href={project === undefined ? '/new' : `/new?project=${project.id}`}>New task</ButtonLink>
        }
      />
      <FilterBar values={filters} assignees={assignees} projects={projects} />
      <TaskTable
        caption="Tasks"
        tasks={failed ? [] : tasks.map(toRowData)}
        empty={
          filtered
            ? {
                title: 'No tasks match these filters',
                description: 'Change or clear the filters above.',
              }
            : {
                title: 'No tasks yet',
                description: 'Create the first task and it will show up here.',
                action: <ButtonLink href="/new">New task</ButtonLink>,
              }
        }
        error={
          failed
            ? {
                title: 'Tasks could not be loaded',
                description: 'The database did not respond. Reload the page.',
              }
            : undefined
        }
      />
    </>
  );
}
