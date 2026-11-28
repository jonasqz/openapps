-- 0021_model_usage.sql — eine Zeile je Modell-Aufruf der Plattform (ADR 0024 C).
--
-- Grundlage der Tagesgrenzen (OPENAPPS_MODEL_DAILY_TOKENS und
-- OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT, geprueft vor jedem Aufruf in
-- src/domain/models.ts) und spaeter der Abrechnung pro Lauf im
-- Managed-Betrieb (docs/08-zielbild.md).
--
-- **Kein Prompt, keine Antwort, kein Schluessel.** Nur wer, wofuer, bei
-- welchem Anbieter und Modell, wie viele Tokens, wie lange und mit welchem
-- Ergebnis. Ein ueberschrittenes Budget steht mit 0 Tokens hier.
--
-- 0001 bis 0020 bleiben unveraendert.

CREATE TABLE model_usage (
  id             bigserial    PRIMARY KEY,
  occurred_at    timestamptz  NOT NULL DEFAULT now(),
  subject_kind   grant_subject_kind NOT NULL,
  subject_id     text         NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 320),
  purpose        text         NOT NULL
                 CHECK (purpose IN ('agent_run', 'summary', 'answer', 'generate', 'embedding')),
  kind           text         NOT NULL CHECK (kind IN ('chat', 'embedding')),
  provider       text         NOT NULL
                 CHECK (provider IN ('anthropic', 'gemini', 'openai-compatible')),
  model          text         NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  input_tokens   integer      NOT NULL CHECK (input_tokens >= 0),
  output_tokens  integer      NOT NULL CHECK (output_tokens >= 0),
  duration_ms    integer      NOT NULL CHECK (duration_ms >= 0),
  outcome        text         NOT NULL CHECK (outcome IN ('ok', 'error', 'budget_exceeded')),
  -- Der Lauf eines Plattform-Agents (0023), sonst NULL. Kein Fremdschluessel:
  -- Die Zeile bleibt, auch wenn es den Lauf einmal nicht mehr gibt.
  run_id         uuid
);

-- Die Summe des Tages fuer die Installation und je Subjekt.
CREATE INDEX model_usage_occurred_idx ON model_usage (occurred_at);
CREATE INDEX model_usage_subject_idx ON model_usage (subject_kind, subject_id, occurred_at);
