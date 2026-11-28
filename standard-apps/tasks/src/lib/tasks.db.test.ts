import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, runSeeds, ToolInputError, ToolNotFoundError, type PlatformUser } from '@openapps/sdk';
import type { Project } from './projects';
import type { Task, TaskDetail, UpdateResult } from './tasks';

/**
 * Gegen ein echtes Postgres: Migrationen, Beispieldaten und die Tools mit
 * ihren Seiteneffekten (Abschluss, Verlauf, Undo-Schutz). Laeuft nur, wenn
 * TASKS_TEST_DATABASE_URL und TASKS_TEST_DATABASE_SCHEMA gesetzt sind, sonst
 * uebersprungen.
 *
 * Erwartet ein **leeres** Schema, das der Rolle gehoert (wie es
 * provision_app_schema anlegt), und eine Rolle ohne SUPERUSER und BYPASSRLS.
 * Der Test prueft das selbst.
 */

const url = process.env.TASKS_TEST_DATABASE_URL ?? '';
const schema = process.env.TASKS_TEST_DATABASE_SCHEMA ?? '';
const enabled = url !== '' && schema !== '';

const AGENT: PlatformUser = {
  id: 'agent:test',
  email: 'test@agents.invalid',
  groups: [],
  issuedAt: new Date(),
};

const HUMAN: PlatformUser = {
  id: 'u_viewer',
  email: 'Viewer@Local.test',
  groups: [],
  issuedAt: new Date(),
};

const WEBSITE = '0e000000-0000-4000-8000-000000000001';
const PHOTOS = '0f000000-0000-4000-8000-000000000002';
const UNKNOWN = '0f000000-0000-4000-8000-0000000000ff';

