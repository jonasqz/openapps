-- Läuft im Schema der App. Die Control Plane setzt den search_path.
-- Keine Rolle, kein Grant, kein Schema-Wechsel in dieser Datei: das macht die
-- Control Plane. Eine Migration wird nie geändert, nur eine neue hinzugefügt.

create table tasks (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(trim(title)) between 1 and 200),
  assignee     text not null check (length(trim(assignee)) between 1 and 200),
  due_date     date,
  completed    boolean not null default false,
  completed_at timestamptz,
  completed_by text,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  check ((completed and completed_at is not null) or (not completed and completed_at is null))
);

create index tasks_open_idx on tasks (completed, due_date nulls last, created_at desc);
create index tasks_assignee_idx on tasks (lower(assignee));
