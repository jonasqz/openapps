-- Ereignisse an die Plattform (tasks 0.4.0, ADR 0022).
--
-- Jede Zuweisung, jeder Kommentar und jeder Statuswechsel schreibt in
-- derselben Transaktion eine Zeile in `event_outbox`. Nach dem Commit liefert
-- die App sie an `platform.emit_event` (createEventOutbox aus @openapps/sdk).
-- Ist die Plattform nicht erreichbar oder fehlt die Freigabe, bleibt die Zeile
-- stehen; Speichern scheitert nie daran.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 bis 0005 bleiben unveraendert.

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
