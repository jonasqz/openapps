# ADR 0024: Agents in der Plattform und ein optionaler Modell-Anbieter

Stand: 27.11.2026 · angenommen (Nutzerentscheidung vom 27.11.2026)

## Kontext

Agents arbeiten heute nur von aussen: Ein Client wie Claude Code meldet sich
mit Bearer-Token am Plattform-MCP an (ADR 0009) und ruft Tools mit den
Freigaben seines Agent-Subjekts (DoD 6). Wer in einer App einen Agenten
erwaehnt oder im Home eine Zusammenfassung moechte, hat keinen Agenten, der
in der Plattform laeuft. Knowledge kann ohne Modell keine Antwort erzeugen
(ADR 0025).

**Das aendert das Zielbild.** `docs/08-zielbild.md` sagt: „Die Plattform
ruft selbst kein Modell auf, ausser im optionalen Review“ und „Kein
Modell-Proxy. Schluessel fuer Modelle gehoeren dem, der baut.“ Diese
Entscheidung lockert das ausdruecklich, vom Nutzer am 27.11.2026
freigegeben: Die Plattform ruft ein Modell nur mit einem eigenen Schluessel
des Betreibers auf (Bring your own key), ohne Schluessel nie. Es gibt kein
Standard-Modell. `docs/08-zielbild.md` ist nachgezogen.
„Modell egal“ bleibt: kein Anbieter ist Pflicht, externe Agents bleiben
gleichwertig.

**Einordnung:** Kein DoD-Kriterium braucht einen Modell-Anbieter; nach dem
Brief („v1 enthaelt nur, was die Kriterien brauchen“) waere das ein
Nicht-Ziel fuer v1. **Nutzerentscheidung vom 27.11.2026: Es wird jetzt
gebaut**, vor den uebrigen Schritten des Zielbilds. Das ist eine benannte
Aenderung am Umfang, nicht an den sieben Kriterien: Sie gelten unveraendert,
ihre Nachweise (vor allem DoD 2 auf der Zielinstanz) stehen weiter aus, und
die Timebox von 6 bis 8 Wochen aus dem Brief deckt diese Arbeit nicht ab.

## Entscheidung

### A. Ein Port fuer Modelle, Adapter je Anbieter

- Port `ModelProvider` in `apps/control-plane/src/adapters/models/`, nach
  dem Muster des Coolify-Adapters: `chat(messages, tools?)` und getrennt
  `embed(texts)`.
- Adapter: `anthropic` (Claude), `gemini` (Google) und
  `openai-compatible` (OpenAI und jeder kompatible Endpunkt, auch lokal,
  etwa Ollama). Embeddings bieten nur `gemini` und `openai-compatible`;
  Anthropic hat keine eigene Embedding-API. Darum ist die
  Embedding-Konfiguration eigenstaendig.
- **Nur Env.** Chat und Embeddings je fuer sich:
  `OPENAPPS_CHAT_PROVIDER`, `OPENAPPS_CHAT_MODEL`,
  `OPENAPPS_CHAT_API_KEY`, `OPENAPPS_CHAT_BASE_URL` (nur
  `openai-compatible`), dazu dieselben vier mit `OPENAPPS_EMBEDDING_` und
  `OPENAPPS_EMBEDDING_DIMENSIONS`.
- **Ohne Konfiguration ist alles aus, und nichts bricht.** Fehlt sie oder ist
  sie unvollstaendig, startet die Control Plane trotzdem; jede
  Modell-Funktion antwortet `not_configured`, `/healthz` zeigt den Zustand
  als Hinweis, nicht als Fehler. Oberflaechen-Teile, die ein Modell brauchen,
  sind dann nicht sichtbar.
- Das Review-Gate behaelt vorerst seinen eigenen Schluessel; der Umzug auf
  den Port ist ein eigener spaeterer Schritt.

### B. Wo der Schluessel liegt

- **Stufe 1 (zuerst): ein Schluessel je Installation, nur per Env**, in
  Coolify gesetzt. Das ist die bestehende Regel „Secrets nur ueber Env“
  (CLAUDE.md 6): kein neuer Speicher fuer Secrets, keine Ausgabe, Rotation
  durch Env-Wechsel und Neustart.
