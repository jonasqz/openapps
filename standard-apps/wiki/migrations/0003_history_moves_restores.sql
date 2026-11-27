-- Verlauf fuer Verschieben und Wiederherstellen (wiki 0.2.0).
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 und 0002 bleiben unveraendert.
--
-- 1. Jede Revision merkt sich die Elternseite, damit der Verlauf zeigt, wohin
--    eine Seite verschoben wurde.
-- 2. Zwei neue Arten von Aenderung: 'move' (Elternseite gewechselt) und
--    'restore' (Stand einer frueheren Revision wiederhergestellt).

alter table page_revisions
  add column parent_id uuid references pages (id) on delete restrict;

-- Nachtragen fuer bestehende Revisionen. Das ist exakt, nicht geschaetzt: Bis
-- zu dieser Migration gab es kein Verschieben, die Elternseite einer Seite war
-- seit ihrem Anlegen dieselbe. Revisionen werden sonst nie geaendert; dies ist
-- das einmalige Auffuellen einer neuen Spalte.
update page_revisions r
   set parent_id = p.parent_id
  from pages p
 where p.id = r.page_id;

-- Postgres benennt den Check aus 0001 automatisch `page_revisions_change_check`.
alter table page_revisions drop constraint page_revisions_change_check;
alter table page_revisions add constraint page_revisions_change_check
  check (change in ('create', 'update', 'archive', 'move', 'restore'));
