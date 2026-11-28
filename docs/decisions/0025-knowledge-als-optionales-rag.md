# ADR 0025: Knowledge als optionales RAG

Stand: 27.11.2026 · angenommen (Nutzerentscheidung vom 27.11.2026)

## Kontext

Knowledge ist heute die Retrieval-Haelfte eines RAG (ADR 0020): Postgres-
Volltext auf Deutsch und Englisch, Abschnitte mit Quelle, Sichtbarkeit nach
lesbaren Apps, das Wiki liefert ueber die Outbox zu. Es gibt keine
Embeddings und keine erzeugte Antwort; der aufrufende Agent schreibt sie
selbst. ADR 0020 hat den Zuschnitt fuer Vektoren vorbereitet: eine Spalte
an den Abschnitten und ein zweiter `Retriever`, der die Sichtbarkeit als
Pflichtargument bekommt.

ADR 0024 liefert einen optionalen Modell-Anbieter mit getrennter
Embedding-Konfiguration und die Plattform-Tools `embed` und `generate`.

**Einordnung:** Kein DoD-Kriterium braucht Embeddings oder Antworten; nach
dem Brief („v1 enthaelt nur, was die Kriterien brauchen“) waere das ein
Nicht-Ziel fuer v1. **Nutzerentscheidung vom 27.11.2026: Es wird jetzt
gebaut**, vor den uebrigen Schritten des Zielbilds. Das ist eine benannte
Aenderung am Umfang, nicht an den sieben Kriterien: Sie gelten unveraendert,
ihre Nachweise (vor allem DoD 2 auf der Zielinstanz) stehen weiter aus, und
die Timebox von 6 bis 8 Wochen aus dem Brief deckt diese Arbeit nicht ab.

### Befund pgvector (geprueft am 27.11.2026)

- Lokal (`infra/lokal`) und auf dem Server (`infra/betrieb`, in Coolify
  eine Compose-Ressource) laeuft **dasselbe eigene Image**
  `infra/betrieb/postgres/Dockerfile`, `FROM postgres:16`. Coolify stellt
  die Datenbank nicht; fuer Coolify ist nichts zu tun.
- Im gebauten Image (`openapps-lokal-postgres`, PostgreSQL 16.15, Debian
  trixie mit PGDG-Quelle) gibt es **kein** `vector`.
- Das Paket `postgresql-16-pgvector` ist in der PGDG-Quelle des Images
  verfuegbar (Kandidat 0.8.7), in einem Wegwerf-Container installiert und
  geprueft.
- Die Steuerdatei `vector.control` traegt **kein** `trusted = true`.
  `CREATE EXTENSION vector` braucht also den Superuser. `openapps_owner` und
  alle App-Rollen sind ohne `SUPERUSER` und muessen es bleiben (CLAUDE.md).
- Das SDK setzt den `search_path` nur auf das Schema der App.

## Entscheidung

### A. pgvector gehoert zum Image, die Nutzung ist optional

- Das Dockerfile installiert `postgresql-16-pgvector`.
- Ein neues Init-Skript (`20-vector.sh`) legt als Superuser das Schema
  `extensions` und darin `vector` an und gibt `openapps_owner` `USAGE` mit
  Weitergaberecht. Das Skript ist wiederholbar (`IF NOT EXISTS`).
- **Lokal** erledigt es das Init-Skript: bei leerem Volume von selbst, bei
  einem bestehenden lokalen Volume ruft der lokale Aufbau dasselbe Skript
  als Superuser auf.
- **Auf dem Server** fuehrt der Betreiber den einmaligen Schritt als
  Superuser vor dem ersten Deploy mit RAG aus (Knowledge 0.3). Der Schritt
  steht im Betriebs-README (`infra/betrieb/README.md`).
- Eine App erklaert den Bedarf im Manifest (`databaseExtensions:
  ["vector"]`, neues optionales Feld). Die Control Plane gibt ihrer Rolle
  dann `USAGE` auf `extensions`, nie `CREATE`. Vor dem Start prueft sie, ob
  die Erweiterung da ist; fehlt sie, endet der Deploy als `failed`, mit
  einer Meldung, die den einmaligen Schritt nennt.
