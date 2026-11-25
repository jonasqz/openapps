-- Produktsprache Englisch (ADR 0016): Der Volltext nutzt das englische
-- Woerterbuch statt des deutschen. 0001_wiki.sql bleibt unveraendert.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel.
--
-- Eine generierte Spalte laesst sich nicht umdefinieren, nur neu anlegen. Das
-- Entfernen der Spalte nimmt pages_search_idx mit; das Anlegen berechnet den
-- Vektor fuer jede bestehende Seite neu. src/lib/pages.ts fragt mit derselben
-- Konfiguration ('english'), sonst passen Index und Anfrage nicht zusammen.

alter table pages drop column search;

alter table pages add column search tsvector generated always as (
  to_tsvector('english'::regconfig, title || ' ' || content_md)
) stored;

create index pages_search_idx on pages using gin (search);
