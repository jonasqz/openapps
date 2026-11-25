-- Beispieldaten, damit eine frische Installation nicht leer ist und Agents
-- etwas zum Ausprobieren haben. Alle Firmen und Personen sind erfunden, alle
-- Adressen liegen unter example.com.
--
-- Feste Ids, damit die Bezuege lesbar bleiben. Datumswerte relativ zum
-- Einspielzeitpunkt, damit die Pipeline nicht schon am ersten Tag veraltet ist.
-- Wer keine Beispieldaten will, loescht sie ueber die App.

insert into companies (id, name, website, industry, notes) values
  ('0a000000-0000-4000-8000-000000000001', 'Northvale Utilities', 'https://northvale-utilities.example.com', 'Energy', 'Municipal utility; decisions go through the operations committee.'),
  ('0a000000-0000-4000-8000-000000000002', 'Linden Timberworks', 'https://linden-timberworks.example.com', 'Construction', 'Family business, 40 employees.'),
  ('0a000000-0000-4000-8000-000000000003', 'Berger & Roth LLP', 'https://berger-roth.example.com', 'Legal', null),
  ('0a000000-0000-4000-8000-000000000004', 'Crane Bakery', null, 'Food', 'Six shops in the surrounding towns.');

insert into contacts (id, name, email, phone, role, company_id) values
  ('0b000000-0000-4000-8000-000000000001', 'Sarah Kemp', 'sarah.kemp@example.com', '+44 20 7946 0601', 'Head of Procurement', '0a000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000002', 'Tom Archer', 'tom.archer@example.com', '+44 20 7946 0602', 'Head of IT', '0a000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000003', 'Mark Linden', 'mark.linden@example.com', '+44 20 7946 0603', 'Managing Director', '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-000000000004', 'Julia Berger', 'julia.berger@example.com', '+44 20 7946 0604', 'Partner', '0a000000-0000-4000-8000-000000000003'),
  ('0b000000-0000-4000-8000-000000000005', 'Daniel Roth', 'daniel.roth@example.com', null, 'Partner', '0a000000-0000-4000-8000-000000000003'),
  ('0b000000-0000-4000-8000-000000000006', 'Patricia Crane', 'patricia.crane@example.com', '+44 20 7946 0606', 'Owner', '0a000000-0000-4000-8000-000000000004'),
  ('0b000000-0000-4000-8000-000000000007', 'Lena Vaughan', 'lena.vaughan@example.com', null, 'Office Manager', '0a000000-0000-4000-8000-000000000003');

-- Laeuft nach allen Migrationen: Spalten und Werte sind die aus
-- 0002_english_values.sql (industry, englische Stages und Arten).
insert into deals (id, title, company_id, contact_id, value_cents, stage, expected_close, owner) values
  ('0d000000-0000-4000-8000-000000000001', 'Customer portal relaunch', '0a000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 4800000, 'proposal', current_date + 45, 'sample-data'),
  ('0d000000-0000-4000-8000-000000000002', 'Control room maintenance contract', '0a000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002', 1200000, 'qualified', current_date + 90, 'sample-data'),
  ('0d000000-0000-4000-8000-000000000003', 'Digital job scheduling', '0a000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000003', 950000, 'lead', current_date + 120, 'sample-data'),
  ('0d000000-0000-4000-8000-000000000004', 'Client portal', '0a000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000004', 2150000, 'won', current_date - 10, 'sample-data'),
  ('0d000000-0000-4000-8000-000000000005', 'Point-of-sale system for the shops', '0a000000-0000-4000-8000-000000000004', '0b000000-0000-4000-8000-000000000006', 680000, 'lost', current_date - 20, 'sample-data');

insert into activities (kind, subject, body, contact_id, company_id, deal_id, happened_at, created_by) values
  ('meeting', 'Discovery meeting: customer portal', 'Gathered requirements; login and instalment payments come first.', '0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', now() - interval '21 days', 'sample-data'),
  ('email', 'Proposal sent', 'Proposal for €48,000 net, valid for 30 days.', '0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', now() - interval '7 days', 'sample-data'),
  ('call', 'Question about on-call support', 'Wants 24/7 on-call support as an option in the contract.', '0b000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002', now() - interval '3 days', 'sample-data'),
  ('note', 'Introduced via the trade association', null, '0b000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000003', now() - interval '14 days', 'sample-data'),
  ('note', 'Stage: Proposal → Won', 'Awarded after the second presentation.', '0b000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000004', now() - interval '10 days', 'sample-data'),
  ('meeting', 'Client portal kick-off', null, '0b000000-0000-4000-8000-000000000007', '0a000000-0000-4000-8000-000000000003', null, now() - interval '5 days', 'sample-data'),
  ('note', 'Stage: Proposal → Lost', 'Went with a local provider that offers on-site service.', '0b000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000004', '0d000000-0000-4000-8000-000000000005', now() - interval '20 days', 'sample-data');