- **Stufe 2 (erst bei Bedarf, Nutzerentscheidung):** Schluessel je Gruppe oder
  Person, in der Control Plane verschluesselt mit einem aus dem
  Master-Secret abgeleiteten Schluessel (HKDF, eigener Kontext wie
  ADR 0020), nie wieder ausgegeben, nur fuer den Aufruf entschluesselt, jede
  Nutzung im Audit. Vorrang Person vor Gruppe vor Installation. Das waere
  das erste Secret, das die Control Plane speichert statt nur zu hashen;
  darum nicht ohne Bedarf aus dem Betrieb.

### C. Nutzung, Grenzen, Audit

- Jeder Aufruf schreibt eine Zeile `model_usage` (Subjekt, Zweck wie
  `agent_run`, `summary`, `answer`, `embedding`, Anbieter, Modell, Tokens
  ein und aus, Dauer, Ergebnis) und einen Audit-Eintrag `model_call`.
  **Keine Prompts und keine Antworten im Audit.**
- Grenzen je Tag fuer die Installation und je Subjekt, per Env
  (`OPENAPPS_MODEL_DAILY_TOKENS`, `OPENAPPS_MODEL_DAILY_TOKENS_PER_SUBJECT`),
  mit konservativem Default fuer beide; ohne Env gilt der Default, nie
  „unbegrenzt“. Die Werte legt Schritt 2 fest und traegt sie hier nach.
  Geprueft vor dem Aufruf; ueberschritten ergibt `budget_exceeded`,
  protokolliert.
- **Festgelegt in Schritt 2 (28.11.2026):** 1 000 000 Tokens je
  Installation und 200 000 Tokens je Subjekt, je UTC-Tag, Tokens ein und aus
  zusammen. Das reicht fuer einige Dutzend Laeufe und Zusammenfassungen am
  Tag und begrenzt einen Fehler (Schleife, Backfill) auf Kosten im
  einstelligen Dollarbereich bei ueblichen Preisen. Ein unbrauchbarer Wert
  in der Env laesst den Default gelten und steht als Hinweis in `/healthz`.

### C2. Apps, deren Inhalte im Haus bleiben

- `OPENAPPS_MODEL_LOCAL_ONLY_APPS`: Liste von Apps, deren Inhalte nie an
  einen externen Anbieter gehen. Default leer.
- **Lokal** ist nur `openai-compatible` mit einer lokalen Basis-URL:
  Loopback, private Adresse oder ein Name ohne Punkt im internen Netz.
  Alles andere gilt als extern.
- **Durchsetzung in der Control Plane, nicht in der App:**
  - Ein Lauf (E) mit externem Chat-Anbieter bekommt die Tools dieser Apps
    gar nicht erst angeboten.
  - `generate` und `embed` nehmen Inhalte nur mit Quell-App an
    (`{ id, sourceApp, text }`). Bei externem Anbieter laesst die Control
    Plane Inhalte aus diesen Apps weg und meldet sie als `withheld`.
  - Das Gedaechtnis (F) gibt Eintraege mit solcher Herkunft nur an lokale
    Anbieter weiter.
- Jedes Zurueckhalten steht im Audit (ohne Inhalt).
- Die Tokenzaehlung ist zugleich die Grundlage, die das Zielbild fuer eine
  Abrechnung pro Lauf im Managed-Betrieb nennt.

### D. Apps nutzen den Port nur ueber Plattform-Tools

- `embed` und `generate` als Plattform-Tools (Ziel `platform`, ADR 0022 A),
  je mit `execute`-Freigabe, Default-Deny. Erster Nutzer ist Knowledge
  (ADR 0025). Nutzung zaehlt auf das Subjekt `app:<name>`.
- Der Schluessel verlaesst die Control Plane nie. Eine App, die das nicht
  will, bringt wie bisher einen eigenen Schluessel in ihrer Env mit.

### E. Agents, die in der Plattform laufen

