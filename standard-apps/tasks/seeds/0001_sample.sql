-- Beispieldaten, nur lokal (OPENAPPS_SAMPLE_DATA=1). Auf dem Server bleibt
-- eine frische App leer.
insert into tasks (title, assignee, due_date, created_by) values
  ('Prepare the quarterly report', 'Alex', current_date + 7, 'seed'),
  ('Schedule the onboarding session', 'Sam', current_date + 2, 'seed');

insert into tasks (title, assignee, completed, completed_at, completed_by, created_by) values
  ('Clean up the team calendar', 'Alex', true, now(), 'seed', 'seed');
