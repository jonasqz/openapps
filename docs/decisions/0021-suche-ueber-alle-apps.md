# ADR 0021: Suche ueber alle Apps

Stand: 27.11.2026

## Kontext

Die Leiste (ADR 0017) hat eine Befehlspalette „Search or jump to… ⌘K“, die
nur zu Seiten und Apps springt. Wer einen Deal, eine Aufgabe oder eine
Wiki-Seite sucht, muss wissen, in welcher App sie steht, und dort suchen.
Agents haben dasselbe Problem: Sie muessen jedes Such-Tool einzeln kennen und
einzeln freigegeben bekommen.

Knowledge ist seit ADR 0020 die gemeinsame Suche fuer **Inhalte**, die Apps
dort abliefern (Passagen mit Quelle, fuer Antworten). Das ist etwas anderes
als „finde den Deal ACME“: Dafuer muesste jede App jeden Datensatz
abliefern, mit jeder Aenderung, und Knowledge muesste fuer jeden Datensatz
wissen, wer ihn sehen darf.

Drei Fragen waren zu klaeren:

1. **Wer darf in welcher App suchen**, ohne dass ein zweites Rechtemodell
   entsteht und ohne dass ein Agent ueber die Suche an ein Tool kommt, das ihm
   niemand freigegeben hat?
2. **Wie erreicht die Leiste die Suche.** Sie laeuft im Browser auf dem Host
   der Apps (`https://apps.example.com/crm`, lokal `http://127.0.0.1:8090/crm`),
   die Control Plane auf einem anderen Host.
3. **Was passiert, wenn eine App langsam oder kaputt ist.**

## Entscheidung

### A. Foederiert, kein Index

- Die Control Plane fragt die **Such-Tools der Apps parallel** ab und fuegt
  die Treffer nach App zusammen (`searchApps` in
  `domain/platform-search.ts`). Es gibt keinen zentralen Index. Jede App sucht
  in ihren eigenen Daten, mit ihrer DB-Rolle und der Identitaet des
  Aufrufers, wie bei jedem anderen Tool-Aufruf.
- Eine App nimmt teil, indem sie ihr Such-Tool im Manifest benennt:
  `"search": { "tool": "pages.search" }`. Das Tool muss in `offeredTools`
  stehen und `verb: read` haben (Schema-Pruefung). Ohne das Feld nimmt die
  App nicht teil.
- **Festes Format** (`SearchToolResult` in `@openapps/sdk`):
  Eingabe `{ query, limit }`, Ausgabe
  `{ hits: [{ id, title, snippet?, url, kind? }] }`. `url` ist ein Pfad in der
  App ohne basePath; die Control Plane setzt die Adresse der App davor.
  Treffer mit einer anderen Adresse (Schema, `//`, `..`, Backslash) fallen weg
  (`normalizeSearchResult`). Mehr Felder darf eine App liefern; uebernommen
  werden nur diese.
- **Frist je App 2 s**, hoechstens 10 Treffer je App (Default 5). Eine App,
  die nicht rechtzeitig, mit Fehler oder in falscher Form antwortet, fehlt im
  Ergebnis und steht unter `failed` (`timeout`, `error`, `invalid_response`).
  Die Suche selbst scheitert nur an falscher Eingabe (unter 2 oder ueber 200
  Zeichen) oder an einem Aufrufer, der gar nicht suchen darf.
- Aufgerufen wird ueber den bestehenden Invoker (`infra/app-tool-invoker.ts`),
  direkt an den Container, signiert mit dem Secret der Ziel-App (ADR 0011).
  Er nimmt jetzt optional die Identitaet eines **Menschen** (nur seine
  eigene: `userId` muss die Actor-Id sein) und ein Abbruchsignal fuer die
  Frist. Apps, die `readableApps` anfordern, bekommen die Liste wie bisher.

### B. Die Rechteregel

Die Plattform-Suche fragt eine App nur, wenn das Subjekt `read` auf diese App
hat; die App filtert innerhalb ihrer Daten wie bisher selbst ueber ihre
DB-Rolle und den signierten Kontext. Im Einzelnen (`maySearchApp`):

| Subjekt | Wird eine App gefragt? |
|---|---|
| Mensch | mit `read` auf die App (`canAccessApp`, dieselbe Pruefung wie die Forward-Auth) |
| Agent | mit `read` auf die App **und** `execute` auf `<app>.<such-tool>` |
| App, Gruppe | nie (PermissionDenied) |

Warum der Agent beides braucht: Der Plattform-MCP gibt Agents App-Tools nur
einzeln frei (`execute`, ADR 0011). Reichte `read` auf die App, kaeme ein
Agent ueber `search` an ein Such-Tool, das ihm niemand freigegeben hat; ein
neues Such-Tool waere fuer ihn sofort offen. Reichte `execute`, saehe er
Inhalte einer App, die er nicht lesen darf; `read` auf die App ist seit ADR
0020 genau die Freigabe „darf Inhalte dieser App sehen“ (Knowledge filtert
damit). Die Schnittmenge oeffnet nichts, was einer der beiden Wege nicht
schon oeffnet.