- **Ein Plattform-Agent ist ein Agent-Subjekt** (ADR 0009) mit einem Profil:
  Anweisungen, optional ein Modell, hoechstens N Schritte, Budget. Anlegen
  und pflegen ueber API und MCP (`configure_agent`), dann erst die Seite.
- **Starten:** `start_agent_run` (API und MCP), eine Erwaehnung des Agenten
  (ADR 0023 D ueber den Eingang aus ADR 0022) oder „Ask agent“ im Home.
  Recht zum Starten: `execute` auf `agent:<name>`. Das ist ein neues Verb an
  der bestehenden Ressource `agent` (bisher `read` und `write`).
- **Handeln:** Der Lauf sieht genau die Tools, die der Agent ueber `/mcp`
  saehe, und ruft sie ueber dieselbe Domaenenfunktion `callAppTool`. Jeder
  Aufruf ist protokolliert, mit der Lauf-Id als `correlationId`. DoD 6 gilt
  damit unveraendert auch innerhalb der Plattform.
- **Wirksame Rechte eines Laufs = Freigaben des Agenten geschnitten mit
  denen des Ausloesers.** Startet Anna, die das CRM nicht lesen darf, einen
  Agenten mit CRM-Freigabe, sieht der Lauf keine CRM-Tools. Sonst liest
  jeder ueber den Agenten, was er selbst nicht darf. Ausgeloest von einer
  App (Abonnement) gelten die Freigaben des Agenten allein.
- Ergebnis: im Lauf gespeichert (`get_agent_run`, `list_agent_runs`), dazu
  eine Benachrichtigung an den Ausloeser. In eine App schreibt der Agent nur
  ueber deren Tools.
- **Kein Freigabe-Gate fuer einzelne Agent-Aktionen.** Das ist ein
  Nicht-Ziel (Brief, v2, bezahlt). Grenzen sind Freigaben, Schrittzahl und
  Budget.
- Laufzeit: ein dritter Prozess im Container der Control Plane (neben
  Next und MCP, ADR 0009), Warteschlange in Postgres, Parallelitaet per Env.

### F. Team-Gedaechtnis

- **Port `MemoryStore`** in der Control Plane, mit `remember`, `recall`,
  `forget` und `list_memories` als API und MCP-Tools, fuer Plattform-Agents
  und externe Agents gleich.
- **Wer liest:** Jeder Eintrag traegt seine Herkunft, die Apps, deren Tools
  im Lauf bis dahin benutzt wurden. Der Agent kann sie nicht verkleinern.
  Ein Lauf oder Aufrufer sieht einen Eintrag nur, wenn er alle diese Apps
  lesen darf. Menschen mit `write` auf `agent:<name>` koennen Eintraege
  dieses Agenten sehen und loeschen.
- **Erste Implementierung: Postgres in der Control Plane** (Volltext, mit
  Vektoren, sobald ADR 0025 Embeddings konfiguriert). Kein neuer Dienst.
- **Zweite Implementierung, optional: cognee** hinter demselben Port
  (`OPENAPPS_MEMORY_BACKEND=cognee`). Je Herkunfts-App ein Dataset,
  cognee-eigene Rechte aus (`ENABLE_BACKEND_ACCESS_CONTROL=false`), nur im
  internen Netz, nur die Control Plane spricht mit ihm und fragt nur die
  Datasets der lesbaren Apps. Kommt, wenn sich das Postgres-Gedaechtnis im
  Betrieb als zu schwach zeigt, nicht vorab.

### G. Externe Agents bleiben gleichwertig

Claude, Gemini und andere ueber MCP nutzen dieselben Tools mit denselben
Freigaben, auch das Gedaechtnis. Der eingebaute Agent ist eine Bequemlichkeit
fuer Ausloeser aus der Oberflaeche, kein bevorzugter Weg.

## Folgen

- Die Control Plane braucht Egress zum Anbieter; bei Ollama ein Ziel im
  eigenen Netz.
- Mit Konfiguration gehen Inhalte (Prompts, Abschnitte, Tool-Ergebnisse) an
  den gewaehlten Anbieter, ausser aus Apps in
  `OPENAPPS_MODEL_LOCAL_ONLY_APPS` (C2). `openai-compatible` mit einem
  lokalen Modell haelt alles im Haus.
