-- Favoriten je Person oder Agent (wiki 0.2.0).
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel.
--
-- `user_id` ist die Id aus getUser (Person) bzw. `agent:<name>`, genau wie
-- `created_by`. Kein Rechte-Code: Die Zeile sagt nur, wer welche Seite
-- markiert hat; lesen darf, wer die App lesen darf.

create table page_favorites (
  user_id    text not null check (length(user_id) between 1 and 256),
  page_id    uuid not null references pages (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, page_id)
);

create index page_favorites_user_idx on page_favorites (user_id, created_at desc);