- Knowledge spricht Typ und Operatoren voll qualifiziert an
  (`extensions.vector`, `OPERATOR(extensions.<=>)`). Der `search_path` des
  SDK bleibt, wie er ist.
- **Optional ist die Konfiguration, nicht die Erweiterung:** Die Migration
  von Knowledge darf sich auf `vector` verlassen. Ohne Embedding-
  Konfiguration bleibt die Tabelle leer, und alles verhaelt sich wie heute.

### B. Embeddings

- Neue Tabelle `chunk_embeddings` (Abschnitt, Modell-Kennung, Vektor). Die
  Kennung ist Anbieter, Modell und Dimension aus ADR 0024. Ohne festen
  Dimensionswert in der Spalte, damit ein Modellwechsel keine Migration
  braucht.
- Knowledge holt Vektoren ueber das Plattform-Tool `embed` (ADR 0024 D)
  als `app:knowledge`. Der Schluessel verlaesst die Control Plane nicht.
- Eine Warteschlange in Knowledge (wie die Outbox) bettet neue und
  geaenderte Abschnitte ein. Speichern und Suchen scheitern nie an einem
  fehlenden oder langsamen Anbieter.
- Zuerst ohne ANN-Index (exakte Suche). Ein HNSW-Index kommt, wenn die
  gemessene Suchzeit es verlangt; er braucht eine feste Dimension je Modell.

### C. Hybrides Ranking

- Ein zweiter `Retriever`: Volltext (wie heute) und Vektor, beide mit
  **derselben Sichtbarkeit vor dem Ranking**, zusammengefuehrt per
  Reciprocal Rank Fusion. Ein Abschnitt, den der Aufrufer nicht sehen darf,
  ist in keiner der beiden Listen.
- Der Vektor-Teil ist nur an, wenn **alle** einbettbaren sichtbaren
  Abschnitte einen Vektor des aktuellen Modells haben. Bis dahin nur
  Volltext. Sonst verschoebe ein halb eingebetteter Bestand die Rangfolge.
- **Nicht einbettbar** sind bei externem Embedding-Anbieter die Abschnitte
  aus Apps in `OPENAPPS_MODEL_LOCAL_ONLY_APPS` (ADR 0024 C2): Die Control
  Plane haelt sie zurueck (`withheld`), sie bleiben nur ueber Volltext
  auffindbar. Ebenso gibt `answer` sie bei externem Chat-Anbieter nicht
  weiter.
- `search` behaelt Name, Eingabe und Ausgabe. Was ein Agent sieht, aendert
  sich nur in der Reihenfolge der Treffer.

### D. Modellwechsel

- Gesucht wird nur mit Vektoren der aktuellen Kennung. Nach einem Wechsel
  bettet die Warteschlange alles neu ein, bis dahin gilt C (nur Volltext).
  Vektoren alter Kennungen werden nach Abschluss geloescht.
- Neues Tool `embeddings.status`: Modell, Abdeckung, ausstehend, letzter
  Fehler. Dazu `embeddings.backfill`.

### E. `answer`: Antwort mit Zitaten

- Neues Tool `answer` (`read`, eigene Freigabe, getrennt von `search`):
  sucht mit der Sichtbarkeit des Aufrufers, gibt **nur diese Abschnitte** an
  das Plattform-Tool `generate` und verlangt Zitate auf `chunkId`.
- Knowledge prueft jedes Zitat: Es muss auf einen der uebergebenen
  Abschnitte zeigen. Eine Antwort ohne gueltiges Zitat wird verworfen; dann
  kommt `no_answer` mit den Abschnitten zurueck, nicht geraten.
- Rueckgabe: Antwort, Zitate (`chunkId`, `documentTitle`, `sourceUrl`) und
  die benutzten Abschnitte.
- Ohne Chat-Konfiguration antwortet `answer` `not_configured` mit dem
  Hinweis auf `search`. Das Tool steht trotzdem im Manifest, weil das
  Manifest statisch ist.

## Folgen

- Das Postgres-Image waechst um ein Paket; ein neues Init-Skript. Bestehende
  Installationen brauchen einen Schritt als Superuser vor Knowledge 0.3.
  Die Setup-Zeit (Schwelle 30 Min, Brief) waechst nur, wenn dieser Schritt
  vergessen wird; darum die Pruefung vor dem Start.
