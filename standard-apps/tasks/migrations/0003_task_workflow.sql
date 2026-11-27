-- Aus "erledigt ja/nein" wird ein Ablauf: Status (To do, In progress, Done),
-- Prioritaet, Beschreibung, Projekt, Zeitpunkt der letzten Aenderung. Die
-- Zuweisung wird optional (eine Aufgabe darf noch niemandem gehoeren).
--
-- `status` ist ab jetzt die Quelle. `completed` bleibt als abgeleitete Spalte
-- stehen, weil seeds/0001_sample.sql sie beim Einfuegen setzt und eine
-- Beispieldaten-Datei so wenig geaendert wird wie eine Migration. Der Trigger
-- haelt beide gleich:
--   * beim Einfuegen ohne Status folgt der Status aus `completed`,
--   * danach folgt `completed` immer aus dem Status.
-- Der Check aus 0001 (completed <=> completed_at gesetzt) gilt weiter und
-- haelt damit auch status = 'done' <=> completed_at gesetzt.

alter table tasks
  add column status      text check (status in ('todo', 'in_progress', 'done')),
  add column priority    text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  add column description text not null default '' check (length(description) <= 10000),
  add column project_id  uuid references projects (id) on delete set null,
  add column updated_at  timestamptz not null default now();

update tasks set status = case when completed then 'done' else 'todo' end, updated_at = created_at;

alter table tasks alter column status set not null;
alter table tasks alter column assignee drop not null;

create function tasks_sync_status() returns trigger
language plpgsql
as $$
begin
  if new.status is null then
    new.status := case when new.completed then 'done' else 'todo' end;
  end if;
  new.completed := new.status = 'done';
  return new;
end;
$$;

create trigger tasks_sync_status
  before insert or update on tasks
  for each row execute function tasks_sync_status();

create index tasks_status_due_idx on tasks (status, due_date nulls last);
create index tasks_project_idx on tasks (project_id);