- `sourceApp` an `generate` und `embed` ist eine Angabe der aufrufenden App.
  Die Control Plane kann sie nicht nachpruefen; sie haengt am Review der App
  (wie `actor` in ADR 0022).
- Ein dritter Prozess im Container: Endet er, endet der Container, wie in
  ADR 0009.
- Tool-Ergebnisse sind fremder Text im Prompt. Eine Prompt-Injection kann
  den Lauf nur innerhalb der geschnittenen Rechte lenken; mehr verhindern
  erst Freigabe-Gates (v2).
- Neue Tabellen: `agent_profiles`, `agent_runs`, `model_usage`, `memories`.

### Umsetzung: Abweichungen und Festlegungen (Schritte 1 bis 6, 28.11.2026)

**Keine Verwaltung in Laeufen.** Ein Lauf bekommt `create_app`,
`request_deploy`, `rollback`, `grant`, `revoke`, `create_group`,
`grant_group_member`, `revoke_group_member` und `disable_agent` nicht, auch mit
Freigabe (`RUN_EXCLUDED_TOOLS`). Ein Lauf handelt auf Text hin, den Dritte
schreiben koennen; Rechte und Deploys bleiben bei Menschen und bei bewusst
gestarteten externen Agents.

**Port und Adapter (Schritt 1)**

- **Der Port `ModelProvider` steht in `domain/ports.ts`**, wie
  `DeploymentBackend`; in `src/adapters/models/` liegen nur die drei Adapter
  und das Lesen der Env (`modelSetupFromEnv`). Die Domaene kennt je Anbieter
  nur `kind` und `local`.
- **Formate:** Anthropic Messages API (`POST /v1/messages`,
  `anthropic-version: 2023-06-01`, Schluessel in `x-api-key`); Gemini
  `models/{model}:generateContent` und `:batchEmbedContents` mit dem
  Schluessel im Header `x-goog-api-key`, nie als `?key=` in der URL; Tools
  als `parametersJsonSchema`; die rohen Teile einer Antwort gehen in der
  naechsten Runde unveraendert zurueck (Signaturen von Gedankengaengen).
  OpenAI-kompatibel `chat/completions` und `embeddings`, Schluessel als
  Bearer, lokal ohne Schluessel. Gemini nennt beim Einbetten keine Tokens;
  sie werden mit vier Zeichen je Token geschaetzt.
- **Kein Text des Anbieters nach aussen.** Eine Fehlermeldung nennt nur
  Anbieter, HTTP-Status und die Fehlerart aus einem festen Zeichensatz, ein
  Netzfehler nur seine Art; der Schluessel wird zusaetzlich aus jeder Meldung
  entfernt. Grund: Manche Anbieter wiederholen Teile des Schluessels im
  Fehlertext.
- **Env, strenger als beschrieben:** `openai-compatible` ohne Basis-URL ist
  `https://api.openai.com/v1`; eine externe Basis-URL muss `https` sein und
  darf weder Zugangsdaten noch Query tragen; ohne Schluessel nur lokal. Eine
  `BASE_URL` bei `anthropic` oder `gemini` ist ein Fehler, kein stilles
  Ignorieren. Laesst sich `OPENAPPS_MODEL_LOCAL_ONLY_APPS` nicht lesen, sind
  alle **externen** Anbieter aus (lokale bleiben), damit ein Tippfehler keine
  App nach aussen gibt.
- **`/healthz`** zeigt `models: chat …, embedding …` und je Problem eine
  Zeile `models: NOTE …`, immer mit 200, ohne Anbieter, Modell oder Wert.
- **Lokal** ist genau: `localhost`, `127.0.0.0/8`, `::1`, `10/8`,
  `172.16/12`, `192.168/16`, `fc00::/7` und ein Name ohne Punkt, nach der
  Normalisierung durch die WHATWG-URL. Link-Local (`169.254/16`) und
  IPv4 in IPv6 gelten als extern.
- **Offen aus Schritt 1:** der Probelauf je Anbieter mit Protokoll in
  `docs/nachweise/` braucht echte Schluessel und ist nicht gemacht.

