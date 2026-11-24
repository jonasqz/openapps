-- Alle Apps liegen unter einer Domain, getrennt durch ihren Pfad (ADR 0007).
-- 0001 hatte `primary_domain` noch als UNIQUE angelegt, aus der Zeit mit einer
-- Subdomain je App. Unter ADR 0007 heisst das: Die zweite App laesst sich nicht
-- anlegen — `createApp` scheitert beim Setzen der gemeinsamen Domain. Aufgefallen
-- erst im lokalen Betrieb mit drei Apps (ADR 0011), weil jeder Test nur eine
-- App anlegte.
--
-- Eindeutig bleibt der Name (und damit der Pfad); die Forward-Auth findet die
-- App ueber das erste Pfadsegment, nie ueber die Domain.

ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_primary_domain_key;
