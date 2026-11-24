# Wissen

Standard-App von openapps: Dokumente ablegen, in Abschnitte zerlegen und
relevante Passagen mit Quelle finden. Das ist die **Retrieval-Hälfte eines
RAG** — die Antwort formuliert der aufrufende Agent selbst, aus den gelieferten
Passagen und mit Quellenangabe.

## Tools

Jede Funktion ist zuerst ein Tool (`app.json` → `offeredTools`, `openapi.yaml`
→ `POST /tools/<name>`), die UI ruft dieselbe Fachlogik.

| Tool | Verb | Was es tut |
| --- | --- | --- |
| `search` | read | `query`, `limit` (Default 5, höchstens 20). Liefert `passages` mit `chunkId`, `documentId`, `documentTitle`, `source`, `ord`, `score`, `excerpt` (Treffer in `«»`) und `text`. |
| `documents.add` | write | `title`, `content`, `source?`. Zerlegt und speichert in einer Transaktion, liefert `id` und `chunkCount`. |
| `documents.list` | read | `q?` filtert nach Titel oder Quelle. Ohne Volltext. |
| `documents.get` | read | `id`, `includeChunks?`. Gelöschte Dokumente ergeben 404. |
| `documents.delete` | write | `id`. Weich gelöscht: danach weder in der Suche noch in der Liste. |

## Wie gesucht wird

Postgres 16 ohne pgvector, kein Embedding-Modell und keine externe API. Die
Suche ist deshalb deutscher Postgres-Volltext: Jeder Abschnitt hat eine
generierte Spalte `tsv = to_tsvector('german', text)` mit GIN-Index. Gesucht
wird zuerst streng mit `websearch_to_tsquery('german', q)` (alle Wörter,
Anführungszeichen für Wortfolgen, `-wort` schließt aus), gerankt mit
`ts_rank_cd`. Liefert das weniger als `limit` Treffer, ergänzt eine
ODER-Anfrage über die einzelnen Wörter, ab vier Buchstaben auch als Wortanfang
(`reise:*`), weil der deutsche Stemmer keine Komposita zerlegt. Treffer der
strengen Stufe stehen immer vorn, Dubletten entfallen. Der Ausschnitt kommt
aus `ts_headline` und markiert Treffer mit `«` und `»` statt mit HTML; die UI
rendert sie als `<mark>`, ohne `dangerouslySetInnerHTML`.

Die Suche steckt hinter der Schnittstelle `Retriever` in
`src/lib/retriever.ts`. Kommt pgvector dazu, wird das eine zweite
Implementierung derselben Schnittstelle (Vektorspalte per neuer Migration,
Embeddings beim Ablegen, Auswahl in `currentRetriever()` in
`src/lib/tools.ts`) — Tools, Antwortformat und UI bleiben unverändert. Eine
hybride Variante, die beide Ränge zusammenführt, wäre eine dritte.

## Wie zerlegt wird

`src/lib/chunk.ts`, eine reine Funktion: etwa 800 Zeichen je Abschnitt,
höchstens 1200. Getrennt wird an Absatzgrenzen (Leerzeile), sonst an
Satzgrenzen, sonst an Wortgrenzen und nur als letzte Notlösung hart. Jeder
Abschnitt außer dem ersten beginnt mit etwa 150 Zeichen vom Ende des vorigen,
möglichst ab einem Satzanfang. Leere Abschnitte entfallen.

## Daten

- `migrations/0001_wissen.sql` — `documents` und `chunks`.
- `migrations/0002_beispieldokumente.sql` — vier fiktive Dokumente der
  Nordlicht GmbH (Reisekosten, Angebote, IT-Sicherheit, Produktblatt). Die
  Migration legt nur die Dokumente an; zerlegt werden sie beim Start in
  `src/instrumentation.ts` mit derselben Funktion wie `documents.add`. Die
  Begründung steht dort im Kommentar.

Migrationen laufen beim Start (`src/instrumentation.ts`, `runMigrations` aus
dem SDK) mit der Rolle der App in ihrem eigenen Schema. Ohne `DATABASE_URL`
wird nur gewarnt.

## Lokal

```bash
cp .env.example .env
pnpm dev
pnpm typecheck && pnpm lint && pnpm test
```

Ohne Gateway gibt es lokal keinen Nutzer; Aufrufe brauchen die fünf
`X-Auth-*`-Header, signiert mit `signatureFor` aus `@openapps/sdk` (siehe
README der Starter-App). Der Request-Host muss dabei `OPENAPPS_APP_HOST`
entsprechen (`Host` oder `X-Forwarded-Host`).
