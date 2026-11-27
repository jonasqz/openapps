import { ToolNotFoundError } from '@openapps/sdk';
import type { ReactNode } from 'react';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader } from '@openapps/ui';
import { AppLinks } from '@/components/AppLinks';
import { AssignButtons } from '@/components/AssignButtons';
import { CommentBox } from '@/components/CommentBox';
import { ButtonLink, TextLink } from '@/components/links';
import { CompleteButton, StatusSelect } from '@/components/StatusButtons';
import { formatDate, formatDateTime } from '@/lib/format';
import { currentUser } from '@/lib/me';
import { getTask, type TaskDetail } from '@/lib/tasks';
import { describeEvent, PRIORITY_LABELS, STATUS_LABELS } from '@/lib/workflow';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_TONE = { todo: 'neutral', in_progress: 'primary', done: 'success' } as const;

/**
 * Eine Aufgabe mit Details, Kommentaren und Verlauf. Dieselben Daten liefert
 * das Tool `tasks.get`; jede Aktion hier hat ihr Tool (`tasks.update`,
 * `tasks.complete`, `tasks.assign`, `tasks.comment`).
 */
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail: TaskDetail | null = null;
  let problem: 'missing' | 'failed' | null = null;
  if (!UUID.test(id)) {
    problem = 'missing';
  } else {
    try {
      detail = await getTask(id);
    } catch (error) {
      if (error instanceof ToolNotFoundError) problem = 'missing';
      else {
        console.error('[tasks] loading task:', error);
        problem = 'failed';
      }
    }
  }

  if (detail === null) {
    return (
      <AppLinks>
        <PageHeader breadcrumbs={[{ label: 'All tasks', href: '/all' }, { label: 'Task' }]} title="Task" />
        <ErrorState
          title={problem === 'failed' ? 'The task could not be loaded' : 'There is no such task'}
          description={
            problem === 'failed'
              ? 'The database did not respond. Reload the page.'
              : 'It may have been a wrong link. Find the task in the list.'
          }
          action={<ButtonLink href="/all" variant="secondary">All tasks</ButtonLink>}
        />
      </AppLinks>
    );
  }

  const { task, comments, history } = detail;
  const user = await currentUser();
  const me = user?.email.toLowerCase() ?? null;

  const facts: { label: string; value: ReactNode }[] = [
    {
      label: 'Status',
      value: <StatusSelect id={task.id} title={task.title} status={task.status} />,
    },
    {
      label: 'Assignee',
      value: (
        <div className="flex min-w-0 flex-col gap-2">
          <span className="[overflow-wrap:anywhere]">{task.assignee ?? 'Unassigned'}</span>
          {user === null ? null : (
            <AssignButtons
              id={task.id}
              title={task.title}
              assigned={task.assignee !== null}
              assignedToMe={task.assignee !== null && task.assignee.toLowerCase() === me}
            />
          )}
        </div>
      ),
    },
    {
      label: 'Due',
      value:
        task.dueDate === null ? (
          'No due date'
        ) : (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className={task.overdue ? 'font-medium text-danger' : undefined}>{formatDate(task.dueDate)}</span>
            {task.overdue ? <Badge tone="danger">Overdue</Badge> : null}
          </span>
        ),
    },
    { label: 'Priority', value: PRIORITY_LABELS[task.priority] },
    {
      label: 'Project',
      value:
        task.projectId === null ? (
          'No project'
        ) : (
          <TextLink href={`/all?project=${task.projectId}`}>{task.projectName ?? 'Project'}</TextLink>
        ),
    },
    { label: 'Created', value: `${formatDateTime(task.createdAt)} by ${task.createdBy}` },
    ...(task.completedAt === null
      ? []
      : [{ label: 'Completed', value: `${formatDateTime(task.completedAt)} by ${task.completedBy ?? 'unknown'}` }]),
  ];

  return (
    <AppLinks>
      <PageHeader
        breadcrumbs={[
          { label: 'All tasks', href: '/all' },
          ...(task.projectId === null
            ? []
            : [{ label: task.projectName ?? 'Project', href: `/all?project=${task.projectId}` }]),
          { label: 'Task' },
        ]}
        title={task.title}
        meta={
          <>
            <Badge tone={STATUS_TONE[task.status]} srPrefix="Status: ">
              {STATUS_LABELS[task.status]}
            </Badge>
            {task.overdue ? <Badge tone="danger">Overdue</Badge> : null}
            {task.priority === 'high' ? <Badge tone="warning">High priority</Badge> : null}
          </>
        }
        actions={
          <>
            <ButtonLink href={`/task/${task.id}/edit`} variant="secondary">
              Edit
            </ButtonLink>
            {task.status === 'done' ? null : <CompleteButton id={task.id} title={task.title} />}
          </>
        }
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader title="Description" />
            <CardBody>
              {task.description.trim() === '' ? (
                <p className="text-sm text-fg-muted">No description.</p>
              ) : (
                <p className="whitespace-pre-wrap text-sm text-fg">{task.description}</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Comments" description={`${comments.length} so far`} />
            <CardBody className="flex flex-col gap-5">
              {comments.length === 0 ? (
                <EmptyState title="No comments yet" description="Questions, decisions and links go here." />
              ) : (
                <ol className="flex min-w-0 flex-col gap-4">
                  {comments.map((comment) => (
                    <li key={comment.id} className="flex min-w-0 flex-col gap-1 border-l-2 border-border pl-3">
                      <p className="font-mono text-2xs uppercase tracking-label text-fg-muted [overflow-wrap:anywhere]">
                        {comment.author} · {formatDateTime(comment.createdAt)}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-fg">{comment.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              <CommentBox taskId={task.id} />
            </CardBody>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="flex min-w-0 flex-col gap-4">
                {facts.map((fact) => (
                  <div key={fact.label} className="flex min-w-0 flex-col gap-1">
                    <dt className="font-mono text-2xs uppercase tracking-label text-fg-muted">{fact.label}</dt>
                    <dd className="min-w-0 text-sm text-fg">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Newest first" />
            <CardBody>
              {history.length === 0 ? (
                <EmptyState title="No history" description="Changes to this task show up here." />
              ) : (
                <ol className="flex min-w-0 flex-col gap-3">
                  {[...history].reverse().map((event) => (
                    <li key={event.id} className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm text-fg [overflow-wrap:anywhere]">
                        <span className="font-medium">{event.actor}</span> {describeEvent(event)}
                      </p>
                      <p className="font-mono text-2xs text-fg-subtle">{formatDateTime(event.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </AppLinks>
  );
}
