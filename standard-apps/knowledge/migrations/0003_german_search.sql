-- Volltext zusaetzlich mit deutschem Woerterbuch (knowledge 0.2.0, ADR 0020).
-- Die Inhalte der Apps sind oft deutsch; das englische Woerterbuch findet
-- dort keine Wortformen („erstattet“ fuer „erstatten“).
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 und 0002 bleiben unveraendert; die
-- englische Spalte `tsv` bleibt, die Suche fragt beide (src/lib/retriever.ts).
-- Das Anlegen berechnet den Vektor fuer jeden bestehenden Abschnitt.

alter table chunks add column tsv_de tsvector
  generated always as (to_tsvector('german'::regconfig, text)) stored;

create index chunks_tsv_de_idx on chunks using gin (tsv_de);
