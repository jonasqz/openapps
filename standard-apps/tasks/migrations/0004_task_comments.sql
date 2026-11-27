-- Kommentare an einer Aufgabe. Verschwindet die Aufgabe, verschwinden ihre
-- Kommentare mit (es gibt heute kein Loeschen, aber kein Waisenkind spaeter).

create table task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks (id) on delete cascade,
  body       text not null check (length(trim(body)) between 1 and 5000),
  author     text not null,
  created_at timestamptz not null default now()
);

create index task_comments_task_idx on task_comments (task_id, created_at);