- `app:knowledge` braucht `execute` auf `platform.embed` und
  `platform.generate`. Die Nutzung zaehlt auf `app:knowledge`; wer gefragt
  hat, steht nur als Angabe von Knowledge im Detail.
- Mit Konfiguration gehen Abschnitte an den Anbieter (siehe ADR 0024).
- Abschnitte sind fremder Text im Prompt von `answer`. `answer` hat keine
  Tools; eine Injection kann die Antwort verzerren, aber nichts ausfuehren.
- Knowledge wird 0.3.0. Ohne Konfiguration bleibt jede Suche, wie sie war.

### Umsetzung: Abweichungen und Festlegungen (Schritte 1 bis 5, 28.11.2026)

**pgvector im Image (Schritt 1)**

- **Ein Skript fuer beide Faelle:** Das SQL steht in
  `infra/betrieb/postgres/vector.sql`, ausgefuehrt von `openapps-vector`
  (im Image unter `/usr/local/bin`) als Superuser ueber den lokalen Socket.
  `20-vector.sh` ruft bei leerem Volume genau dieses Skript. Das SQL laeuft in
  einer Transaktion, ist wiederholbar (ein zweiter Lauf aendert weder
  Erweiterung noch Rechte) und bricht ab, wenn `vector` schon in einem anderen
  Schema liegt oder `extensions` keinem Superuser gehoert.
- **Lokal** baut `infra/lokal/apps-ausrollen.sh` das Postgres-Image mit (das
  Volume bleibt) und ruft `openapps-vector` vor dem Deploy auf. **Auf dem
  Server** steht der einmalige Schritt in `infra/betrieb/README.md`,
  Abschnitt 7, mit Pruefabfrage.
- **Control Plane:** Migration 0025 `app_database_extensions(rolle, text[])`
  ist die eine Stelle fuer „USAGE ja, CREATE nie“: Sie prueft die
  Erweiterung, erteilt oder entzieht `USAGE` und prueft das Ergebnis mit
  `has_schema_privilege` nach (ein GRANT ohne Weitergaberecht waere nur eine
  WARNING). Hat eine Rolle `CREATE` auf `extensions` oder ohne Bedarf noch
  `USAGE` von Hand, bricht sie ab. Aufgerufen bei **jedem** Deploy nach dem
  Anlegen der Rolle und vor dem Start; ein weggefallener Bedarf nimmt das
  Recht wieder. Fehlt die Erweiterung: `MissingDatabaseExtensionError`, der
  Versuch endet als `failed`, die laufende Fassung bleibt live. Ein Rollback
  aendert die Rechte nicht.
- Die Test-Instanz der Control Plane (`apps/control-plane/docker-compose.yml`)
  bekommt dasselbe Paket, damit `tests/extensions-postgres.spec.ts` laeuft.

**Embeddings (Schritt 2)**

- **Abweichung: neues Plattform-Tool `platform.model_info`.** Knowledge muss
  wissen, ob und welches Embedding-Modell gilt, ohne bei jeder Suche und in
  jedem Takt `embed` zu rufen (jeder Versuch ohne Modell waere ein
  Audit-Eintrag `not_configured`). Es ruft kein Modell, kostet keine Tokens
  und nennt das Modell nur fuer die Tools, auf die die App `execute` hat,
  dazu das Budget des Tages (`limit`, `used`, `resetsAt`) fuer die App und die
  Installation. **Kein eigenes Recht:** `execute` auf `platform.embed` oder
  `platform.generate` genuegt; ohne beides 403 mit Audit. Ein erfolgreicher
  Aufruf steht nicht im Audit.
- **`onBehalfOf` an `generate`** (`user:<id>`, `agent:<name>`, `app:<name>`):
  die Angabe aus „Folgen“, wer gefragt hat. Nur im Audit-Detail, nie fuer
  Rechte oder Zaehlung.
- **Kennung:** `<anbieter>/<modell>/<dimension|auto>`.
- **Die Warteschlange ist abgeleitet**, keine eigene Tabelle: ausstehend ist
  jeder lebende Abschnitt ohne Zeile fuer die aktuelle Kennung. Neue und
  geaenderte Abschnitte und ein Modellwechsel brauchen so kein Einreihen.
  Zustand in einer Zeile `embedding_state`. Takt: beim Start, alle 60 s und
  nach jedem Speichern, nie im Speichern selbst; Stapel zu 32 Abschnitten,
  je Stapel eine Transaktion mit Advisory-Lock (zwei Instanzen betten nicht
  doppelt ein, Speichern wartet nie).
