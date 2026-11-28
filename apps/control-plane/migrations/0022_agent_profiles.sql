-- 0022_agent_profiles.sql — Profile der Plattform-Agents (ADR 0024 E).
--
-- Ein Plattform-Agent ist eine Agent-Identitaet aus 0005 mit einem Profil:
-- Anweisungen, optional ein Modell des konfigurierten Chat-Anbieters,
-- hoechstens N Schritte und ein Token-Budget je Lauf. Gepflegt ueber
-- `configure_agent` (API und MCP) mit `write` auf `agent:<name>`.
--
-- Ein Modellname steht hier nur, wenn ihn jemand ausdruecklich setzt; sonst
-- gilt OPENAPPS_CHAT_MODEL. Es gibt kein Standard-Modell.
--
-- 0001 bis 0021 bleiben unveraendert.

CREATE TABLE agent_profiles (
  agent_name    text         PRIMARY KEY REFERENCES agent_identities (name),
  instructions  text         NOT NULL CHECK (length(instructions) BETWEEN 1 AND 8000),
  model         text         CHECK (model IS NULL OR length(model) BETWEEN 1 AND 200),
  max_steps     integer      NOT NULL CHECK (max_steps BETWEEN 1 AND 20),
  token_budget  integer      NOT NULL CHECK (token_budget BETWEEN 1000 AND 500000),
  updated_by    text         NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 400),
  updated_at    timestamptz  NOT NULL DEFAULT now()
);