describe.skipIf(!enabled)('Tasks against Postgres', () => {
  // Erst nach dem Setzen der Env laden: der Pool liest sie beim ersten Gebrauch.
  let db: typeof import('./db');
  let tools: (typeof import('./tools'))['toolHandlers'];

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DATABASE_SCHEMA = schema;
    db = await import('./db');
    tools = (await import('./tools')).toolHandlers;
  });

  afterAll(async () => {
    await db?.appPool().end();
  });

  // Antworten als unknown: jeder Test sagt selbst, welche Form er erwartet.
  const run = (name: keyof typeof tools, args: unknown, user: PlatformUser = AGENT): Promise<unknown> =>
    tools[name](args, { user });

  const events = async (id: string) => ((await run('tasks.get', { id })) as TaskDetail).history;

  it('connects with a role without SUPERUSER and without BYPASSRLS', async () => {
    const rows = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      'select rolsuper, rolbypassrls from pg_roles where rolname = current_user',
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('applies migrations and both sample files, and nothing on the second run', async () => {
    const dir = join(process.cwd(), 'migrations');
    const seeds = join(process.cwd(), 'seeds');
    const sample = { OPENAPPS_SAMPLE_DATA: '1' };
    const first = await runMigrations(db.appPool(), dir);
    expect(first.applied).toEqual([
      '0001_tasks.sql',
      '0002_projects.sql',
      '0003_task_workflow.sql',
      '0004_task_comments.sql',
      '0005_task_events.sql',
      '0006_event_outbox.sql',
      '0007_refs.sql',
    ]);
    expect((await runSeeds(db.appPool(), seeds, sample))?.applied).toEqual([
      'seed/0001_sample.sql',
      'seed/0002_workflow.sql',
    ]);
    expect((await runMigrations(db.appPool(), dir)).applied).toEqual([]);
    expect((await runSeeds(db.appPool(), seeds, sample))?.applied).toEqual([]);
  });

  it('derives the status of the 0.1 sample data from completed (trigger)', async () => {
    const rows = await db.query<{ title: string; status: string; completed: boolean }>(
      `select title, status, completed from tasks where created_by = 'seed' and project_id is null order by title`,
    );
    expect(rows).toEqual([
      { title: 'Clean up the team calendar', status: 'done', completed: true },
      { title: 'Prepare the quarterly report', status: 'todo', completed: false },
      { title: 'Schedule the onboarding session', status: 'todo', completed: false },
    ]);
    const missing = await db.query(
      `select id from tasks t where not exists (select 1 from task_events e where e.task_id = t.id)`,
    );
    expect(missing).toEqual([]);
  });

  it('keeps status = done and completed_at together in the database itself', async () => {
    await expect(
      db.query(`update tasks set completed_at = null where status = 'done'`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query(`update tasks set status = 'done' where id = $1`, [PHOTOS]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('lists "my open tasks" by the caller email, case-insensitive', async () => {
    const { tasks } = (await run('tasks.list', { mine: true, completed: false }, HUMAN)) as { tasks: Task[] };
    expect(tasks.length).toBe(3);
    expect(tasks.every((task) => task.assignee === 'viewer@local.test' && task.status !== 'done')).toBe(true);
    // In Arbeit zuerst.
    expect(tasks[0]?.status).toBe('in_progress');
  });

  it('marks overdue tasks and filters by it', async () => {
    const { tasks } = (await run('tasks.list', { overdue: true })) as { tasks: Task[] };
    expect(tasks.map((task) => task.title).sort()).toEqual([
      'Check the cookie banner with legal',
      'Collect photos of the team',
    ]);
    expect(tasks.every((task) => task.overdue)).toBe(true);
  });

  it('creates a task with a lowercased assignee and a created event', async () => {
    const { task } = (await run('tasks.create', {
      title: '  Book the launch party  ',
      assignee: 'Sam@Example.com',
      dueDate: '2030-01-15',
      priority: 'high',
      projectId: WEBSITE,
    })) as { task: Task };
    expect(task).toMatchObject({
      title: 'Book the launch party',
      assignee: 'sam@example.com',
      status: 'todo',
      priority: 'high',
      projectName: 'Website relaunch',
      createdBy: 'agent:test',
      completedAt: null,
      overdue: false,
    });
    expect((await events(task.id)).map((event) => event.kind)).toEqual(['created']);
  });

  it('rolls back a task with an unknown project', async () => {
    const before = await db.query('select id from tasks');
    await expect(run('tasks.create', { title: 'Orphan', projectId: UNKNOWN })).rejects.toBeInstanceOf(
      ToolInputError,
    );
    expect((await db.query('select id from tasks')).length).toBe(before.length);
  });

  it('completes, refuses a second completion quietly, and undoes with the guard', async () => {
    const before = await events(PHOTOS);

    const done = (await run('tasks.complete', { id: PHOTOS }, HUMAN)) as UpdateResult;
    expect(done.changed).toBe(true);
    expect(done.previousStatus).toBe('todo');
    expect(done.task.status).toBe('done');
    expect(done.task.completed).toBe(true);
    expect(done.task.completedBy).toBe('viewer@local.test');
    expect(done.task.completedAt).not.toBeNull();
    expect(done.task.overdue).toBe(false);

    const again = (await run('tasks.complete', { id: PHOTOS })) as UpdateResult;
    expect(again.changed).toBe(false);
    expect(again.task.completedBy).toBe('viewer@local.test');

    const afterDone = await events(PHOTOS);
    expect(afterDone.length).toBe(before.length + 1);
    expect(afterDone.at(-1)).toMatchObject({ kind: 'status', from: 'todo', to: 'done', actor: 'viewer@local.test' });

    // Undo wie der Toast: zurueck auf den vorigen Status, nur wenn noch Done.
    const undone = (await run(
      'tasks.update',
      { id: PHOTOS, status: done.previousStatus, expectedStatus: 'done' },
      HUMAN,
    )) as UpdateResult;
    expect(undone.task).toMatchObject({ status: 'todo', completedAt: null, completedBy: null, overdue: true });

    // Ein zweites Undo darf nichts mehr umwerfen.
    await expect(
      run('tasks.update', { id: PHOTOS, status: 'todo', expectedStatus: 'done' }),
    ).rejects.toThrow(/nothing was changed/);
    expect((await events(PHOTOS)).length).toBe(before.length + 2);
  });

  it('moves through in progress and back without touching the completion', async () => {
    const started = (await run('tasks.update', { id: PHOTOS, status: 'in_progress' })) as UpdateResult;
    expect(started.task).toMatchObject({ status: 'in_progress', completedAt: null });
    const back = (await run('tasks.update', { id: PHOTOS, status: 'todo' })) as UpdateResult;
    expect(back.previousStatus).toBe('in_progress');
  });

  it('records nothing for an update without a real change', async () => {
    const before = await events(PHOTOS);
    const result = (await run('tasks.update', {
      id: PHOTOS,
      title: 'Collect photos of the team',
      assignee: 'VIEWER@local.test',
    })) as UpdateResult;
    expect(result.changed).toBe(false);
    expect((await events(PHOTOS)).length).toBe(before.length);
  });

  it('assigns and unassigns with history', async () => {
    const assigned = (await run('tasks.assign', { id: PHOTOS, assignee: 'sam@example.com' })) as UpdateResult;
    expect(assigned.task.assignee).toBe('sam@example.com');
    const unassigned = (await run('tasks.assign', { id: PHOTOS, assignee: null })) as UpdateResult;
    expect(unassigned.task.assignee).toBeNull();
    const { tasks } = (await run('tasks.list', { unassigned: true })) as { tasks: Task[] };
    expect(tasks.some((task) => task.id === PHOTOS)).toBe(true);
    const kinds = (await events(PHOTOS)).filter((event) => event.kind === 'assignee');
    expect(kinds.slice(-2).map((event) => event.to)).toEqual(['sam@example.com', null]);
  });

  it('comments with the caller as author, and 404 for an unknown task', async () => {
    const { comment } = (await run('tasks.comment', { id: PHOTOS, body: '  Ask the studio.  ' })) as {
      comment: { body: string; author: string };
    };
    expect(comment).toMatchObject({ body: 'Ask the studio.', author: 'agent:test' });
    const detail = (await run('tasks.get', { id: PHOTOS })) as TaskDetail;
    expect(detail.comments.at(-1)?.body).toBe('Ask the studio.');
    expect(detail.task.commentCount).toBe(detail.comments.length);
    await expect(run('tasks.comment', { id: UNKNOWN, body: 'Hi' })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(run('tasks.complete', { id: UNKNOWN })).rejects.toBeInstanceOf(ToolNotFoundError);
    await expect(run('tasks.get', { id: UNKNOWN })).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it('moves a task between projects and records the names', async () => {
    const { project } = (await run('projects.create', { name: 'Hiring' })) as { project: Project };
    await run('tasks.update', { id: PHOTOS, projectId: project.id });
    const removed = (await run('tasks.update', { id: PHOTOS, projectId: null })) as UpdateResult;
    expect(removed.task.projectName).toBeNull();
    const projectEvents = (await events(PHOTOS)).filter((event) => event.kind === 'project');
    expect(projectEvents.slice(-2)).toMatchObject([
      { from: 'Website relaunch', to: 'Hiring' },
      { from: 'Hiring', to: null },
    ]);
  });

  it('refuses a duplicate project name regardless of case', async () => {
    await expect(run('projects.create', { name: 'website RELAUNCH' })).rejects.toThrow(/already exists/);
    const { projects } = (await run('projects.list', {})) as { projects: Project[] };
    const website = projects.find((project) => project.id === WEBSITE);
    expect(website?.overdueCount).toBe(1);
  });

  it('treats % and _ in a search as characters', async () => {
    await run('tasks.create', { title: 'Raise prices by 5%' });
    const hit = (await run('tasks.list', { query: '5%' })) as { tasks: Task[] };
    expect(hit.tasks.map((task) => task.title)).toEqual(['Raise prices by 5%']);
    const none = (await run('tasks.list', { query: '_' })) as { tasks: Task[] };
    expect(none.tasks).toEqual([]);
  });

  it('queues events with the change and delivers them once the platform is back (ADR 0022)', async () => {
    const { taskEvents } = await import('./events');
    await taskEvents.settle();
    await db.query('delete from event_outbox');
    // Ohne Plattform: Speichern gelingt, das Ereignis wartet.
    delete process.env.OPENAPPS_PLATFORM_URL;
    await run('tasks.assign', { id: PHOTOS, assignee: 'kim@example.com' }, HUMAN);
    await run('tasks.comment', { id: PHOTOS, body: 'Ping' }, HUMAN);
    await taskEvents.settle();
    const waiting = await db.query<{ type: string; audience: string[]; actor: string }>(
      `select payload->>'type' as type, array(select jsonb_array_elements_text(payload->'audience')) as audience,
              payload->>'actor' as actor
         from event_outbox order by version`,
    );
    expect(waiting.map((row) => row.type)).toEqual(['task.assigned', 'task.commented']);
    expect(waiting[0]?.audience).toEqual(['human:kim@example.com']);
    expect(waiting[0]?.actor).toBe('human:viewer@local.test');
    expect((await taskEvents.status()).failing).toBeGreaterThan(0);

    // Die Plattform ist wieder da: geliefert, Outbox leer.
    const received: unknown[] = [];
    const { createServer } = await import('node:http');
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push({ url: req.url, caller: req.headers['x-openapps-caller'], body: JSON.parse(body) });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"accepted"}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    process.env.OPENAPPS_PLATFORM_URL = `http://127.0.0.1:${String(port)}`;
    process.env.OPENAPPS_CALL_SECRET = 'c'.repeat(64);
    process.env.OPENAPPS_APP_ID = 'tasks';
    try {
      const report = await taskEvents.deliverPending();
      expect(report).toMatchObject({ delivered: 2, pending: 0, stopped: false });
      expect(received).toHaveLength(2);
      expect(received[0]).toMatchObject({ url: '/api/apps/platform/tools/emit_event', caller: 'tasks' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      delete process.env.OPENAPPS_PLATFORM_URL;
      delete process.env.OPENAPPS_CALL_SECRET;
    }
  });

  it('creates a task from a wiki page as the caller and reports the full set of references (ADR 0023)', async () => {
    const { taskRefs } = await import('./refs');
    await taskRefs.settle();
    await db.query('delete from refs_outbox');
    delete process.env.OPENAPPS_PLATFORM_URL;
    const created = (await run(
      'tasks.create_from_ref',
      { sourceRef: 'wiki:page:p1', excerpt: '## Ship the offer\nAsk @{human:kim@example.com}' },
      HUMAN,
    )) as { task: Task };
    expect(created.task).toMatchObject({
      title: 'Ship the offer',
      sourceRef: 'wiki:page:p1',
      createdBy: 'viewer@local.test',
    });
    await run('tasks.comment', { id: created.task.id, body: 'See @{crm:deal:d1}' }, HUMAN);
    await taskRefs.settle();
    const rows = await db.query<{ key: string; payload: { targets: { ref: string; kind: string }[] } }>(
      'select key, payload from refs_outbox',
    );
    expect(rows.map((row) => row.key)).toEqual([`tasks:task:${created.task.id}`]);
    expect(rows[0]?.payload.targets).toEqual([
      { ref: 'wiki:page:p1', kind: 'derived' },
      { ref: 'human:kim@example.com', kind: 'mention' },
      { ref: 'crm:deal:d1', kind: 'link' },
    ]);
    const resolved = (await run('tasks.resolve', { type: 'task', ids: [created.task.id, UNKNOWN] })) as {
      objects: { id: string; title: string; path: string }[];
    };
    expect(resolved.objects).toEqual([
      expect.objectContaining({ id: created.task.id, title: 'Ship the offer', path: `/task/${created.task.id}` }),
    ]);
  });

  it('finds tasks and projects for the platform search (ADR 0021)', async () => {
    const found = (await run('search', { query: 'website', limit: 10 })) as {
      hits: { id: string; kind: string; url: string }[];
    };
    expect(found.hits.some((hit) => hit.kind === 'project' && hit.id === WEBSITE)).toBe(true);
    for (const hit of found.hits) expect(hit.url).toMatch(/^\/(task\/|all\?project=)[0-9a-f-]{36}$/);
    const prices = (await run('search', { query: '5%' })) as { hits: { title: string }[] };
    expect(prices.hits.map((hit) => hit.title)).toEqual(['Raise prices by 5%']);
  });
});
