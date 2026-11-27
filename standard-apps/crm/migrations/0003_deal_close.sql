-- Gewonnen/Verloren mit Grund: Ein Deal in won oder lost traegt, wann er
-- geschlossen wurde und warum. 0001 und 0002 bleiben unveraendert.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel.
--
-- closed_at pflegt die Datenbank, nicht der Code, wie schon updated_at:
--   - Wechsel in won oder lost (oder Anlage dort): closed_at = now().
--   - Wechsel zwischen won und lost: closed_at = now(), der neue Abschluss.
--   - Wechsel zurueck in eine offene Stage: closed_at und close_reason leer.
-- So kann kein Schreibweg (Tool, Beispieldaten, Hand) die beiden Felder
-- auseinanderlaufen lassen. Die Checks darunter sind die letzte Grenze.
--
-- Der Grund ist fuer neue Abschluesse Pflicht (Tool deals.update_stage), in der
-- DB aber nullable: Deals, die vor dieser Migration geschlossen wurden, haben
-- keinen erfassten Grund, und erfinden wollen wir keinen.

alter table deals
  add column closed_at    timestamptz,
  add column close_reason text
    check (close_reason is null or length(trim(close_reason)) between 1 and 2000);

-- Bestand nachziehen, ohne updated_at zu veraendern: kein Mensch hat bearbeitet.
alter table deals disable trigger deals_updated_at;
update deals set closed_at = updated_at where stage in ('won', 'lost');
alter table deals enable trigger deals_updated_at;

create function set_deal_closed_at() returns trigger
  language plpgsql
as $$
begin
  if new.stage in ('won', 'lost') then
    if new.closed_at is null
       or (tg_op = 'UPDATE' and old.stage is distinct from new.stage) then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
    new.close_reason := null;
  end if;
  return new;
end;
$$;

create trigger deals_closed_at before insert or update on deals
  for each row execute function set_deal_closed_at();

alter table deals add constraint deals_closed_at_matches_stage
  check ((stage in ('won', 'lost')) = (closed_at is not null));

alter table deals add constraint deals_close_reason_only_closed
  check (close_reason is null or stage in ('won', 'lost'));

-- Filter nach Besitzer in deals.list.
create index deals_owner_idx on deals (owner);
