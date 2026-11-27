-- Naechste Schritte: was als Naechstes zu tun ist, bis wann, an einem Deal,
-- einer Firma oder einem Kontakt. Erledigt wird ein Schritt ueber das Tool
-- next_steps.complete, das im selben Zug eine Aktivitaet in den Verlauf
-- schreibt. 0001 bis 0003 bleiben unveraendert.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. Grenzen wie in src/lib/schemas.ts.

create table next_steps (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) between 1 and 200),
  -- Faelligkeit als Kalendertag. "Ueberfaellig" rechnet die App gegen den Tag
  -- in Europe/Berlin, dieselbe Zeitzone wie src/lib/format.ts.
  due_on      date not null,
  deal_id     uuid references deals (id) on delete set null,
  company_id  uuid references companies (id) on delete set null,
  contact_id  uuid references contacts (id) on delete set null,
  -- Wer zustaendig ist: Nutzer-Id aus getUser, bei Agents `agent:<name>`.
  owner       text check (owner is null or length(owner) between 1 and 200),
  done_at     timestamptz,
  done_by     text check (done_by is null or length(done_by) between 1 and 200),
  created_by  text not null check (length(created_by) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Wie bei activities: ein Schritt haengt an mindestens einem Datensatz.
  constraint next_steps_has_subject
    check (num_nonnulls(deal_id, company_id, contact_id) >= 1),
  -- Erledigt heisst: wann und von wem. Nie nur eins von beiden.
  constraint next_steps_done_complete
    check ((done_at is null) = (done_by is null))
);

-- Offene Schritte nach Faelligkeit: Uebersicht und "ueberfaellig".
create index next_steps_open_due_idx on next_steps (due_on) where done_at is null;
create index next_steps_deal_idx on next_steps (deal_id);
create index next_steps_company_idx on next_steps (company_id);
create index next_steps_contact_idx on next_steps (contact_id);

create trigger next_steps_updated_at before update on next_steps
  for each row execute function set_updated_at();
