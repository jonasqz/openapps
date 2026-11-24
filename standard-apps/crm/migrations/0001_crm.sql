-- Laeuft im Schema der App. Die Control Plane setzt den search_path.
-- Keine Rolle, kein Grant, kein Schema-Wechsel in dieser Datei: das macht die
-- Control Plane. Eine Migration wird nie geaendert, nur eine neue hinzugefuegt.
--
-- Die Pruefungen hier sind die letzte Grenze: Was durch die zod-Schemas der
-- Tools rutscht, faengt die Datenbank. Die Grenzen sind deshalb dieselben wie
-- in src/lib/schemas.ts.

-- updated_at pflegt die Datenbank, nicht der Code: ein vergessenes
-- `updated_at = now()` in einem Update waere ein stiller Fehler.
create function set_updated_at() returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table companies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 200),
  website    text check (website is null or length(website) <= 500),
  branche    text check (branche is null or length(branche) <= 100),
  notes      text check (notes is null or length(notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companies_name_idx on companies (lower(name));

create trigger companies_updated_at before update on companies
  for each row execute function set_updated_at();

create table contacts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 200),
  email      text check (email is null or (length(email) <= 254 and email like '%_@_%')),
  phone      text check (phone is null or length(phone) <= 50),
  role       text check (role is null or length(role) <= 100),
  company_id uuid references companies (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- E-Mail eindeutig ohne Gross-/Kleinschreibung. Kontakte ohne E-Mail sind
-- erlaubt und kollidieren nicht.
create unique index contacts_email_key on contacts (lower(email)) where email is not null;
create index contacts_company_idx on contacts (company_id);
create index contacts_name_idx on contacts (lower(name));

create trigger contacts_updated_at before update on contacts
  for each row execute function set_updated_at();

create table deals (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) between 1 and 200),
  company_id     uuid not null references companies (id) on delete restrict,
  contact_id     uuid references contacts (id) on delete set null,
  -- Obergrenze Number.MAX_SAFE_INTEGER: Der Betrag geht als JSON-Zahl an
  -- Agents und darf dabei nicht still gerundet werden.
  value_cents    bigint not null default 0 check (value_cents between 0 and 9007199254740991),
  stage          text not null default 'lead'
                   check (stage in ('lead', 'qualifiziert', 'angebot', 'gewonnen', 'verloren')),
  expected_close date,
  owner          text check (owner is null or length(owner) <= 200),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index deals_stage_idx on deals (stage);
create index deals_company_idx on deals (company_id);
create index deals_contact_idx on deals (contact_id);

create trigger deals_updated_at before update on deals
  for each row execute function set_updated_at();

create table activities (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('notiz', 'anruf', 'mail', 'termin')),
  subject     text not null check (length(trim(subject)) between 1 and 200),
  body        text check (body is null or length(body) <= 10000),
  contact_id  uuid references contacts (id) on delete set null,
  company_id  uuid references companies (id) on delete set null,
  deal_id     uuid references deals (id) on delete set null,
  happened_at timestamptz not null default now(),
  -- Wer erfasst hat: die Nutzer-Id aus getUser, bei Agents `agent:<name>`.
  created_by  text not null check (length(created_by) between 1 and 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Eine Aktivitaet haengt an mindestens einem Datensatz. Wuerde ein Loeschen
  -- (on delete set null) den letzten Bezug entfernen, scheitert das Loeschen
  -- an dieser Pruefung: Verlauf geht nicht still verloren. v1 hat kein
  -- Loeschen; wer es baut, muss diesen Fall entscheiden.
  constraint activities_has_subject
    check (num_nonnulls(contact_id, company_id, deal_id) >= 1)
);

create index activities_contact_idx on activities (contact_id, happened_at desc);
create index activities_company_idx on activities (company_id, happened_at desc);
create index activities_deal_idx on activities (deal_id, happened_at desc);
create index activities_happened_idx on activities (happened_at desc);

create trigger activities_updated_at before update on activities
  for each row execute function set_updated_at();