Warum der Mensch `read` genuegt: Er hat nie Tool-Freigaben, er kommt durch die
Forward-Auth, und die prueft `read` auf die App. Wer die App oeffnen darf,
kann in ihr suchen; die Suche zeigt ihm nichts, was die App ihm nicht ohnehin
zeigt, und die App sieht dieselbe signierte Identitaet wie beim Oeffnen.

Default-Deny bleibt so gewahrt: Ohne Freigabe wird die App **nicht gefragt**
und erscheint auch nicht unter `failed`. Wer sie nicht lesen darf, erfaehrt
nicht, dass es sie gibt. Das Plattform-Tool `search` selbst braucht wie
`list_apps` keine Freigabe; es zeigt nur, was der Aufrufer ohnehin darf.

### C. Der Weg von der Leiste zur Suche

- **Ein reservierter Pfad auf dem Host der Apps: `/_platform/search`.**
  App-Namen beginnen nie mit `_`, keine App kann ihn belegen.
- Der Generator schreibt dafuer einen eigenen Router `openapps-platform`
  (`Host(<apps-domain>) && PathPrefix(/_platform/)`) auf die Control Plane, mit
  **denselben zwei Middlewares** wie jeder Router (ADR 0008): erst alle
  `X-Auth-*` der Anfrage loeschen, dann die Forward-Auth.
- Die Forward-Auth laesst unter `/_platform/` **genau** die Pfade aus
  `PLATFORM_PATHS` durch (heute nur die Suche), nach derselben strengen
  Lesart wie die Allowlist der Control Plane (kein `..`, keine zweite
  Kodierung, kein Praefix-Vergleich), und nur auf dem Host der Apps. Ohne
  Session 401 statt 302 (die Leiste ruft per `fetch`), mit Session 200
  **ohne** Identitaets-Header.
- Die Control Plane schreibt `/_platform/search` auf `GET /api/search` um
  (Next-Rewrite; ein Ordner `_platform` waere in Next privat) und liest die
  Person **aus der Session im Cookie**, nicht aus Headern. Gefaelschte
  `X-Auth-*` erreichen sie auf diesem Weg nicht (Strip-Middleware), und
  glauben wuerde sie ihnen auch auf jedem anderen nicht.
- Antwort mit `cache-control: no-store` und `nosniff`, ohne CORS-Header:
  Eine fremde Seite kann die Antwort nicht lesen.
- Auf dem Host der Control Plane ist dieselbe Route als `/api/search` und
  `/_platform/search` erreichbar; die Verwaltung nutzt dieselbe Leiste.
- **Lokal** (ADR 0013): Der Ansehen-Proxy auf 8090 hat keine Session und
  keine Forward-Auth. Er beantwortet `/_platform/search` selbst, mit
  derselben Foederation (`federateSearch`), als der Betrachter, ueber alle
  deployten Apps mit Such-Tool, so wie er in der Leiste alle Apps zeigt. Im
  lokalen Traefik (`https://apps.local.test:8443`) gilt der Weg des Servers,
  weil die Control Plane dort dieselbe `openapps.yaml` schreibt.

### D. Audit

Genau ein Eintrag `search` je Suche, auch abgelehnt oder fehlerhaft, mit den
gefragten Apps, den Ausfaellen und der Zahl der Treffer. **Der Suchtext steht
nicht im Log**, nur seine Laenge: Suchtexte enthalten Kunden- und
Personennamen, und das Log lesen alle Administratoren. Einzelne
`call_app_tool`-Eintraege je App gibt es fuer die Suche nicht; der eine
Eintrag nennt sie.

### E. Die Standard-Apps

- **Wiki 0.3.2:** `pages.search` liefert zusaetzlich `url` (`/pages/<id>`)
  und `kind: page`; sonst unveraendert.
- **Knowledge 0.2.2:** neues Tool `documents.search` statt `search`
  umzubauen. `search` liefert Passagen fuer Antworten mit Quellenangabe, ein
  Agent zitiert daraus; diese Form bleibt. `documents.search` liefert je
  Dokument einen Treffer und **nur eigene Dokumente** (ohne Quell-App): Eine
  Wiki-Seite findet die Suche schon im Wiki, sonst stuende sie doppelt da.
- **CRM 0.3.0:** neues Tool `search` ueber Firmen (Name, Branche, Website),
  Kontakte (Name, E-Mail, Telefon, Rolle) und Deals (Titel), `ilike`.
- **Tasks 0.3.0:** neues Tool `search` ueber Aufgaben (Titel, Beschreibung)
  und Projekte (Name, Beschreibung), `ilike`. Projekte verlinken auf die
  gefilterte Liste, weil sie keine eigene Seite haben.
- Keine Migration: Bei der Groesse dieser Tabellen reicht ein Scan. Ein
  Trigramm-Index kommt mit einer neuen Migration, wenn es langsam wird.

### F. Die Leiste

