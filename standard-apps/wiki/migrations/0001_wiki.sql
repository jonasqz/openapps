-- Laeuft im Schema der App. Die Control Plane setzt den search_path.
-- Keine Rolle, kein Grant, kein Schema-Wechsel in dieser Datei: das macht die
-- Control Plane. Eine Migration wird nie geaendert, nur eine neue hinzugefuegt.

create table pages (
  id          uuid primary key default gen_random_uuid(),
  -- Eine Seite mit Unterseiten wird nicht geloescht, nur archiviert. `restrict`
  -- verhindert, dass ein Loeschen am Code vorbei einen halben Baum hinterlaesst.
  parent_id   uuid references pages (id) on delete restrict,
  title       text not null check (length(trim(title)) between 1 and 200),
  content_md  text not null default '' check (length(content_md) <= 200000),
  tags        text[] not null default '{}' check (cardinality(tags) <= 20),
  created_by  text not null check (length(created_by) between 1 and 256),
  updated_by  text not null check (length(updated_by) between 1 and 256),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  -- Volltext ueber Titel und Inhalt. `'german'::regconfig` als Konstante, damit
  -- der Ausdruck immutable ist und als generierte Spalte taugt.
  search      tsvector generated always as (
    to_tsvector('german'::regconfig, title || ' ' || content_md)
  ) stored,
  check (parent_id is null or parent_id <> id)
);

create index pages_search_idx on pages using gin (search);
create index pages_tags_idx on pages using gin (tags);
create index pages_parent_idx on pages (parent_id) where archived_at is null;
create index pages_title_idx on pages (lower(title)) where archived_at is null;

-- Jede Aenderung an einer Seite schreibt eine Zeile: der Stand nach der
-- Aenderung, wer sie gemacht hat und wann. So bleibt nachvollziehbar, was ein
-- Agent geaendert hat. Revisionen werden nie geaendert und nie geloescht.
create table page_revisions (
  id         bigint generated always as identity primary key,
  page_id    uuid not null references pages (id) on delete restrict,
  -- Art der Aenderung: angelegt, bearbeitet, archiviert.
  change     text not null check (change in ('create', 'update', 'archive')),
  title      text not null,
  content_md text not null,
  tags       text[] not null default '{}',
  edited_by  text not null check (length(edited_by) between 1 and 256),
  edited_at  timestamptz not null default now()
);

create index page_revisions_page_idx on page_revisions (page_id, edited_at desc, id desc);