- **Zurueckgehalten** heisst eine Zeile mit `withheld` ohne Vektor: Sie zaehlt
  als erledigt, nicht gegen die Abdeckung, und der Abschnitt bleibt ueber
  Volltext auffindbar. Knowledge kennt `OPENAPPS_MODEL_LOCAL_ONLY_APPS` nicht;
  es gibt jeden Text mit seiner Quell-App (`knowledge` fuer eigene Dokumente
  und Suchanfragen), und die Control Plane haelt zurueck.
  `embeddings.backfill` versucht Zurueckgehaltenes neu, falls sich die Liste
  geaendert hat.
- **`documents.upsert` behaelt Abschnitte mit gleichem Text** samt Id und
  Vektoren (bisher: alle loeschen und neu anlegen). Sonst bettete jedes
  Speichern im Wiki die ganze Seite neu ein und verbrauchte das Budget.
- Ohne Embedding-Konfiguration steht genau eine Zeile im Log
  („no embedding model is configured: search uses full text only“), kein
  Fehler, kein Aufruf von `embed`.

**Budget (Entscheidung zur Tagesgrenze)**

Die Default-Grenze je Subjekt (200 000 Tokens, ADR 0024) gilt fuer alles, was
Knowledge tut: Backfill, Vektoren fuer Suchanfragen und `answer`.
Festgelegt:

- Ein Backfill nimmt **hoechstens die Haelfte** der Grenze je Subjekt und
  hoechstens die Haelfte der Grenze der Installation, gemessen an dem, was die
  Plattform fuer `app:knowledge` heute schon zaehlt (`model_info`, also
  einschliesslich der interaktiven Nutzung). Die andere Haelfte bleibt fuer
  Suchanfragen und `answer`.
- Ist der Anteil erreicht, **pausiert** der Backfill bis `resetsAt` (naechster
  UTC-Tag) und macht dann von selbst weiter. Ebenso nach 429 der Plattform;
  nach einem Fehler des Anbieters 5 Minuten.
- **Die Grenze wird nicht erhoeht**, weder in Knowledge noch fuer
  `app:knowledge`. Wer schneller will, hebt
  `OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT` bewusst in der Env der Control
  Plane an; der Anteil waechst dann mit. `embeddings.backfill` hebt die Pause
  wegen des Anteils nicht auf.
- Fortschritt in `embeddings.status`: `pendingTokens`, `allowanceToday`,
  `estimatedDays`, `pausedUntil`. Grob: Mit dem Default sind es 100 000 Tokens
  am Tag, etwa 400 000 Zeichen oder 500 Abschnitte; ein Bestand von 10 000
  Abschnitten braucht rund 20 Tage. Bis dahin sucht Knowledge mit Volltext
  (C), also ohne Verschlechterung.
- Verworfen: eine eigene Grenze in der Env von Knowledge (eine zweite Grenze
  neben der der Plattform, die keiner sieht); eine hoehere Grenze fuer
  `app:knowledge` (das stille Erhoehen); Backfill ohne Anteil (verdraengt
  `answer` und Suchanfragen fuer den Rest des Tages).

**Hybrider Retriever (Schritt 3)**

- Reciprocal Rank Fusion mit `k = 60`, je Liste `max(3 × limit, 20)`
  Kandidaten, hoechstens 60. Ein Abschnitt in beiden Listen nimmt die Fassung
  des Volltexts (sein Ausschnitt markiert Treffer). `score` ist dann der
  RRF-Wert; er war schon vorher nur innerhalb einer Antwort vergleichbar.
- Die Vektor-Liste ist exakt (kein Index), mit derselben Bedingung der
  Sichtbarkeit im `where` wie der Volltext. Ihr Ausschnitt markiert die Woerter
  der Anfrage mit dem Woerterbuch `simple`, sonst ist er der Anfang des
  Abschnitts.
