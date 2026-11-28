-- Verweise zwischen Apps (crm 0.5.0, ADR 0023).
--
-- Eine Notiz (Aktivitaet) oder ein naechster Schritt meldet der Plattform
-- die vollstaendige Menge ihrer Verweise `@{app:typ:id}` (Aufgaben,
-- Wiki-Seiten, erwaehnte Personen) ueber `platform.set_refs`. Das CRM
-- schreibt in derselben Transaktion wie die Aenderung eine Zeile je Quelle in
-- `refs_outbox`; eine neuere Meldung derselben Quelle ersetzt eine wartende.
-- Nach dem Commit liefert es sie (createRefsOutbox aus @openapps/sdk). Ist
-- die Plattform nicht erreichbar oder fehlt die Freigabe, bleibt die Zeile
-- stehen; Speichern scheitert nie daran.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 bis 0005 bleiben unveraendert.

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
