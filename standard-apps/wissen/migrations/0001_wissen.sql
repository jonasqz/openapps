-- Laeuft im Schema der App. Die Control Plane setzt den search_path.
-- Keine Rolle, kein Grant, kein Schema-Wechsel in dieser Datei: das macht die
-- Control Plane. Eine Migration wird nie geaendert, nur eine neue hinzugefuegt.
--
-- Retrieval ohne pgvector: deutscher Postgres-Volltext auf den Abschnitten.
-- Eine Vektorspalte kaeme spaeter als eigene Migration dazu (siehe README).

create table documents (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (length(trim(title)) between 1 and 200),
  -- Frei: URL, "Handbuch v3", Ablageort. Null heisst: keine Angabe.
  source     text check (source is null or length(source) between 1 and 500),
  content    text not null check (length(trim(content)) between 1 and 200000),
  char_count integer not null check (char_count >= 0),
  -- Id aus getUser: Mensch (<id>) oder Agent (agent:<name>).
  created_by text not null check (length(created_by) between 1 and 200),
  created_at timestamptz not null default now(),
  -- Weich geloescht. Gesetzt heisst: fuer Suche, Liste und Detail unsichtbar.
  deleted_at timestamptz
);

create index documents_live_created_at_idx on documents (created_at desc)
  where deleted_at is null;

create table chunks (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  ord         integer not null check (ord >= 0),
  text        text not null check (length(trim(text)) > 0),
  tsv         tsvector generated always as (to_tsvector('german', text)) stored,
  constraint chunks_document_ord_key unique (document_id, ord)
);

create index chunks_tsv_idx on chunks using gin (tsv);