- **Abdeckung je Sichtbarkeit des Aufrufers**, und mindestens ein Vektor muss
  sichtbar sein. Die Anfrage bekommt ihren Vektor mit 3 s Frist; jede Stoerung
  (Frist, Grenze, Fehler, keine Freigabe, Vektor-Abfrage scheitert) ergibt den
  Volltext, die Suche selbst scheitert nie am Modell.
- `documents.search` (Suche ueber alle Apps, ADR 0021) bleibt Volltext: Die
  Plattform fragt es beim Tippen mit etwa 2 s je App.

**Modellwechsel (Schritt 4)**

- Erkannt im Takt (`model_info`) oder bei einer Suche, wenn `embed` mit einer
  anderen Kennung antwortet. Alte Vektoren werden geloescht, sobald **alle**
  lebenden Abschnitte (nicht nur die sichtbaren) die neue Kennung haben.
- `embeddings.status` liest nur; `embeddings.backfill` (`write`) laesst einen
  Durchlauf von etwa 20 s laufen und hebt eine Pause nach einem Fehler auf.

**`answer` (Schritt 5)**

- **Strenger als beschrieben:** Schon ein einziges Zitat auf einen Abschnitt,
  der nicht vorlag, verwirft die ganze Antwort, nicht nur eine Antwort ganz
  ohne gueltiges Zitat. Ein Zitat auf einen zurueckgehaltenen Abschnitt gilt
  als erfunden: Das Modell hatte ihn nicht.
- Das Modell antwortet als JSON `{ answer, citations }`; Text ohne diese Form
  ist `no_answer` (`unreadable`). Gruende von `no_answer`: `no_passages`,
  `not_in_sources`, `no_citation`, `invalid_citation`, `unreadable`,
  `withheld`, `budget_exceeded`, `model_error`, immer mit den Abschnitten.
- `not_configured` kommt ohne Suche und ohne Abschnitte, auch wenn
  Knowledge keine Freigabe auf `generate` hat.
- **Oberflaeche:** Auf der Suchseite ein Knopf „Answer with sources“, nicht
  automatisch: Jede Antwort kostet Tokens aus dem Tagesbudget von
  Knowledge, ein Seitenaufruf soll das nicht. Sichtbar nur mit Chat-Modell
  (`model_info`, 30 s gemerkt) und mit Treffern; Leer- und Fehlerzustand aus
  `@openapps/ui`. Die Server Action prueft `getUser` und ruft dieselbe
  Fachlogik mit der Sichtbarkeit der Anfrage.

**Nicht gebaut:** Schritt 6 (Fragensatz und Schwelle bleiben offen, siehe
oben), ein HNSW-Index, Vektoren im Team-Gedaechtnis (ADR 0024 F).

**Ungeprueft (Stand 28.11.2026):** Das gebaute Postgres-Image und der
Schritt `openapps-vector` gegen echtes pgvector sind nicht gelaufen (kein
Docker in dieser Arbeit; ein Bau von pgvector auf dem Rechner wurde nicht
zugelassen). Die Datenbank-Tests von Knowledge liefen gegen Postgres 16 mit
einem Platzhalter fuer `extensions.vector` (Domain ueber `text`, Cosinus in
plpgsql), die Postgres-Tests der Control Plane ohne pgvector; die Tests mit
echtem pgvector ueberspringen sich bis dahin.

## Alternativen

- **`pgvector/pgvector:pg16` als Basis-Image:** Eine zweite Quelle fuer das
  Image, das die Nachweise getragen hat. Verworfen; ein Paket aus der
  bereits genutzten PGDG-Quelle reicht.
- **`CREATE EXTENSION` durch die Control Plane:** Braeuchte `SUPERUSER`
  fuer `openapps_owner`. Verworfen.
- **`extensions` in den `search_path` der Apps:** Bequemer, aendert aber die
  Festlegung im SDK, die Regel 2 traegt. Verworfen.
- **Erweiterung nur bei Bedarf, Migration mit Bedingung:** Eine Migration,
  die je Umgebung etwas anderes tut, laeuft nie wieder, wenn die Erweiterung
  spaeter kommt. Verworfen.
- **Embeddings in Knowledge mit eigenem Schluessel:** Kein zentrales Budget
  und Audit. Verworfen zugunsten von `embed`.
- **Nur Vektorsuche statt hybrid:** Verliert exakte Treffer auf Namen und
  Nummern, die der Volltext heute findet. Verworfen.