**Nutzung, Grenzen, lokale Apps, `generate` und `embed` (Schritt 2)**

- **Pruefung vor dem Aufruf mit Schaetzung:** Eine Grenze gilt als erreicht,
  wenn das bisher Verbrauchte plus die Schaetzung des Aufrufs (Zeichen durch
  vier plus die hoechste Ausgabe) sie ueberschreitet. Gleichzeitige Aufrufe
  koennen die Grenze um hoechstens je einen Aufruf ueberschreiten.
- **Fehlt die Nutzungstabelle** (`modelUsage`), ruft die Plattform kein
  Modell auf (`not_configured`): ohne Zaehlung keine Grenze.
- **Audit:** je Aufruf `model_call` (Zweck, Anbieter, Modell, Tokens, Dauer,
  Ergebnis), je Zurueckhalten `model_withheld` (Apps und Anzahl), beides ohne
  Inhalt. Ein ueberschrittenes Budget steht mit 0 Tokens in `model_usage`
  und als `denied` im Audit. `model_usage` hat keine Aufbewahrungsfrist.
- **`generate`:** `{ instruction, contents?: [{ id, sourceApp, text }],
maxTokens?, purpose? }` (`purpose` ist `answer` oder `generate`), Antwort
  `{ status, text, withheld, model, usage }`. Die Anweisung gilt als Inhalt
  der aufrufenden App: Ist sie selbst lokal-only und der Anbieter extern,
  geht gar nichts hinaus (`status: withheld`). Hoechstens 50 Inhalte, 20 000
  Zeichen je Inhalt, 200 000 insgesamt, Ausgabe bis 4096 (Default 1024).
- **`embed`:** `{ texts: [{ id, sourceApp, text }] }` (hoechstens 100),
  Antwort `{ status, model, embeddings: [{ id, vector }], withheld }`.
- **Nur fuer Apps.** `generate` und `embed` sind keine MCP-Tools fuer
  externe Agents: Das waere der Modell-Proxy fuer fremde Clients, den das
  Zielbild ausschliesst.
- **HTTP-Codes:** ohne Modell 503 `not_configured`, Tagesgrenze 429
  `budget_exceeded`, Anbieter weg oder mit Fehler 502 `model_error`.

**Laeufe (Schritt 3)**

- **Der Schnitt sitzt an einer Stelle:** `findActive` der Freigaben im
  Kontext des Laufs (`run-rights.ts`). Fragt eine Pruefung nach dem Agenten,
  gilt eine Freigabe nur, wenn der Ausloeser dasselbe darf, bei jeder
  Pruefung frisch gelesen (Gruppen ueber seine E-Mail). Fragen nach anderen
  Subjekten gehen unveraendert durch.
- **Was „dasselbe“ fuer Menschen heisst:** Menschen haben keine
  `execute`-Freigaben auf App-Tools; sie arbeiten in einer App, sobald sie
  `read` auf sie haben. Ein App-Tool deckt ein Mensch deshalb mit `read` auf
  die App, ein Agent als Ausloeser mit derselben Freigabe. Ausnahme ist das
  Gedaechtnis (`platform.remember`, `platform.recall`): Es braucht nur der
  Agent, weil die Herkunft jedes Eintrags mit denselben geschnittenen Rechten
  geprueft wird.
- **Lokale Apps:** Bei externem Chat-Anbieter behandelt der Schnitt jede
  Ressource einer lokal-only App als nicht freigegeben. Damit fehlen ihre
  Tools, `search`, `resolve_refs`, `list_inbox` und `recall` zeigen nichts
  aus ihr, und ein Aufruf wird blockiert, nicht nur ausgeblendet.
- **Die Tools kommen aus dem Plattform-MCP selbst:** Der Prozess fuer Laeufe
  baut je Lauf `createPlatformServer` mit dem Kontext des Laufs und spricht
  ihn ueber eine Verbindung im Prozess (`InMemoryTransport` des MCP-SDK) an.
  Jeder Aufruf traegt die Lauf-Id als `correlationId`.
