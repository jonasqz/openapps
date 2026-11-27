# ADR 0020: Knowledge als gemeinsame Suche, Aufrufe von App zu App

Stand: 27.11.2026

## Kontext

Jede App hat ihre eigene Suche (Wiki: `pages.search`, Knowledge: `search`).
Wer etwas sucht, muss wissen, in welcher App es steht. Knowledge soll die
eine Suche der Plattform werden: Apps liefern ihre Inhalte dort ab, das Wiki
zuerst. Embeddings kommen in einem zweiten Schritt; dieser Schnitt muss sie
aufnehmen koennen, ohne dass Tools oder Header sich aendern.

Dafuer fehlten drei Dinge:

1. **Eine App kann kein Tool einer anderen App aufrufen.** Den Weg gibt es
   nur fuer Agents (Plattform-MCP, ADR 0011) und Menschen (Forward-Auth).
2. **Knowledge weiss nicht, was der Aufrufer lesen darf.** Ein Treffer aus dem
   Wiki darf nur erscheinen, wenn der Aufrufer das Wiki lesen darf. Apps
   enthalten keinen Rechte-Code (CLAUDE.md 3), und die Navigation aus ADR
   0017 ist ausdruecklich nur Anzeige.
3. **Knowledge kennt keine Herkunft.** Ein Dokument hat nur eine freie
   Quellenangabe, keinen Eigentuemer, der es ersetzen oder entfernen darf.

## Entscheidung

### A. App ruft App: derselbe Weg wie fuer Agents, mit eigener Signatur

- Die App ruft **die Control Plane**, nicht die Ziel-App:
  `POST <OPENAPPS_PLATFORM_URL>/api/apps/<ziel-app>/tools/<tool>`, Body sind
  die Argumente als JSON. Die Control Plane prueft, protokolliert und leitet
  weiter, genau wie der MCP fuer einen Agenten (`callAppTool`, jetzt in der
  Domaene statt im MCP, damit beide Wege dieselbe Funktion nutzen).
- **Subjekt `app:<name>`**, Freigabe `execute` auf `<ziel-app>.<tool>`.
  Default-Deny: ohne Freigabe 403, und ein Audit-Eintrag `call_app_tool`.
  Auch eine abgewiesene Signatur steht im Audit-Log.
- **Eigene Zugangsdaten der App:** `OPENAPPS_CALL_SECRET`, per HKDF aus dem
  Master-Secret abgeleitet wie `OPENAPPS_AUTH_SECRET`, aber mit eigenem
  Kontext (`openapps/app-call-secret/1`). Kein Nutzer-Cookie, kein
  Operator-Token, nichts gespeichert. Die App signiert jeden Aufruf:

  | Header | Inhalt |
  |---|---|
  | `X-OpenApps-Caller` | Name der aufrufenden App |
  | `X-OpenApps-Caller-Issued-At` | Unix-Sekunden |
  | `X-OpenApps-Caller-Signature` | HMAC-SHA256 (Hex) mit `OPENAPPS_CALL_SECRET` |

  Material, je durch `\n` getrennt: `openapps-app-call-v1`, Aufrufer,
  Ziel-App, Tool, Ausstellzeit, SHA-256 (Hex) des Bodys. Fenster 60 s wie
  ADR 0004. Der Body ist gebunden; ein abgefangener Aufruf laesst sich im
  Fenster nur unveraendert wiederholen.
- **Die Ziel-App sieht den Aufrufer** in den fuenf Identitaets-Headern wie
  einen Agenten: Nutzer-Id `app:<name>`, E-Mail `<name>@apps.invalid`,
  keine Gruppen. Das SDK liefert dazu `callerOf(user)` und `ctx.caller` im
  Tool-Handler (`{ kind: 'app', app }`). Die Identitaets-Signatur aendert
  sich nicht.
- **SDK:** `callAppTool(app, tool, args)` mit Timeout (Default 10 s), Fehlern
  mit Code (`not_configured`, `unreachable`, `timeout`, `unauthorized`,
  `denied`, `invalid`, `not_found`, `target_error`) und ohne Secrets in
  Meldungen oder Log.
- **Freigabe:** Die App beantragt sie im Manifest (`requestedGrants` mit
  `subjectKind: app`, `subjectId: <eigener Name>`), erteilt wird sie mit dem
  bestehenden Tool `grant` (`subjectKind: app`). Der lokale Aufbau
  (`lokal-einrichten.ts`) erteilt solche Antraege einer App fuer sich selbst
  automatisch, sonst niemand.

### B. Lesbare Apps als eigener signierter Header

- Zwei neue Header der Forward-Auth, nach dem Muster der Navigation:

  | Header | Inhalt |
  |---|---|
  | `X-Auth-Readable-Apps` | base64url von `{"v":1,"apps":["wiki", …]}` |
  | `X-Auth-Readable-Apps-Signature` | HMAC-SHA256 (Hex) mit dem Secret der App |

  Material: `openapps-readable-apps-v1`, App-Id, Host, Nutzer-Id,
  Ausstellzeit, Header-Wert, je durch `\n` getrennt. Damit haengt der Wert an
  derselben Entscheidung wie die Identitaet und an dieser App.
