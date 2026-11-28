-- Ereignisse an die Plattform (crm 0.4.0, ADR 0022). 0001 bis 0004 bleiben
-- unveraendert.
--
-- 1. `event_outbox`: Deal gewonnen oder verloren, naechster Schritt
--    zugewiesen oder faellig. Jede Zeile entsteht in derselben Transaktion wie
--    die Aenderung; nach dem Commit liefert die App sie an
--    `platform.emit_event` (createEventOutbox aus @openapps/sdk). Ist die
--    Plattform nicht erreichbar oder fehlt die Freigabe, bleibt die Zeile
--    stehen; Speichern scheitert nie daran.
-- 2. `next_step_due_notices`: fuer welchen Faelligkeitstag die App
--    „faellig" schon gemeldet hat. So meldet der stuendliche Lauf jeden
--    faelligen Schritt einmal, nicht bei jedem Lauf. Eine eigene Tabelle,
--    damit das Melden `next_steps.updated_at` nicht beruehrt.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel.

create sequence event_outbox_version_seq;

-- Eine Zeile je Ereignis, Schluessel ist seine Id. Geloescht nach der Lieferung.
create table event_outbox (
  key             text primary key check (length(key) between 1 and 200),
  version         bigint not null default nextval('event_outbox_version_seq'),
  payload         jsonb,
  enqueued_at     timestamptz not null default now(),
  attempts        integer not null default 0 check (attempts >= 0),
  last_error      text check (last_error is null or length(last_error) <= 1000),
  last_attempt_at timestamptz
);

create index event_outbox_order_idx on event_outbox (attempts, version);

create table next_step_due_notices (
  next_step_id uuid not null references next_steps (id) on delete cascade,
  due_on       date not null,
  notified_at  timestamptz not null default now(),
  primary key (next_step_id, due_on)
);

-- Bestehende, schon faellige Schritte gelten als gemeldet: Die erste Fassung
-- mit Ereignissen soll nicht mit einer Welle alter Faelligkeiten starten.
insert into next_step_due_notices (next_step_id, due_on)
select id, due_on from next_steps
 where done_at is null and due_on <= (now() at time zone 'Europe/Berlin')::date;