`CommandPalette` bekommt eine optionale Suche (`PlatformSearch`). Ab zwei
Zeichen, 250 ms nach dem letzten Tastendruck, eine Anfrage zur Zeit; eine
aeltere Antwort nach einer neueren wird verworfen. Treffer stehen nach App
gruppiert unter den Sprungzielen und sind mit denselben Tasten erreichbar.
Lade-, Leer- und Fehlerzustand und die Apps ohne Antwort stehen unter den
Treffern. `NextPlatformShell` schaltet die Suche ein, sobald die Navigation
der Plattform gueltig ist (also hinter dem Gateway oder dem Ansehen-Proxy);
ohne sie, etwa bei `pnpm dev`, bleibt es beim Springen.

## Folgen

- Jede Suche kostet eine Forward-Auth-Pruefung, eine Rechtepruefung je App
  mit Such-Tool und einen Aufruf je erlaubter App. Bei einer Handvoll Apps
  ist das billig; wird es teuer, hilft wie bei der Navigation ein kurzer
  Cache (ADR 0017). Eine Suche dauert hoechstens so lange wie die Frist.
- Es gibt **keine gemeinsame Rangfolge** ueber Apps; jede App sortiert ihre
  Treffer selbst, die Gruppen stehen nach App-Namen. Fuer eine Rangfolge
  ueber alles bleibt Knowledge (ADR 0020).
- Agents brauchen fuer die Suche neue Freigaben: `execute` auf
  `crm.search`, `tasks.search`, `wiki.pages.search`,
  `knowledge.documents.search` zusaetzlich zu `read` auf die App. Der lokale
  Aufbau erteilt sie nicht (er erteilt nur Antraege einer App fuer sich
  selbst).
- Apps, die das Feld nicht haben, und Apps mit aelterem Manifest im Register
  nehmen nicht teil. Erst ein Deploy mit dem Feld schaltet eine App zu.
- Die Konfiguration bekommt einen Router mehr; jeder Deploy schreibt sie
  neu, der Lint und der Startcheck pruefen ihn wie jeden anderen. Die
  Pruefliste `infra/app-urls.txt` sollte `/_platform/search` und einen
  anderen Pfad unter `/_platform/` enthalten (Beispiel ergaenzt).
- Wer in der App suchen darf, sieht auch, ob sie ausfaellt. Mehr verraet
  `failed` nicht: keine Fehlermeldung der App, kein Status.
- Ein Such-Tool, das trotz `verb: read` schreibt, wuerde bei jedem
  Tastendruck schreiben. Das Review-Gate prueft das nicht; es bleibt Sache
  des Codes und des Claude-Reviews.

## Alternativen

- **Ein zentraler Index ueber Knowledge** (jede App liefert jeden Datensatz
  ab, die Leiste fragt Knowledge): eine Rangfolge ueber alles und spaeter
  Embeddings. Verworfen: Der Index ist so aktuell wie die letzte Lieferung,
  jede App braeuchte eine Outbox fuer jeden Datensatz, und Knowledge muesste
  die Rechte jeder App nachbilden (wer darf welchen Deal sehen). Das ist eine
  Kopie des Rechtemodells, die auseinanderlaeuft. Knowledge bleibt die Suche
  fuer Inhalte zum Antworten, die Leiste fragt die Apps selbst.
- **Der Browser ruft die Control Plane auf ihrem eigenen Host** (CORS mit
  Cookie): ein Cookie, das zwischen zwei Hosts gilt, und CORS mit
  Credentials. Verworfen wie in ADR 0017.
- **Die App fragt die Control Plane auf dem Server, im Namen der Person:**
  Rechte- und Weiterleitungscode in jeder App. Verworfen (CLAUDE.md 3).
- **Die Forward-Auth setzt signierte `X-Auth-*` auch fuer die Control Plane,
  und die Route glaubt ihnen:** ein zweiter Weg zur Identitaet der Control
  Plane neben der Session, mit einem Secret, das es fuer die Control Plane
  nicht gibt. Verworfen; die Session ist schon da.
- **`execute` auf das Such-Tool auch fuer Menschen:** Menschen haben keine
  Tool-Freigaben; die Suche waere fuer alle leer, bis jemand pro Person und
  App Freigaben vergibt. Verworfen.
- **Fuer Agents nur `read` auf die App:** oeffnete jedes neue Such-Tool ohne
  Freigabe. Verworfen, siehe B.
- **Je App ein Aufruf ueber `callAppTool` mit eigenem Audit-Eintrag:** prueft
  `execute`, was fuer Menschen nicht passt, und schriebe je Tastendruck
  mehrere Eintraege. Verworfen zugunsten eines Eintrags je Suche.
- **Knowledge passt `search` an das Format an:** braeche Agents, die aus
  Passagen zitieren, und brachte Wiki-Seiten doppelt. Verworfen zugunsten
  von `documents.search`.
- **Ordner `%5Fplatform` in Next statt Rewrite:** ginge auch, versteckt den
  Pfad aber in einem kodierten Ordnernamen. Verworfen.
