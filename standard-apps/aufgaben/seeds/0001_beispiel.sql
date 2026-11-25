-- Beispieldaten, nur lokal (OPENAPPS_SAMPLE_DATA=1). Auf dem Server bleibt
-- eine frische App leer.
insert into aufgaben (titel, zustaendig, faellig_am, erstellt_von) values
  ('Quartalsbericht vorbereiten', 'Alex', current_date + 7, 'seed'),
  ('Onboarding-Termin abstimmen', 'Sam', current_date + 2, 'seed');

insert into aufgaben (titel, zustaendig, erledigt, erledigt_am, erledigt_von, erstellt_von) values
  ('Teamkalender aufräumen', 'Alex', true, now(), 'seed', 'seed');
