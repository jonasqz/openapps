-- Links zwischen Seiten, fuer Rueckverweise (wiki 0.2.0).
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel.
--
-- Eine Zeile je Link `[Text](page:<uuid>)` im aktuellen Inhalt der Quellseite.
-- src/lib/pages.ts schreibt die Zeilen bei jedem Anlegen, Aendern und
-- Wiederherstellen neu, in derselben Transaktion wie die Seite. Ziele, die es
-- nicht gibt, werden nicht gespeichert.
--
-- Kein Nachtragen noetig: Vor dieser Version kannte der Renderer `page:`
-- nicht, also gibt es keine bestehenden Seitenlinks.

create table page_links (
  source_id uuid not null references pages (id) on delete restrict,
  target_id uuid not null references pages (id) on delete restrict,
  primary key (source_id, target_id),
  check (source_id <> target_id)
);

create index page_links_target_idx on page_links (target_id);
