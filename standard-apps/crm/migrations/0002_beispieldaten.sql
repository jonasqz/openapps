-- Beispieldaten, damit eine frische Installation nicht leer ist und Agents
-- etwas zum Ausprobieren haben. Alle Firmen und Personen sind erfunden, alle
-- Adressen liegen unter example.com.
--
-- Feste Ids, damit die Bezuege lesbar bleiben. Datumswerte relativ zum
-- Einspielzeitpunkt, damit die Pipeline nicht schon am ersten Tag veraltet ist.
-- Wer keine Beispieldaten will, loescht sie ueber die App — diese Datei wird
-- nie geaendert (siehe 0001_crm.sql).

insert into companies (id, name, website, branche, notes) values
  ('0a000000-0000-4000-8000-000000000001', 'Stadtwerke Nordhain', 'https://stadtwerke-nordhain.example.com', 'Energieversorgung', 'Kommunaler Versorger, Entscheidungen laufen über den Werkausschuss.'),
  ('0a000000-0000-4000-8000-000000000002', 'Holzbau Lindner', 'https://holzbau-lindner.example.com', 'Handwerk', 'Familienbetrieb, 40 Mitarbeitende.'),
  ('0a000000-0000-4000-8000-000000000003', 'Kanzlei Berger & Roth', 'https://berger-roth.example.com', 'Recht', null),
  ('0a000000-0000-4000-8000-000000000004', 'Bäckerei Kranz', null, 'Lebensmittel', 'Sechs Filialen im Umland.');

insert into contacts (id, name, email, phone, role, company_id) values
  ('0b000000-0000-4000-8000-000000000001', 'Sabine Köhler', 'sabine.koehler@example.com', '+49 30 1234 5601', 'Leiterin Einkauf', '0a000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000002', 'Thomas Albers', 'thomas.albers@example.com', '+49 30 1234 5602', 'IT-Leiter', '0a000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000003', 'Markus Lindner', 'markus.lindner@example.com', '+49 30 1234 5603', 'Geschäftsführer', '0a000000-0000-4000-8000-000000000002'),
  ('0b000000-0000-4000-8000-000000000004', 'Julia Berger', 'julia.berger@example.com', '+49 30 1234 5604', 'Partnerin', '0a000000-0000-4000-8000-000000000003'),
  ('0b000000-0000-4000-8000-000000000005', 'Daniel Roth', 'daniel.roth@example.com', null, 'Partner', '0a000000-0000-4000-8000-000000000003'),
  ('0b000000-0000-4000-8000-000000000006', 'Petra Kranz', 'petra.kranz@example.com', '+49 30 1234 5606', 'Inhaberin', '0a000000-0000-4000-8000-000000000004'),
  ('0b000000-0000-4000-8000-000000000007', 'Lena Vogt', 'lena.vogt@example.com', null, 'Büroleitung', '0a000000-0000-4000-8000-000000000003');

insert into deals (id, title, company_id, contact_id, value_cents, stage, expected_close, owner) values
  ('0d000000-0000-4000-8000-000000000001', 'Relaunch Kundenportal', '0a000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 4800000, 'angebot', current_date + 45, 'beispieldaten'),
  ('0d000000-0000-4000-8000-000000000002', 'Wartungsvertrag Netzleitstelle', '0a000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000002', 1200000, 'qualifiziert', current_date + 90, 'beispieldaten'),
  ('0d000000-0000-4000-8000-000000000003', 'Digitale Auftragsplanung', '0a000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000003', 950000, 'lead', current_date + 120, 'beispieldaten'),
  ('0d000000-0000-4000-8000-000000000004', 'Mandantenportal', '0a000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000004', 2150000, 'gewonnen', current_date - 10, 'beispieldaten'),
  ('0d000000-0000-4000-8000-000000000005', 'Kassensystem für die Filialen', '0a000000-0000-4000-8000-000000000004', '0b000000-0000-4000-8000-000000000006', 680000, 'verloren', current_date - 20, 'beispieldaten');

insert into activities (kind, subject, body, contact_id, company_id, deal_id, happened_at, created_by) values
  ('termin', 'Erstgespräch Kundenportal', 'Anforderungen aufgenommen, Login und Abschlagszahlungen haben Vorrang.', '0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', now() - interval '21 days', 'beispieldaten'),
  ('mail', 'Angebot verschickt', 'Angebot über 48.000 € netto, gültig 30 Tage.', '0b000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000001', now() - interval '7 days', 'beispieldaten'),
  ('anruf', 'Rückfrage zur Rufbereitschaft', 'Möchte 24/7-Bereitschaft als Option im Vertrag.', '0b000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002', now() - interval '3 days', 'beispieldaten'),
  ('notiz', 'Kontakt über Handwerkskammer', null, '0b000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000002', '0d000000-0000-4000-8000-000000000003', now() - interval '14 days', 'beispieldaten'),
  ('notiz', 'Stage: angebot → gewonnen', 'Zuschlag nach zweiter Präsentation.', '0b000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000003', '0d000000-0000-4000-8000-000000000004', now() - interval '10 days', 'beispieldaten'),
  ('termin', 'Kick-off Mandantenportal', null, '0b000000-0000-4000-8000-000000000007', '0a000000-0000-4000-8000-000000000003', null, now() - interval '5 days', 'beispieldaten'),
  ('notiz', 'Stage: angebot → verloren', 'Entscheidung für einen regionalen Anbieter mit Vor-Ort-Service.', '0b000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000004', '0d000000-0000-4000-8000-000000000005', now() - interval '20 days', 'beispieldaten');
