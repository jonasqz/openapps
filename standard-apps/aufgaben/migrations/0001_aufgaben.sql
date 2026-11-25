-- Läuft im Schema der App. Die Control Plane setzt den search_path.
-- Keine Rolle, kein Grant, kein Schema-Wechsel in dieser Datei: das macht die
-- Control Plane. Eine Migration wird nie geändert, nur eine neue hinzugefügt.

create table aufgaben (
  id           uuid primary key default gen_random_uuid(),
  titel        text not null check (length(trim(titel)) between 1 and 200),
  zustaendig   text not null check (length(trim(zustaendig)) between 1 and 200),
  faellig_am   date,
  erledigt     boolean not null default false,
  erledigt_am  timestamptz,
  erledigt_von text,
  erstellt_von text not null,
  erstellt_am  timestamptz not null default now(),
  check ((erledigt and erledigt_am is not null) or (not erledigt and erledigt_am is null))
);

create index aufgaben_offen_idx on aufgaben (erledigt, faellig_am nulls last, erstellt_am desc);
create index aufgaben_zustaendig_idx on aufgaben (lower(zustaendig));
