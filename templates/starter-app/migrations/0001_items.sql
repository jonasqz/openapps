-- Läuft im Schema der App. Die Control Plane setzt den search_path.
-- Keine Rolle, kein Grant, kein Schema-Wechsel in dieser Datei: das macht die
-- Control Plane. Eine Migration wird nie geändert, nur eine neue hinzugefügt.

create table items (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(trim(title)) between 1 and 200),
  created_at timestamptz not null default now()
);

create index items_created_at_idx on items (created_at desc);
