import {
  actorOf,
  createRefsOutbox,
  ownRef,
  parseObjectRef,
  parseResolveArgs,
  refTargetsFromText,
  type ResolveToolResult,
  type SetRefsInput,
} from '@openapps/sdk';
import { query, type Query } from './db';
import { isStatus, STATUS_LABELS } from './workflow';

/**
 * Verweise zwischen Apps (ADR 0023), die Seite von Tasks:
 *
 * - **Resolver** `tasks.resolve` fuer `task` und `project` (Manifest unter
 *   `objects`): Titel, Pfad, Status. Die Plattform ruft ihn erst, nachdem
 *   sie geprueft hat, dass der Betrachter Tasks lesen darf; hier steht kein
 *   Rechte-Code.
 * - **Ausgehende Verweise** einer Aufgabe: `@{…}` in Beschreibung und
 *   Kommentaren und die Quelle, aus der sie entstand (`source_ref`, Art
 *   `derived`). Gemeldet wird immer die ganze Menge, ueber die Outbox in
 *   derselben Transaktion wie die Aenderung.
 */

export const TASK_OBJECT_TYPES = ['task', 'project'] as const;

/** Die Arten, aus denen `tasks.create_from_ref` eine Aufgabe macht (Manifest `actions`). */
export const ACCEPTED_SOURCES = ['wiki:page', 'crm:deal'] as const;

export const taskRefs = createRefsOutbox({ query, name: '[tasks] refs' });

/** Nach dem Commit: liefern, ohne zu warten. Wirft nie. */
export function kickRefs(): void {
  taskRefs.kick();
}

/** Der Verweis auf eine eigene Aufgabe. */
export const taskRef = (id: string): string => ownRef('tasks', 'task', id).ref;

/**
 * Die Meldung fuer eine Aufgabe, aus ihrem Stand. Rein, fuer Tests. Die
 * Quelle (`derived`) zuerst, dann die Verweise aus Beschreibung und
 * Kommentaren; dieselbe Quelle im Text bleibt `derived`.
 */
export function taskRefsReport(task: {
  id: string;
  title: string;
  description: string;
  sourceRef: string | null;
  comments: readonly string[];
  updatedAt: Date;
  actor: string | null;
}): SetRefsInput {
  const derived = task.sourceRef === null ? [] : [{ ref: task.sourceRef, kind: 'derived' as const }];
  return {
    source: taskRef(task.id),
    targets: [...derived, ...refTargetsFromText(task.description, ...task.comments)],
    updatedAt: task.updatedAt,
    title: task.title,
    path: `/task/${encodeURIComponent(task.id)}`,
    actor: actorOf(task.actor),
  };
}

/** Reiht die Verweise der Aufgabe ein. Nur in der Transaktion der Aenderung. */
export async function reportTaskRefs(q: Query, taskId: string, actor: string): Promise<void> {
  const rows = await q<{
    id: string;
    title: string;
    description: string;
    source_ref: string | null;
    updated_at: Date;
  }>('select id, title, description, source_ref, updated_at from tasks where id = $1', [taskId]);
  const task = rows[0];
  if (task === undefined) return;
  const comments = await q<{ body: string; created_at: Date }>(
    'select body, created_at from task_comments where task_id = $1 order by created_at, id',
    [taskId],
  );
  // Der Stand ist der juengste Zeitpunkt aus Aufgabe und Kommentaren: Ein
  // Kommentar aendert die Aufgabe selbst nicht.
  const latest = comments.reduce(
    (max, row) => (row.created_at.getTime() > max.getTime() ? row.created_at : max),
    task.updated_at,
  );
  await taskRefs.report(
    q,
    taskRefsReport({
      id: task.id,
      title: task.title,
      description: task.description,
      sourceRef: task.source_ref,
      comments: comments.map((row) => row.body),
      updatedAt: latest,
      actor,
    }),
  );
}

/** Eine Quelle, aus der eine Aufgabe werden darf, oder `null`. */
export function acceptedSource(value: string): string | null {
  const parsed = parseObjectRef(value);
  if (parsed === null) return null;
  return (ACCEPTED_SOURCES as readonly string[]).includes(`${parsed.app}:${parsed.type}`)
    ? parsed.ref
    : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `tasks.resolve`: Titel, Pfad und Status fuer die Chips anderer Apps. */
export async function resolveTaskObjects(q: Query, args: unknown): Promise<ResolveToolResult> {
  const { type, ids } = parseResolveArgs(args, TASK_OBJECT_TYPES);
  // Eine Id, die keine UUID ist, gibt es nicht; sie fehlt in der Antwort.
  const valid = ids.filter((id) => UUID.test(id));
  if (valid.length === 0) return { objects: [] };
  if (type === 'task') {
    const rows = await q<{ id: string; title: string; status: string; updated_at: Date }>(
      'select id::text as id, title, status, updated_at from tasks where id = any ($1::uuid[])',
      [valid],
    );
    return {
      objects: rows.map((row) => ({
        id: row.id,
        title: row.title,
        path: `/task/${encodeURIComponent(row.id)}`,
        ...(isStatus(row.status) ? { status: STATUS_LABELS[row.status] } : {}),
        updatedAt: row.updated_at.toISOString(),
      })),
    };
  }
  const rows = await q<{ id: string; name: string; created_at: Date }>(
    'select id::text as id, name, created_at from projects where id = any ($1::uuid[])',
    [valid],
  );
  return {
    objects: rows.map((row) => ({
      id: row.id,
      title: row.name,
      path: `/all?project=${encodeURIComponent(row.id)}`,
      updatedAt: row.created_at.toISOString(),
    })),
  };
}
