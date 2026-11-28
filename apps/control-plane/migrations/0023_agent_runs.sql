-- 0023_agent_runs.sql — Laeufe der Plattform-Agents, zugleich ihre
-- Warteschlange (ADR 0024 E).
--
-- `start_agent_run` (API und MCP, „Ask agent“ im Home) und eine Erwaehnung
-- eines Agents (ADR 0023 D) legen eine Zeile mit `queued` an. Der Prozess
-- fuer Laeufe im Container der Control Plane nimmt sie mit
-- `FOR UPDATE SKIP LOCKED` auf, setzt `running` mit einer Frist
-- (`lease_until`) und schreibt nach jedem Schritt den Stand.
--
-- Die Rechte eines Laufs stehen nicht hier: Sie sind die Freigaben des
-- Agenten geschnitten mit denen des Ausloesers, gelesen bei jeder Pruefung
-- (src/domain/run-rights.ts). Hier steht nur, wer ausgeloest hat.
--
-- `used_apps` ist die Herkunft: die Apps, deren Inhalte der Lauf gesehen hat.
-- Sie waechst nur. Wer den Lauf sehen will, muss alle diese Apps lesen
-- duerfen. `tool_calls` nennt nur Tool und Ergebnis, nie Argumente.
--
-- 0001 bis 0022 bleiben unveraendert.

CREATE TABLE agent_runs (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      text         NOT NULL REFERENCES agent_identities (name),
  status          text         NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  trigger_kind    text         NOT NULL CHECK (trigger_kind IN ('manual', 'mention')),
  -- Der Ausloeser: ein Mensch (Nutzer-Id und E-Mail fuer seine Gruppen) oder ein Agent.
  trigger_subject_kind text    NOT NULL CHECK (trigger_subject_kind IN ('user', 'agent')),
  trigger_subject_id   text    NOT NULL CHECK (length(trigger_subject_id) BETWEEN 1 AND 320),
  trigger_email   text         CHECK (trigger_email IS NULL OR trigger_email = lower(trigger_email)),
  -- Bei einer Erwaehnung: Objekt (`<app>:<typ>:<id>`), App und Pfad der Quelle.
  source          text         CHECK (source IS NULL OR length(source) BETWEEN 5 AND 400),
  source_app      text,
  source_path     text         CHECK (source_path IS NULL OR left(source_path, 1) = '/'),
  prompt          text         NOT NULL CHECK (length(prompt) BETWEEN 1 AND 8000),
  result          text,
  error_code      text,
  error_message   text,
  steps           integer      NOT NULL DEFAULT 0 CHECK (steps >= 0),
  input_tokens    integer      NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens   integer      NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  used_apps       text[]       NOT NULL DEFAULT '{}',
  tool_calls      jsonb        NOT NULL DEFAULT '[]'::jsonb,
  -- Eine Erwaehnung startet genau einen Lauf je Agent.
  dedupe_key      text         UNIQUE,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  lease_until     timestamptz,
  CHECK ((trigger_kind = 'mention') = (source IS NOT NULL))
);

-- Die Warteschlange: aelteste zuerst.
CREATE INDEX agent_runs_queue_idx ON agent_runs (created_at) WHERE status = 'queued';
-- Laeufe, deren Prozess endete.
CREATE INDEX agent_runs_running_idx ON agent_runs (lease_until) WHERE status = 'running';
-- „Meine Laeufe“ und „Laeufe meiner Agents“.
CREATE INDEX agent_runs_trigger_idx ON agent_runs (trigger_subject_kind, trigger_subject_id, created_at);
CREATE INDEX agent_runs_agent_idx ON agent_runs (agent_name, created_at);
