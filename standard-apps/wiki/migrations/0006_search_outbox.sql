-- Abliefern an die gemeinsame Suche (wiki 0.3.0, ADR 0020).
--
-- Jede Aenderung an einer Seite schreibt in derselben Transaktion eine Zeile
-- in `search_outbox`. Nach dem Commit liefert das Wiki die Seite an Knowledge
-- (src/lib/search-sync.ts). Ist Knowledge nicht erreichbar oder fehlt die
-- Freigabe, bleibt die Zeile stehen; Speichern scheitert nie daran.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 bis 0005 bleiben unveraendert.

-- Fortlaufende Version je Eintrag. Eine Aenderung waehrend der Lieferung
-- setzt eine neue Version; geloescht wird nur die gelieferte Version. So geht
-- keine Aenderung verloren.
create sequence search_outbox_version_seq;

-- Eine Zeile je Seite, nicht je Aenderung: geliefert wird immer der aktuelle
-- Stand der Seite, nicht ein Schnappschuss.
create table search_outbox (
  page_id         uuid primary key references pages (id) on delete cascade,
  version         bigint not null default nextval('search_outbox_version_seq'),
  enqueued_at     timestamptz not null default now(),
  attempts        integer not null default 0 check (attempts >= 0),
  last_error      text check (last_error is null or length(last_error) <= 1000),
  last_attempt_at timestamptz
);

create index search_outbox_order_idx on search_outbox (attempts, version);

-- Genau eine Zeile: ob alle Seiten schon einmal eingereiht wurden. Der erste
-- Start mit 0.3.0 reiht alle bestehenden Seiten ein, auch die Beispielseiten,
-- die erst nach den Migrationen kommen.
create table search_sync (
  id            boolean primary key default true check (id),
  backfilled_at timestamptz
);
