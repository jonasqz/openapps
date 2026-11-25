-- Produktsprache Englisch (ADR 0016): Die festen Werte, die Agents ueber die
-- Tools sehen, werden englisch. 0001_crm.sql bleibt unveraendert.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel.
--
-- Zuordnung:
--   Spalte companies.branche -> industry
--   Stage:  qualifiziert -> qualified, angebot -> proposal,
--           gewonnen -> won, verloren -> lost (lead bleibt)
--   Art:    notiz -> note, anruf -> call, mail -> email, termin -> meeting
--
-- Reihenfolge: alte Checks entfernen, Zeilen umschreiben, neue Checks setzen.
-- Die neuen Checks gelten sofort fuer alle Zeilen; ein unbekannter Altwert
-- laesst die Migration scheitern, statt still durchzurutschen.

-- Spalte umbenennen. Der Check folgt der Spalte, nur sein Name nicht.
alter table companies rename column branche to industry;
alter table companies rename constraint companies_branche_check to companies_industry_check;

-- Das Umschreiben ist keine Bearbeitung durch einen Menschen: updated_at soll
-- bleiben, wie es war. Die Trigger ruhen nur innerhalb dieser Transaktion.
alter table deals disable trigger deals_updated_at;
alter table activities disable trigger activities_updated_at;

-- Stages
alter table deals drop constraint deals_stage_check;

update deals set stage = case stage
  when 'qualifiziert' then 'qualified'
  when 'angebot'      then 'proposal'
  when 'gewonnen'     then 'won'
  when 'verloren'     then 'lost'
  else stage
end
where stage in ('qualifiziert', 'angebot', 'gewonnen', 'verloren');

alter table deals add constraint deals_stage_check
  check (stage in ('lead', 'qualified', 'proposal', 'won', 'lost'));

-- Aktivitaetsarten
alter table activities drop constraint activities_kind_check;

update activities set kind = case kind
  when 'notiz'  then 'note'
  when 'anruf'  then 'call'
  when 'mail'   then 'email'
  when 'termin' then 'meeting'
  else kind
end
where kind in ('notiz', 'anruf', 'mail', 'termin');

alter table activities add constraint activities_kind_check
  check (kind in ('note', 'call', 'email', 'meeting'));

alter table deals enable trigger deals_updated_at;
alter table activities enable trigger activities_updated_at;