- **Nicht im Lauf:** `create_agent` (gaebe ein Secret an den Anbieter),
  `start_agent_run` und `configure_agent` (sonst waeren Schrittzahl und
  Budget keine Grenze). Ein Name, der nicht angeboten wurde, laeuft nicht.
- **Profil-Defaults:** 8 Schritte (hoechstens 20), 50 000 Tokens je Lauf
  (1000 bis 500 000), Anweisungen bis 8000 Zeichen, Modell optional als
  anderer Modellname desselben Chat-Anbieters. Ein Schritt gibt hoechstens
  2048 Tokens aus; ein Tool-Ergebnis sieht das Modell mit hoechstens 16 000
  Zeichen.
- **Prozess:** `apps/platform-mcp/src/runner.ts`, dritter Prozess in
  `start.sh`. Er nimmt Laeufe mit `FOR UPDATE SKIP LOCKED` (alle 2 s, ohne
  Modell alle 15 s), Parallelitaet `OPENAPPS_AGENT_RUN_CONCURRENCY`
  (Default 2, 1 bis 10), Frist 15 Minuten. Ein Lauf, dessen Prozess endete,
  wird beim naechsten Start `failed` (`interrupted`), nicht wiederholt: Er
  kann schon in Apps geschrieben haben.
- **Beim Start des Laufs** wird `execute` des Ausloesers noch einmal
  geprueft; ist es weg, endet der Lauf ohne Modell-Aufruf.
- **Herkunft eines Laufs (`used_apps`):** die App jedes App-Tools; fuer Apps
  mit `gatewayContext: readableApps` (Knowledge) alle Apps, die der Lauf
  lesen darf; dazu jede App, die in einem Ergebnis eines Plattform-Tools als
  `app`, `appName`, `sourceApp` oder in `apps` steht (`search`,
  `resolve_refs`, `list_inbox`, `recall` …). Lieber zu viel als zu wenig.
- **Wer einen Lauf sieht:** der Ausloeser, der Agent selbst oder wer `write`
  auf den Agenten hat, und jeder nur, solange er alle Apps aus `used_apps`
  lesen darf. Sonst gibt es den Lauf fuer ihn nicht (404).

**Ausloeser (Schritt 4)**

- **Erwaehnung:** Kommt `platform.mentioned` bei einem Agenten mit Profil an
  (also mit `read` auf die Quell-App), startet genau ein Lauf
  (`dedupe_key` aus Quell-App, Ereignis und Agent). Ausloeser ist, wer laut
  `set_refs` erwaehnt hat (`actor`, `user:<id>` oder `human:<email>`); das
  ist wie in ADR 0022 eine Angabe der App und haengt an ihrem Review. Sie
  kann den Lauf nur verkleinern, nie ueber die Freigaben des Agenten
  hinaus heben. Ohne bekannte Person, ohne `execute` des Ausloesers, ohne
  Modell oder bei lokal-only Quelle und externem Anbieter startet nichts,
  mit Audit-Eintrag `start_agent_run`. Ein Agent ohne Profil ist ein externer
  Agent; er bekommt nur den Eintrag im Eingang.
- **Ergebnis im Eingang:** nur fuer Laeufe aus einer Erwaehnung, als
  Ereignis `platform.agent_run_finished` **der Quell-App** an den Ausloeser
  (der Eingang prueft beim Lesen `read` auf diese App). Ein Lauf aus dem Home
  oder ueber API und MCP hat keine Quell-App, und `events.app_name` verweist
  auf `apps`; er steht deshalb nur in der Liste der Laeufe im Home und in
  `list_agent_runs`. **Abweichung** von „dazu eine Benachrichtigung an den
  Ausloeser“ fuer diesen Fall.
- **API fuer Menschen:** `GET /api/agent-profiles`,
  `PUT /api/agents/:agent/profile`, `GET`/`POST /api/agent-runs`,
  `GET /api/agent-runs/:run`; schreibend nur von der eigenen Herkunft. Eine
  Seite zum Pflegen der Profile gibt es noch nicht (API und MCP zuerst).
- **Home:** „Ask agent“ und die Liste der Laeufe nur mit Chat-Modell; ohne
  Modell sind sie nicht sichtbar.

