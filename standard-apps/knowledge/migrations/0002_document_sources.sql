-- Quelle eines Dokuments (knowledge 0.2.0, ADR 0020): Knowledge wird die
-- gemeinsame Suche, und Apps liefern ihre Inhalte hier ab. Ein Dokument mit
-- Quell-App gehoert dieser App: nur sie ersetzt oder entfernt es
-- (documents.upsert, documents.remove), und es ist nur fuer Aufrufer
-- sichtbar, die die Quell-App lesen duerfen.
--
-- Laeuft im Schema der App, in einer Transaktion (runMigrations). Keine Rolle,
-- kein Grant, kein Schema-Wechsel. 0001 bleibt unveraendert.

alter table documents
  -- Name der App, aus der das Dokument kommt. Null: in Knowledge angelegt.
  add column source_app text
    check (source_app is null or source_app ~ '^[a-z][a-z0-9-]{0,63}$'),
  -- Schluessel des Inhalts in der Quell-App, etwa die Seiten-Id im Wiki.
  add column source_key text
    check (source_key is null or (length(source_key) between 1 and 200
                                  and source_key ~ '^[A-Za-z0-9._:/-]+$')),
  -- Pfad in der Quell-App fuer den Link zurueck, etwa /pages/<id>. Immer
  -- relativ zur Quell-App, nie eine fremde Adresse.
  add column source_path text
    check (source_path is null or (length(source_path) between 1 and 500
                                   and source_path ~ '^/[A-Za-z0-9._~%/?=&#:@+,-]*$'
                                   and source_path !~ '^//'
                                   and source_path !~ '(^|/)\.\.?(/|$|\?|#)')),
  -- Stand in der Quell-App. Ein aelterer Stand ueberschreibt keinen neueren.
  add column source_updated_at timestamptz;

alter table documents add constraint documents_source_pair
  check ((source_app is null) = (source_key is null));

alter table documents add constraint documents_source_path_needs_app
  check (source_path is null or source_app is not null);

-- Eindeutig je Paar, auch ueber geloeschte Zeilen hinweg: Ein Paar ist genau
-- ein Dokument. documents.upsert zielt mit `on conflict` auf diesen Index.
create unique index documents_source_key_idx on documents (source_app, source_key)
  where source_app is not null;
