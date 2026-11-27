-- Beispieldaten fuer wiki 0.2.0, nur lokal. 0001 bleibt unveraendert (Seeds
-- tragen wie Migrationen eine Pruefsumme).
--
-- 1. Seeds laufen nach allen Migrationen. Auf einer frischen Datenbank kommen
--    die Revisionen aus 0001 also nach dem Nachtragen in
--    0003_history_moves_restores.sql und haetten keine Elternseite. Hier wird
--    sie fuer die Beispielseiten nachgetragen (exakt: sie wurden nie verschoben).
-- 2. Eine Beispielseite mit Links auf andere Seiten und einer Checkliste,
--    damit Rueckverweise und Checklisten sofort zu sehen sind.

update page_revisions r
   set parent_id = p.parent_id
  from pages p
 where p.id = r.page_id
   and r.parent_id is null
   and r.edited_by = 'system:sample-data';

insert into pages (id, parent_id, title, content_md, tags, created_by, updated_by) values
(
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000006',
  '6f1c2a4e-1b7d-4c2a-9e51-0a0000000002',
  'First-day checklist',
  $md$# Before you leave on day one

- [x] Laptop set up
- [x] Signed in to the password manager
- [ ] Read the [Leave policy](page:6f1c2a4e-1b7d-4c2a-9e51-0a0000000003)
- [ ] Requested access as described in [Tools & access](page:6f1c2a4e-1b7d-4c2a-9e51-0a0000000004)

Back to the [Northlight Handbook](page:6f1c2a4e-1b7d-4c2a-9e51-0a0000000001).
$md$,
  array['onboarding', 'checklist'],
  'system:sample-data',
  'system:sample-data'
);

insert into page_revisions (page_id, change, title, content_md, tags, parent_id, edited_by, edited_at)
select id, 'create', title, content_md, tags, parent_id, created_by, created_at
from pages
where id = '6f1c2a4e-1b7d-4c2a-9e51-0a0000000006';

-- Dieselben Links, die src/lib/pages.ts beim Speichern aus dem Inhalt liest.
insert into page_links (source_id, target_id) values
  ('6f1c2a4e-1b7d-4c2a-9e51-0a0000000006', '6f1c2a4e-1b7d-4c2a-9e51-0a0000000003'),
  ('6f1c2a4e-1b7d-4c2a-9e51-0a0000000006', '6f1c2a4e-1b7d-4c2a-9e51-0a0000000004'),
  ('6f1c2a4e-1b7d-4c2a-9e51-0a0000000006', '6f1c2a4e-1b7d-4c2a-9e51-0a0000000001');
