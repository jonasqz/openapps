-- Der Verlauf einer Aufgabe: wer hat wann was von welchem Wert auf welchen
-- geaendert. Geschrieben in derselben Transaktion wie die Aenderung selbst.
-- Fuer die Beschreibung stehen keine Werte darin, nur dass sie sich aenderte.
-- Fuer das Projekt steht der Name zum Zeitpunkt der Aenderung darin.

create table task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks (id) on delete cascade,
  kind       text not null check (kind in (
               'created', 'status', 'assignee', 'due_date', 'priority',
               'title', 'description', 'project')),
  from_value text,
  to_value   text,
  actor      text not null,
  created_at timestamptz not null default now()
);

create index task_events_task_idx on task_events (task_id, created_at);

-- Bestehende Aufgaben bekommen ihren Anfang und, falls erledigt, ihr Ende.
insert into task_events (task_id, kind, to_value, actor, created_at)
select id, 'created', null, created_by, created_at from tasks;

insert into task_events (task_id, kind, from_value, to_value, actor, created_at)
select id, 'status', 'todo', 'done', coalesce(completed_by, created_by), completed_at
from tasks where status = 'done' and completed_at is not null;