- `apps` sind die nicht archivierten Apps, auf die der Aufrufer `read` hat,
  dieselbe Pruefung wie die Forward-Auth (`canAccessApp`).
- **Nur fuer Apps, deren Manifest das anfordert:** neues optionales Feld
  `gatewayContext: ["readableApps"]`. Fuer alle anderen gehen beide Header
  leer raus; die Kosten (eine Rechtepruefung je App) traegt nur, wer fragt.
- **Immer gesetzt, aus eingehenden Anfragen geloescht**, in
  `GATEWAY_RESPONSE_HEADERS` und damit in Strip-Middleware,
  `authResponseHeaders`, Konfigurations-Lint und Ansehen-Proxy.
- **Groessenbudget 4 KiB.** Passt die Liste nicht, wird sie gekuerzt (zuerst
  die aufgerufene App, dann alphabetisch). Kuerzen zeigt weniger, nie mehr.
- **Gilt fuer alle drei Aufrufer:** Forward-Auth (Menschen), Plattform-MCP
  (Agents) und App-Aufruf (Apps). Die beiden letzten bilden die Header in
  `callAppTool`, nur wenn das Manifest der Ziel-App sie anfordert.
- **SDK:** `getReadableApps(headers)` liefert die Liste oder `null` und wirft
  nie; `null` bei fehlendem Header, falscher Signatur, abgelaufener
  Identitaet oder unbrauchbarem Inhalt. Tool-Handler bekommen sie als
  `ctx.readableApps`.

### C. Knowledge 0.2.0

- Dokumente haben optional eine **Quelle**: `source_app`, `source_key`
  (eindeutig je Paar), `source_path` (Pfad in der Quell-App fuer den Link
  zurueck) und `source_updated_at` (Stand in der Quell-App). Neue Migration.
- `documents.upsert` und `documents.remove` nehmen die Quell-App **nur** aus
  der geprueften Identitaet (`ctx.caller`). Ein Feld `sourceApp` in den
  Argumenten ist ein Fehler (strenges Schema). Ein Mensch oder Agent bekommt
  400. So kann eine App nur ihre eigenen Inhalte ersetzen oder entfernen.
- `upsert` ersetzt Dokument und Abschnitte in einer Transaktion. Ein Stand,
  der aelter ist als der gespeicherte (`sourceUpdatedAt`), wird ignoriert,
  damit eine verspaetete Wiederholung keinen neueren Stand ueberschreibt.
  `remove` loescht hart und ist idempotent.
- Dokumente einer Quell-App lassen sich in Knowledge nicht von Hand
  loeschen: Sie gehoeren der Quelle, der naechste Stand braechte sie zurueck.
- **Sichtbarkeit:** `search`, `documents.list`, `documents.get` und die
  Seiten zeigen Dokumente ohne Quell-App immer, Dokumente mit Quell-App nur,
  wenn die App in der Liste der lesbaren Apps steht. Ohne gueltige Liste
  (`null`) nur Dokumente ohne Quell-App, nie ein Fehler. Ein nicht lesbares
  Dokument gilt bei `documents.get` als nicht vorhanden (404).
- **Volltext Deutsch und Englisch:** zweite generierte Spalte
  `tsv_de = to_tsvector('german', text)` mit GIN-Index. Die Suche fragt beide
  und rankt mit dem besseren der beiden Werte (`greatest`), damit ein Wort,
  das beide Woerterbuecher treffen, nicht doppelt zaehlt. Der Ausschnitt kommt
  aus der Sprache mit dem besseren Rang.
- Der `Retriever` bekommt die Sichtbarkeit als Pflichtargument. Eine spaetere
  Vektorsuche (Schritt 2) ist eine weitere Implementierung derselben
  Schnittstelle und filtert genauso.

### D. Wiki 0.3.0: Outbox

- Jede Aenderung an einer Seite (anlegen, bearbeiten, wiederherstellen,
  verschieben, archivieren) schreibt **in derselben Transaktion** eine Zeile
  in `search_outbox` (eine je Seite, mit fortlaufender Version). Bei
  Titelaenderung und Verschieben auch fuer alle Unterseiten, weil ihr Pfad
  sich aendert.
- **Nach dem Commit** liefert das Wiki ab, ohne darauf zu warten. Geliefert
  wird der aktuelle Stand der Seite (archiviert: `remove`, sonst `upsert`),
  nicht ein Schnappschuss. Geloescht wird die Zeile nur, wenn ihre Version
  noch dieselbe ist; eine Aenderung waehrend der Lieferung geht so nicht
  verloren.
- Speichern scheitert nie an Knowledge: Jeder Fehler (nicht erreichbar,
  keine Freigabe, Knowledge noch alt) bleibt als `last_error` an der Zeile.
  Wiederholt wird beim naechsten Schreiben, beim Start und alle 60 s, solange
  etwas aussteht.
- Beim ersten Start mit 0.3.0 werden alle Seiten einmal eingereiht. Dazu die
  Tools `search.backfill` (alles neu einreihen und liefern) und
  `search.status` (was aussteht, mit Fehler).

