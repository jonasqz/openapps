import { ToolNotFoundError } from '@openapps/sdk';
import { ErrorState } from '@openapps/ui';
import { ButtonLink, TextLink } from '@/components/links';
import { TaskForm } from '@/components/TaskForm';
import { listProjects, type Project } from '@/lib/projects';
import { getTask, type Task } from '@/lib/tasks';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aufgabe bearbeiten. Tool: `tasks.update`, nur mit den geaenderten Feldern. */
export default async function EditTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let task: Task | null = null;
  let projects: Project[] = [];
  let missing = !UUID.test(id);
  if (!missing) {
    try {
      [task, projects] = await Promise.all([getTask(id).then((detail) => detail.task), listProjects()]);
    } catch (error) {
      if (error instanceof ToolNotFoundError) missing = true;
      else console.error('[tasks] loading task for edit:', error);
    }
  }

  if (task === null) {
    return (
      <ErrorState
        title={missing ? 'There is no such task' : 'The task could not be loaded'}
        description={missing ? 'It may have been a wrong link.' : 'The database did not respond. Reload the page.'}
        action={<ButtonLink href="/all" variant="secondary">All tasks</ButtonLink>}
      />
    );
  }

  return (
    <>
      <TextLink href={`/task/${task.id}`} className="self-start text-sm">
        ← Back to the task
      </TextLink>
      <TaskForm
        mode="edit"
        taskId={task.id}
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        initialValues={{
          title: task.title,
          assignee: task.assignee ?? '',
          dueDate: task.dueDate ?? '',
          priority: task.priority,
          status: task.status,
          projectId: task.projectId ?? '',
        }}
        initialDescription={task.description}
      />
    </>
  );
}