**Gedaechtnis (Schritt 5)**

- **Der Port heisst `TeamMemoryStore`**, weil `MemoryStore` schon der
  Speicher im Prozess fuer die Tests ist. `recall` und `list` bekommen die
  lesbaren Apps als Pflichtargument, damit eine zweite Implementierung
  (cognee) nur die passenden Datasets fragt; die Domaene prueft das Ergebnis
  noch einmal.
- **Freigaben:** `execute` auf `tool:platform.remember` bzw.
  `tool:platform.recall`, vergeben wie die Plattform-Tools fuer Apps (wer
  dasselbe Verb auf `app:*` hat). Merken duerfen nur Agents; `recall` auch
  Menschen mit Freigabe.
- **Herkunft eines externen Agents:** Die Plattform sieht seine frueheren
  Aufrufe nicht. Herkunft sind deshalb alle Apps, die er beim Merken lesen
  darf, dazu seine Angabe. Eine Angabe vergroessert nur, und nur um Apps,
  die der Aufrufer lesen darf.
- **Strenger als beschrieben:** Wer `write` auf den Agenten hat, sieht und
  loescht dessen Eintraege nur, wenn er auch alle Herkunfts-Apps lesen darf.
  Sonst saehe die Pflege eines Agenten Inhalte aus Apps, die sie nicht lesen
  darf.
- **Postgres:** Volltext mit `simple` und `ILIKE` als Rueckfall, Herkunft als
  `apps <@ lesbar`. Vektoren kommen mit ADR 0025 in einer eigenen Migration.
- **API fuer Menschen:** `GET /api/memories` (`?q=` sucht, `?agent=` listet)
  und `DELETE /api/memories/:memory`.

**Zusammenfassung (Schritt 6)**

- `POST /api/inbox/summary` nimmt die Titel des offenen Eingangs (hoechstens 50) ueber `listInbox`, also mit der zweiten Rechtepruefung, Zweck
  `summary`, Nutzung auf die Person. Eintraege lokaler Apps bleiben bei
  externem Anbieter draussen. Kein MCP-Tool: Ein externer Agent fasst seinen
  Eingang selbst zusammen.

**Nicht gebaut:** Schluessel-Stufe 2, cognee, Benachrichtigungen nach
aussen, der Umzug des Review-Gates auf den Port, eine Seite zum Pflegen der
Profile, Knowledge als erster Nutzer von `embed` und `generate` (inzwischen
gebaut, ADR 0025, Umsetzung).

## Alternativen

- **Kein eingebautes Modell, nur externe Agents:** Haelt das Zielbild, aber
  Erwaehnung, Zusammenfassung und `answer` gibt es dann nicht. Verworfen,
  weil BYOK und „aus“ als Standard das Zielbild nur fuer den lockern, der
  es will.
- **Modell-Schluessel in jeder App:** Kein zentrales Budget, kein Audit, der
  Schluessel in vielen Containern. Verworfen fuer die Plattform-Funktionen;
  fuer eigene Zwecke einer App bleibt es erlaubt.
- **Ein Dienst wie LiteLLM als Modell-Gateway:** Ein weiterer Dienst im
  Betrieb (Schwelle 2 h pro Woche, Setup 30 Min, Brief) fuer drei Adapter.
  Verworfen.
- **Plattform-Agent mit den Rechten des Agenten allein:** Jeder Ausloeser
  liest dann mit den Rechten des Agenten. Verworfen zugunsten des
  Schnitts.
- **Plattform-Agent mit den Rechten des Ausloesers allein:** Der Agent
  braeuchte keine eigenen Freigaben mehr, DoD 6 liefe ins Leere. Verworfen.
