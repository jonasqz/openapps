-- 0024_memories.sql — Team-Gedaechtnis der Agents (ADR 0024 F), erste
-- Implementierung hinter dem Port `TeamMemoryStore`: Postgres, Volltext.
--
-- Jeder Eintrag traegt seine Herkunft (`apps`): die Apps, deren Inhalte dazu
-- beitrugen. Ein Aufrufer sieht einen Eintrag nur, wenn er alle diese Apps
-- lesen darf; die Abfrage bekommt die lesbaren Apps und filtert mit
-- `apps <@ $lesbar`, die Domaene prueft das Ergebnis noch einmal.
--
-- `forget` loescht hart. Vektoren kommen, sobald Embeddings konfiguriert sind
-- (ADR 0025), mit einer eigenen Migration.
--
-- 0001 bis 0023 bleiben unveraendert.

CREATE TABLE memories (
  id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  author      text         NOT NULL REFERENCES agent_identities (name),
  text        text         NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  apps        text[]       NOT NULL DEFAULT '{}' CHECK (cardinality(apps) <= 500),
  run_id      uuid,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  search      tsvector     GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED
);

CREATE INDEX memories_search_idx ON memories USING gin (search);
CREATE INDEX memories_apps_idx ON memories USING gin (apps);
CREATE INDEX memories_author_idx ON memories (author, created_at);
