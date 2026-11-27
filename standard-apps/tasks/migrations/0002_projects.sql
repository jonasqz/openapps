-- Projekte gruppieren Aufgaben. Eine Aufgabe gehoert zu hoechstens einem
-- Projekt. Der Name ist ohne Ruecksicht auf Gross-/Kleinschreibung eindeutig,
-- damit "Website" und "website" nicht zwei Projekte werden.

create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 100),
  description text not null default '' check (length(description) <= 1000),
  created_by  text not null,
  created_at  timestamptz not null default now()
);

create unique index projects_name_key on projects (lower(name));
