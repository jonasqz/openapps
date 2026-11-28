-- Embeddings fuer die hybride Suche (knowledge 0.3.0, ADR 0025).
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 bis 0003 bleiben unveraendert.
--
-- Verlangt pgvector im Schema `extensions` und USAGE der App-Rolle darauf.
-- Beides richtet die Plattform ein, wenn das Manifest `databaseExtensions:
-- ["vector"]` nennt; fehlt es, endet schon der Deploy, nicht erst diese
-- Migration. Typ und Operatoren stehen voll qualifiziert da; der search_path
-- bleibt das eigene Schema.
--
-- Optional ist die Konfiguration, nicht die Tabelle: Ohne Embedding-Modell
-- bleiben beide Tabellen leer, und die Suche ist der Volltext wie in 0.2.

-- Ein Vektor je Abschnitt und Modell. Die Kennung ist Anbieter, Modell und
-- Dimension (`<anbieter>/<modell>/<dimension|auto>`). Der Vektor hat keine
-- feste Dimension, damit ein Modellwechsel keine Migration braucht; gesucht
-- wird immer nur innerhalb einer Kennung, also mit gleicher Dimension.
-- `withheld`: Die Plattform hat den Abschnitt nicht an den Anbieter gegeben
-- (Quell-App in OPENAPPS_MODEL_LOCAL_ONLY_APPS, externer Anbieter). Er zaehlt
-- als erledigt, hat aber keinen Vektor und wird nur ueber Volltext gefunden.
create table chunk_embeddings (
  chunk_id   uuid not null references chunks (id) on delete cascade,
  model_key  text not null check (length(model_key) between 3 and 300),
  embedding  extensions.vector,
  withheld   boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (chunk_id, model_key),
  constraint chunk_embeddings_vector_or_withheld check ((embedding is null) = withheld)
);

-- Zuerst ohne ANN-Index (exakte Suche, ADR 0025 B). Ein HNSW-Index braucht
-- eine feste Dimension je Modell und kommt, wenn die gemessene Suchzeit es
-- verlangt, als eigene Migration.
create index chunk_embeddings_model_idx on chunk_embeddings (model_key);

-- Zustand der Warteschlange, eine Zeile. Die Warteschlange selbst ist
-- abgeleitet: jeder lebende Abschnitt ohne Zeile fuer die aktuelle Kennung.
create table embedding_state (
  id            boolean primary key default true check (id),
  -- Aktuelle Kennung; null: kein Embedding-Modell (oder nicht erreichbar).
  model_key     text check (model_key is null or length(model_key) between 3 and 300),
  provider      text check (provider is null or length(provider) <= 64),
  model         text check (model is null or length(model) <= 200),
  dimensions    integer check (dimensions is null or dimensions between 1 and 16000),
  provider_local boolean,
  model_since   timestamptz,
  checked_at    timestamptz,
  last_run_at   timestamptz,
  -- Ein kurzer Grund, nie Text des Anbieters.
  last_error    text check (last_error is null or length(last_error) <= 300),
  last_error_at timestamptz,
  -- Bis hierhin wartet der Backfill (Tagesanteil erreicht, Grenze, Fehler).
  paused_until  timestamptz,
  paused_reason text check (paused_reason is null or length(paused_reason) <= 300)
);

insert into embedding_state (id) values (true);
