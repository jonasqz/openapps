import { ErrorState } from '@openapps/ui';
import { TextLink } from '@/components/links';
import { TaskForm } from '@/components/TaskForm';
import { parseFilters, type SearchParams } from '@/lib/filters';
import { currentUser } from '@/lib/me';
import { listProjects, type Project } from '@/lib/projects';
import { acceptedSource } from '@/lib/refs';
import { titleFromExcerpt } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

/** Ein Parameter als Text; mehrfach gesetzt zaehlt der erste. */
function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/**
 * Neue Aufgabe. Tool: `tasks.create`. Zugewiesen ist sie zunaechst der
 * Person, die sie anlegt; `?project=<id>` waehlt das Projekt vor.
 *
 * Mit `?ref=<verweis>&excerpt=<auszug>` (die Adresse aus `list_actions`,
 * ADR 0023 E) entsteht die Aufgabe aus einem Objekt einer anderen App: Titel
 * und Beschreibung sind vorbelegt, gespeichert wird mit
 * `tasks.create_from_ref`, unter der Identitaet der Person.
 */
export default async function NewTaskPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { project } = parseFilters(params);
  const sourceRef = acceptedSource(single(params.ref));
  const excerpt = sourceRef === null ? '' : single(params.excerpt).slice(0, 2000);
  const user = await currentUser();
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
      <TextLink href="/all" className="self-start text-sm">
        ← All tasks
      </TextLink>
      {failed ? (
        <ErrorState
          title="Projects could not be loaded"
          description="You can still create the task; pick a project later. Reload the page to try again."
        />
      ) : null}
      <TaskForm
        mode="create"
        projects={projects.map((candidate) => ({ id: candidate.id, name: candidate.name }))}
        {...(sourceRef === null ? {} : { sourceRef })}
        initialValues={{
          title: sourceRef === null ? '' : titleFromExcerpt(excerpt),
          assignee: user?.email.toLowerCase() ?? '',
          dueDate: '',
          priority: 'medium',
          status: 'todo',
          projectId: projects.some((candidate) => candidate.id === project) ? project : '',
        }}
        initialDescription={excerpt}
      />
    </>
  );
}