- **cognee als Knowledge-Speicher:** Wissensgraph plus Vektoren, Antworten
  mit LLM, eigenes Rechtemodell (Nutzer, Datasets). Die Filterung nach
  lesbaren Apps (ADR 0020) muesste als Abbildung auf Datasets nachgebaut
  werden, daneben stuende ein zweites Rechtemodell (CLAUDE.md 4), und es
  waere ein weiterer Dienst mit eigenem Graph-Speicher im Betrieb. Verworfen
  fuer Knowledge; als Gedaechtnis der Agents hinter einem Port bewertet in
  ADR 0024.

## Schnitt

1. **pgvector im Image.** Paket, `20-vector.sh`, einmaliger Schritt fuer
   bestehende Volumes, Feld `databaseExtensions`, Pruefung vor dem Start.
   Abschnitt im Betriebs-README fuer den einmaligen Schritt auf dem Server.
   DoD: frisches lokales Volume und bestehendes lokales Volume nach dem
   lokalen Aufbau: `vector` in `pg_extension`; zweiter Lauf des Skripts
   aendert nichts; eine App-Rolle
   mit Bedarf kann `extensions.vector` nutzen, aber nichts in `extensions`
   anlegen; ohne Bedarf kein `USAGE`; die bestehenden Postgres-Tests zum
   Rollenmodell bleiben gruen.
2. **Embeddings.** `chunk_embeddings`, Warteschlange, `embed`.
   DoD: Test ohne Konfiguration: `search` liefert fuer einen festen
   Bestand dieselben Treffer wie 0.2; mit Konfiguration gegen ein Fake-Modell
   sind alle Abschnitte eingebettet; Anbieter weg: Speichern gelingt;
   Abschnitte einer App aus `OPENAPPS_MODEL_LOCAL_ONLY_APPS` werden bei
   externem Anbieter nicht eingebettet und zaehlen nicht gegen die
   Abdeckung.
3. **Hybrider Retriever.**
   DoD: Test: ein nicht lesbares Dokument erscheint weder ueber Volltext noch
   ueber Vektor; bei unvollstaendiger Abdeckung nur Volltext.
4. **Modellwechsel.** `embeddings.status`, `embeddings.backfill`.
   DoD: Test: Wechsel der Kennung schaltet auf Volltext, nach Neuberechnung
   zurueck auf hybrid, alte Vektoren geloescht.
5. **`answer`.**
   DoD: Tests mit Fake-Modell: Zitat auf einen nicht uebergebenen Abschnitt
   ergibt `no_answer`; ohne Konfiguration `not_configured`; ohne Freigabe
   403.
6. **Nachweis im Betrieb.** Ein fester Fragensatz aus dem Wiki von blyck,
   Volltext gegen hybrid, Ergebnis als Protokoll in `docs/nachweise/`.
   **Fragensatz und Schwelle werden in diesem Schritt vor dem Vergleich
   festgelegt und hier nachgetragen**, nicht nach dem Ergebnis.
   DoD: Fragensatz und Schwelle stehen in diesem ADR mit Datum, bevor der
   erste Vergleich laeuft; Protokoll liegt vor.

   Fragensatz: _noch nicht festgelegt._ Schwelle: _noch nicht festgelegt._

## Entscheidungen des Nutzers (27.11.2026)

- **Prioritaet:** jetzt, vor den uebrigen Schritten des Zielbilds.
- **Kein Standard-Modell**, auch nicht fuer Embeddings, nur BYOK ueber den
  Port aus ADR 0024. Embeddings bieten Gemini und OpenAI-kompatibel (auch
  lokal), Anthropic nicht; ohne Embedding-Konfiguration nur Volltext.
- **RAG-Vergleich:** Fragensatz und Schwelle werden in Schritt 6 vor dem
  Vergleich festgelegt und hier nachgetragen.
- **pgvector:** lokal das Init-Skript; auf dem Server der einmalige
  Superuser-Schritt durch den Betreiber vor dem ersten Deploy mit RAG,
  dokumentiert im Betriebs-README.
- **Datenabfluss:** Inhalte aus `OPENAPPS_MODEL_LOCAL_ONLY_APPS` gehen nie an
  einen externen Anbieter (ADR 0024 C2).
