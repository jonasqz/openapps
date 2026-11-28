-- Verweise zwischen Apps (tasks 0.5.0, ADR 0023).
--
-- `source_ref`: aus welchem Objekt einer anderen App die Aufgabe entstand
-- (`wiki:page:<id>`, `crm:deal:<id>`), gesetzt von `tasks.create_from_ref`.
-- Nur der Verweis, nie ein Titel: Was die Quelle heisst, loest die Plattform
-- mit den Rechten des Betrachters auf.
--
-- `refs_outbox`: die vollstaendige Menge der ausgehenden Verweise einer
-- Aufgabe (aus Beschreibung, Kommentaren und `source_ref`), eine Zeile je
-- Aufgabe, in derselben Transaktion wie die Aenderung geschrieben und nach
-- dem Commit an `platform.set_refs` geliefert (createRefsOutbox aus
-- @openapps/sdk). Eine neuere Meldung derselben Aufgabe ersetzt eine
-- wartende. Speichern scheitert nie daran.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 bis 0006 bleiben unveraendert.

alter table tasks
  add column source_ref text
    check (source_ref is null or source_ref ~ '^[a-z][a-z0-9-]{1,38}[a-z0-9]:[a-z][a-z0-9-]{0,39}:[A-Za-z0-9._~-]{1,128}$');

create sequence refs_outbox_version_seq;

create table refs_outbox (
  key             text primary key check (length(key) between 1 and 400),
  version         bigint not null default nextval('refs_outbox_version_seq'),
  payload         jsonb,
  enqueued_at     timestamptz not null default now(),
  attempts        integer not null default 0 check (attempts >= 0),
  last_error      text check (last_error is null or length(last_error) <= 1000),
  last_attempt_at timestamptz
);

create index refs_outbox_order_idx on refs_outbox (attempts, version);