- **cognee als erstes Gedaechtnis.** Geprueft: Apache-2.0, Python-Dienst mit
  Docker-Image, REST-API, TS-SDK und MCP-Server; baut aus Text einen
  Wissensgraphen plus Vektoren (`remember`, `recall`, `improve`,
  `forget`); laeuft ohne LLM mit lokalem GLiNER und lokalen Embeddings;
  eigenes mandantenfaehiges Rechtemodell. Fuer uns spricht: Graph und
  Verbesserung aus Rueckmeldungen gibt es fertig. Dagegen, als erstes: ein
  weiterer Dienst mit Modell-Downloads im Betrieb; Postgres als
  Graph-Speicher ist laut README nur Demo, produktiv kaeme also ein weiterer
  Speicher dazu; sein Rechtemodell muss ganz aus bleiben, sonst gaebe es
  zwei (CLAUDE.md 4). Darum hinter dem Port als zweite Implementierung,
  nicht als erste.

## Schnitt

1. **Port und Adapter.** `ModelProvider`, drei Adapter, Env-Pruefung,
   Zustand in `/healthz`.
   DoD: Vertragstests je Adapter gegen aufgezeichnete Antworten; Test ohne
   jede Env: Control Plane startet, jede Modell-Funktion `not_configured`;
   je Anbieter ein Probelauf mit Protokoll in `docs/nachweise/`.
2. **Nutzung, Grenzen, lokale Apps.** `model_usage`, Budgets mit Default,
   `OPENAPPS_MODEL_LOCAL_ONLY_APPS`, Audit; Plattform-Tools `embed` und
   `generate` mit Freigabe. Die Default-Werte werden hier festgelegt und im
   ADR nachgetragen.
   DoD: Test: Grenze ueberschritten blockiert und steht im Audit; ohne Env
   gilt der Default; im Audit steht kein Prompt; ohne Freigabe 403; Inhalt
   einer lokalen App geht bei externem Anbieter nicht raus (`withheld`), bei
   lokaler Basis-URL schon; ein Lauf mit externem Anbieter sieht die Tools
   dieser App nicht.
3. **Laeufe.** `agent_profiles`, `agent_runs`, Prozess, Werkzeuge ueber
   `callAppTool`, Schnitt der Rechte.
   DoD: Test nach dem Muster von DoD 6: zwei Agents mit und ohne Freigabe;
   ein Ausloeser ohne `read` auf dem CRM sieht im Lauf keine CRM-Tools;
   jeder Tool-Aufruf im Audit mit der Lauf-Id.
4. **Ausloeser.** `start_agent_run`, `execute` auf `agent:<name>`,
   Erwaehnung ueber ADR 0022 und 0023, Knopf im Home.
   DoD: Erwaehnung im Wiki startet genau einen Lauf, Ergebnis im Eingang des
   Ausloesers; ohne `execute` kein Lauf und ein Audit-Eintrag.
5. **Gedaechtnis.** `MemoryStore` mit Postgres, Herkunft aus dem Lauf,
   vier Tools.
   DoD: Test: Eintrag aus einem Lauf mit CRM-Tools ist fuer einen Aufrufer
   ohne `read` auf dem CRM unsichtbar; der Agent kann die Herkunft nicht
   verkleinern; `forget` loescht hart.
6. **Zusammenfassung im Home** (ADR 0022 Schritt 7).
7. **Nur bei Bedarf:** Stufe 2 der Schluessel; cognee hinter dem Port.

## Entscheidungen des Nutzers (27.11.2026)

- **Prioritaet:** jetzt, vor den uebrigen Schritten des Zielbilds.
- **Zielbild:** Lockerung freigegeben. Die Plattform ruft ein Modell nur mit
  eigenem Schluessel (BYOK) auf, ohne Schluessel nie; `docs/08-zielbild.md`
  ist nachgezogen.
- **Kein Standard-Modell**, nur BYOK. Anbieter mindestens Anthropic, Google
  (Gemini) und OpenAI-kompatibel (auch lokal, Ollama).
- **Schluessel:** Stufe 1 (Env je Installation) zuerst; Stufe 2 erst bei
  Bedarf.
- **Tagesgrenzen** per Env, mit konservativem Default je Installation und je
  Subjekt.
- **Datenabfluss:** `OPENAPPS_MODEL_LOCAL_ONLY_APPS`, Default leer (C2).
- **cognee** erst bei Bedarf, hinter dem Port.
- Externe Agents ueber MCP bleiben gleichwertig, der eingebaute Agent ist
  optional.
