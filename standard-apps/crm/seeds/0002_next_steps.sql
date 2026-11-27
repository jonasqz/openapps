-- Naechste Schritte und Abschlussgruende fuer die Beispieldaten aus
-- 0001_beispieldaten.sql. Laeuft nach allen Migrationen (0004: next_steps,
-- 0003: close_reason). Nur lokal.
--
-- Datumswerte relativ zum Einspielzeitpunkt: einer ist schon ueberfaellig,
-- damit die Uebersicht etwas zu zeigen hat.

update deals set close_reason = 'Awarded after the second presentation.'
 where id = '0d000000-0000-4000-8000-000000000004';
update deals set close_reason = 'Went with a local provider that offers on-site service.'
 where id = '0d000000-0000-4000-8000-000000000005';

insert into next_steps (id, title, due_on, deal_id, company_id, contact_id, owner, created_by) values
  ('0e000000-0000-4000-8000-000000000001', 'Follow up on the proposal', current_date - 2, '0d000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'sample-data', 'sample-data'),
  ('0e000000-0000-4000-8000-000000000002', 'Send on-call support pricing', current_date + 3, '0d000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002', 'sample-data', 'sample-data'),
  ('0e000000-0000-4000-8000-000000000003', 'Book a site visit', current_date + 10, '0d000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000003', 'sample-data', 'sample-data'),
  ('0e000000-0000-4000-8000-000000000004', 'Ask for a reference quote', current_date - 1, null, '0a000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000004', 'sample-data', 'sample-data');
