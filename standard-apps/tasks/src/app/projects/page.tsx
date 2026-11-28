import { PageHeader, Table } from '@openapps/ui';
import type { ReactNode } from 'react';
import { ButtonLink, TextLink } from '@/components/links';
import { listProjects, type Project } from '@/lib/projects';

export const dynamic = 'force-dynamic';

/** Projekte mit ihren Zahlen. Dieselbe Liste liefert das Tool `projects.list`. */
interface ProjectRow {
  id: string;
  name: string;
  link: ReactNode;
  description: string;
  open: number;
  overdue: ReactNode;
  done: number;
}

const toRow = (project: Project): ProjectRow => ({
  id: project.id,
  name: project.name,
  link: (
    <TextLink href={`/all?project=${project.id}`}>
      View tasks<span className="sr-only"> in {project.name}</span>
    </TextLink>
  ),
  description: project.description,
  open: project.openCount,
  overdue:
    project.overdueCount > 0 ? (
      <span className="font-medium text-danger">{project.overdueCount}</span>
    ) : (
      0
    ),
  done: project.doneCount,
});

export default async function ProjectsPage() {
  let projects: Project[] = [];
  let failed = false;
  try {
    projects = await listProjects();
  } catch (error) {
    console.error('[tasks] loading projects:', error);
    failed = true;
  }

  return (
    <>
      <PageHeader
        eyebrow="Tasks"
        title="Projects"
        description="Projects group tasks. Open one to see its tasks."
        actions={<ButtonLink href="/projects/new">New project</ButtonLink>}
      />
      <Table<ProjectRow>
        caption="Projects"
        searchable
        rows={failed ? [] : projects.map(toRow)}
        columns={[
          { field: 'name', header: 'Project', className: 'w-1/4' },
          { field: 'description', header: 'Description', hideBelow: 'md' },
          { field: 'open', header: 'Open', align: 'right' },
          { field: 'overdue', header: 'Overdue', align: 'right', hideBelow: 'sm' },
          { field: 'done', header: 'Done', align: 'right', hideBelow: 'sm' },
          { field: 'link', header: <span className="sr-only">Tasks</span>, className: 'w-[8rem]' },
        ]}
        empty={{
          title: 'No projects yet',
          description: 'Create a project to group related tasks.',
          action: <ButtonLink href="/projects/new">New project</ButtonLink>,
        }}
        error={
          failed
            ? { title: 'Projects could not be loaded', description: 'The database did not respond. Reload the page.' }
            : undefined
        }
      />
    </>
  );
}