## Folgen

- Die Control Plane ist fuer Apps im Plattform-Netz erreichbar
  (`OPENAPPS_PLATFORM_URL` = `CONTROL_PLANE_SERVICE_URL`). Das war sie fuer
  Traefik schon. `/api/apps/*/tools/*` steht **nicht** in der Liste der
  oeffentlichen Pfade: von aussen braucht der Pfad eine Session und
  bekaeme danach trotzdem 401, weil er nur die App-Signatur annimmt.
- Jede App bekommt zwei weitere Env-Variablen: `OPENAPPS_PLATFORM_URL` und
  `OPENAPPS_CALL_SECRET`. Wer sie nutzt, deklariert sie im Manifest.
  Rotation: `auth_secret_generation + 1` rotiert beide Secrets.
- Damit bestehende Apps sie bekommen, zieht jeder Deploy einer schon
  angelegten App die Plattform-Env nach (`mergeEnv` am Backend-Port: fehlende
  oder geaenderte Schluessel setzen, andere unberuehrt), ohne `DATABASE_URL`
  neu zu ziehen; scheitert das, endet der Deploy als `failed`, bevor etwas
  startet.
- Wer `OPENAPPS_CALL_SECRET` einer App kennt, kann im Fenster als diese App
  rufen, aber nur, was sie freigegeben bekam. Wiederholung eines
  abgefangenen Aufrufs ist im 60-s-Fenster moeglich; Upsert und Remove sind
  idempotent, andere Tools muessen das wissen. Eine Nonce-Tabelle waere der
  naechste Schritt, wenn ein nicht idempotentes Tool App-Aufrufe bekommt.
- Apps mit aelterem SDK ignorieren die neuen Header; die
  Identitaets-Signatur ist unveraendert. Knowledge 0.1.x ignoriert sie auch.
  `ctx.caller` und `ctx.readableApps` sind im Typ optional, damit Apps, die
  ihre Handler selbst mit `{ user }` aufrufen (CRM, Tasks), unveraendert
  bauen; fehlend heisst `callerOf(user)` bzw. `null`.
- Agents sehen Wiki-Treffer in Knowledge nur mit `read` auf `app:wiki`.
  Das ist Default-Deny, kann aber ueberraschen: Wer bisher nur `execute` auf
  `knowledge.search` hatte, sieht weiter nur Dokumente ohne Quell-App.
- Die Forward-Auth prueft fuer Knowledge bei jedem Aufruf einmal mehr je
  App. Wie bei der Navigation hilft spaeter ein kurzer Cache.
- Der Zuschnitt fuer Embeddings: Abschnitte, Quelle und Sichtbarkeit liegen
  in Knowledge; eine Vektorspalte an `chunks` und ein zweiter `Retriever`
  reichen. Wiki und Header bleiben.

## Abweichungen vom Entwurf

- **Aufruf ueber die Control Plane statt direkt an die Ziel-App.** Der
  Entwurf liess das offen; direkt ginge nur mit dem Secret der Ziel-App in
  der aufrufenden App. So bleibt die Pruefung an einer Stelle.
- **`sourceUpdatedAt`** ist dazugekommen: Ohne sie koennte eine wiederholte,
  aeltere Lieferung einen neueren Stand ueberschreiben.
- **`documents.delete` lehnt Dokumente einer Quell-App ab.** Sonst holte der
  naechste Stand aus der Quelle sie stillschweigend zurueck.
- **Zusaetzliches Tool `search.status` im Wiki**, damit ein Agent sieht, ob
  die Lieferung haengt und warum, ohne in die Datenbank zu schauen.

## Alternativen

- **Die App ruft die Ziel-App direkt, mit deren Secret:** Jede App kennte
  die Secrets ihrer Ziele und koennte dort jeden Nutzer signieren. Verworfen.
- **App-Aufruf ueber den Plattform-MCP mit einem Agent-Token je App:** Ein
  zweites Subjekt fuer dieselbe App und ein gespeichertes Token. Verworfen.
- **`OPENAPPS_AUTH_SECRET` auch fuer ausgehende Aufrufe:** Spart eine
  Variable, vermischt aber zwei Richtungen in einem Schluessel. Verworfen.
- **Lesbare Apps aus der Navigation ablesen:** Die Navigation ist Anzeige,
  wird gekuerzt und filtert Apps ohne Domain. Ein Rechtefilter darf daran
  nicht haengen. Verworfen.
- **Knowledge fragt die Control Plane, was der Aufrufer lesen darf:** Das
  waere Rechte-Code in der App und ein zusaetzlicher Aufruf je Suche.
  Verworfen.
- **Suche ueber alle Apps per Fan-out** (Knowledge ruft `pages.search` usw.):
  Keine gemeinsame Rangfolge, keine Embeddings, jede Suche so langsam wie die
  langsamste App. Verworfen.
- **Synchrone Lieferung beim Speichern:** Waere Knowledge weg, scheiterte das
  Speichern im Wiki. Verworfen zugunsten der Outbox.
