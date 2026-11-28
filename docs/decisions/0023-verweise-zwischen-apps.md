# ADR 0023: Verweise zwischen Apps

Stand: 27.11.2026 · angenommen (Nutzerentscheidung vom 27.11.2026)

## Kontext

Eine Aufgabe, die zu einer Wiki-Seite gehoert, oder ein Deal, der in einer
Besprechungsnotiz vorkommt, ist heute nur ein kopierter Link. Er zeigt weder
Titel noch Status, die Gegenseite weiss nichts von ihm, und niemand
benachrichtigt die erwaehnte Person. Jede App muesste das selbst bauen und
wuesste dabei nicht, was der Betrachter in der anderen App sehen darf.

Gegeben sind: App-zu-App-Aufrufe und Outbox (ADR 0020), Ereignisse und
Eingang (ADR 0022), die foederierte Suche mit Manifest-Feld `search`,
Endpunkt der Control Plane, MCP-Tool `search` und ⌘K in der Shell
(ADR 0021).

**Einordnung:** Kein DoD-Kriterium braucht Verweise; nach dem Brief
(„v1 enthaelt nur, was die Kriterien brauchen“) waere das ein Nicht-Ziel fuer
v1. **Nutzerentscheidung vom 27.11.2026: Es wird jetzt gebaut**, vor den
uebrigen Schritten des Zielbilds. Das ist eine benannte Aenderung am
Umfang, nicht an den sieben Kriterien: Sie gelten unveraendert, ihre
Nachweise (vor allem DoD 2 auf der Zielinstanz) stehen weiter aus, und die
Timebox von 6 bis 8 Wochen aus dem Brief deckt diese Arbeit nicht ab.

## Entscheidung

### A. Ein Format fuer Objekt-Verweise

- **`<app>:<typ>:<id>`**, etwa `tasks:task:42` oder `wiki:page:9f2c`.
  `app` folgt der Regel fuer App-Namen, `typ` ist ein Slug, `id` besteht
  aus URL-sicheren Zeichen ohne Doppelpunkt. Drei Teile; Subjekte des
  Rechtemodells haben zwei (`human:<email>`, `agent:<name>`), dazu sind die
  Namen `human`, `group`, `agent`, `app`, `platform` als App-Namen gesperrt
  (ADR 0022 A). Damit ist jeder Wert eindeutig das eine oder das andere.
- Parsen und Formatieren liegen in `packages/app-manifest` (geteilt von
  SDK, Control Plane und UI), mit Tests.
- **In gespeichertem Text steht nur der Verweis, nie der Titel**, in der
  Schreibweise `@{app:typ:id}`: `@{tasks:task:42}`, fuer Personen `@{human:anna@example.com}`. Ein Titel
  im Text wuerde jedem Leser der Seite zeigen, was er in der anderen App
  vielleicht nicht sehen darf. `extractRefs(text)` im SDK findet sie.

### B. Aufloesen ueber einen Resolver je App

- **Neues optionales Manifest-Feld `objects`:**

  ```json
  "objects": [
    { "type": "task", "description": "A task with title and status.", "resolver": "tasks.resolve" }
  ]
  ```

  Der Resolver ist ein gewoehnliches Tool der App (in `offeredTools`, Verb
  `read`): Eingabe `{ ids }` (begrenzte Anzahl), Ausgabe je gefundenem Objekt
  `{ id, title, path, status?, updatedAt }`. Fehlende Ids fehlen in der
  Antwort.

- **Die Control Plane loest auf**, nie die App selbst: API und MCP-Tool
  `resolve_refs(refs)`. Je Verweis prueft sie `read` des Betrachters auf
  `app:<app>` und ruft erst dann den Resolver, direkt am Container wie fuer
  Agents (ADR 0011). Ergebnis je Verweis: `resolved`, `restricted` (ohne
  Titel und ohne App-Namen), `not_found` oder `unavailable`.
- Ein Cache in der Control Plane (60 s je Verweis) spart wiederholte
  Aufrufe; die Rechtepruefung laeuft bei jedem Aufruf, auch bei einem Treffer
  im Cache. Ein geaenderter Titel erscheint also spaetestens nach 60 s.

### C. Verweise zentral, in beide Richtungen

- Tabelle `refs` in der Control Plane: Quelle, Ziel, Art (`mention`,
  `link`, `derived`), Quell-App, Stand.
- Apps melden die **vollstaendige Menge** ausgehender Verweise eines Objekts
  ueber das Plattform-Tool `set_refs({ source, targets, updatedAt })`, ueber
  die Outbox aus ADR 0022. Die Quell-App kommt aus der geprueften
  Identitaet, ein aelterer Stand wird ignoriert, leere Menge loescht (wie
  ADR 0020 C).
- `list_backlinks(ref)` (API und MCP) zeigt eingehende Verweise nur, wenn
  der Betrachter beide Apps lesen darf.

### D. Erwaehnungen

- Kommt in `set_refs` ein neues Ziel `human:`, `group:` oder `agent:` hinzu,
  erzeugt die Control Plane `platform.mentioned` im Eingang (ADR 0022), nur
  fuer Subjekte mit `read` auf der Quell-App. Ein Agent startet dadurch
  einen Lauf (ADR 0024).
- `list_people(app, q)` liefert dem Picker die Menschen und Agents mit
  `read` auf dieselbe App, und nur an jemanden, der diese App selbst lesen
  darf. Wer keinen Zugriff hat, erscheint nicht und wird nicht
  benachrichtigt.

### E. „Aus X wird Y“

- **Neues optionales Manifest-Feld `actions`** in der Ziel-App:
  `[{ "name": "task_from_ref", "title": "Create task", "accepts": ["wiki:page", "crm:deal"], "tool": "tasks.create_from_ref" }]`.
  Das Tool nimmt `{ sourceRef, excerpt? }`, legt das Objekt an und meldet
  den Verweis `derived` ueber `set_refs`.
- **Agents** rufen das Tool direkt ueber MCP, mit `execute`-Freigabe.
- **Apps** ohne Menschen (etwa aus einem Abonnement, ADR 0022 E) rufen es
  per `callAppTool` als `app:<name>` mit eigener Freigabe.
- **Menschen:** `list_actions(ref)` liefert die Aktionen, deren Tool der
  Betrachter ausfuehren darf, jeweils mit einer Adresse in der Ziel-App
  (Verweis und kurzer Auszug als Parameter). Die Person bestaetigt dort,
  unter ihrer eigenen Identitaet aus der Forward-Auth. Es gibt keinen Aufruf
  im Namen einer Person von App zu App.

### F. Aufrufe aus der Oberflaeche einer App

Chips, Rueckverweise und Picker laden **im Browser ueber denselben Weg wie
⌘K aus ADR 0021**: auf dem gemeinsamen Host der Apps unter
`/_platform/...`, ueber den Router der Plattform mit Forward-Auth, die
Person allein aus der Session. Neue Pfade: `/_platform/refs/resolve`,
`/_platform/refs/backlinks`, `/_platform/refs/actions`,
`/_platform/people`. Der Server der App ist nicht beteiligt, es gibt keinen
Aufruf im Namen der Person von App zu Plattform.

### G. Bausteine in `packages/ui`

- `RefChip` (Zustaende: laden, aufgeloest, `restricted`, `not_found`,
  Fehler), `MentionPicker` (Objekte aus `search` nach ADR 0021, Personen aus
  `list_people`; leerer und Fehlerzustand), `BacklinksPanel`.
- Die Bausteine bekommen Daten und Ladefunktionen als Props und haengen
  nicht am SDK (Grenze aus ADR 0019).

## Folgen

- Treffer der Suche aus ADR 0021 muessen einen Verweis im Format A tragen.
  Fehlt er dort, ist das der erste Teil von Schritt 5.
- **Grenze wie in ADR 0022:** Rechte gelten je App, nicht je Objekt.
- Jeder neue Pfad unter `/_platform/` laeuft ueber den Router der Plattform
  aus ADR 0021 und damit durch dieselbe Forward-Auth; die Liste der Pfade
  waechst, der Router nicht.
- Fuer Personen-Verweise ist die E-Mail die Id, weil Mitgliedschaften
  ueber die E-Mail laufen (Migration 0009). Wer seine Adresse wechselt,
  verliert alte Erwaehnungen.
- Drei optionale Manifest-Felder, eine Tabelle, `manifestVersion` bleibt 1.

### Umsetzung: Abweichungen und Festlegungen (Schritte 1 bis 6, 28.11.2026)

- **Format im Manifest-Paket ohne zod**, als eigener Einstieg
  `@openapps/app-manifest/refs`. Das SDK haengt dafuer jetzt an
  `@openapps/app-manifest` und reicht `parseRef`, `extractRefs`,
  `splitRefTokens` usw. weiter; Client-Komponenten der Apps nehmen das
  Format direkt aus dem Manifest-Paket, weil das SDK den Datenbanktreiber
  mitbringt. Der Praefix `platform.` ist fuer Ereignistypen gesperrt
  (Manifest und `emit_event`), damit keine App eine Erwaehnung faelscht.
- **Freigabe `tool:platform.set_refs`** vergibt wie bei ADR 0022, wer
  `execute` auf `app:*` hat; `set_refs` steht dafuer in der Liste der
  Plattform-Tools fuer Apps. `lokal-einrichten.ts` erteilt sie einer App, die
  sie fuer sich beantragt (Wiki, Tasks, CRM tun das).
- **Resolver-Eingabe `{ type, ids }`** statt `{ ids }`: Eine App loest
  mehrere Arten mit einem Tool auf (`tasks.resolve` fuer `task` und
  `project`). Hoechstens 50 Ids je Aufruf, 100 Verweise je `resolve_refs`.
- **Agents brauchen `read` auf die App und `execute` auf den Resolver**, wie
  bei der Suche (ADR 0021); Menschen nur `read`. Sonst kaeme ein Agent ueber
  die Plattform an ein Tool, das ihm niemand freigegeben hat.
- **`restricted` auch fuer eine App, die es nicht gibt**, damit am Ergebnis
  niemand erkennt, welche Apps es gibt. Ein Verweis, der nicht ins Format
  passt, oder eine Art ohne Resolver ist `not_found`. Das Ergebnis traegt
  bei `restricted` nur den Verweis, den der Aufrufer selbst geschickt hat.
  Personen-Verweise loesen ohne Nachschlagen auf: Titel ist, was im Verweis
  steht (E-Mail, Gruppen- oder Agent-Name).
- **Cache je Prozess** (Control Plane und Plattform-MCP getrennt), 60 s,
  hoechstens 5000 Eintraege; er haelt auch „gibt es nicht“, nie einen
  Fehler und nie eine Rechteentscheidung. Ohne Cache (Tests, `cache`
  fehlt) fragt jeder Aufruf die App.
- **Zwei Tabellen in einer Migration** (0020): `ref_sources` haelt den Stand
  je Quelle auch bei leerer Menge, `refs` die Ziele. Mit einer Tabelle
  braechte eine verspaetete aeltere Meldung nach dem Loeschen die alten
  Verweise zurueck. Gleicher Stand gilt als neu (die Outbox liefert
  mindestens einmal), nur ein aelterer ist `stale`.
- **`set_refs` traegt optional `title`, `path` und `actor`** der Quelle. Sie
  werden nicht gespeichert, nur fuer die Erwaehnung im Eingang gebraucht
  („Mentioned in <Titel>“, Link, Ausloeser bekommt nichts). Die Quelle muss
  eine Art aus `objects` der meldenden App sein. Subjekte sind immer
  `mention`, Objekte `link` (Default) oder `derived`; `derived` gewinnt.
  Angenommene Meldungen stehen wie bei `emit_event` nicht im Audit-Log,
  Ablehnungen schon; `resolve_refs`, `list_backlinks`, `list_people` und
  `list_actions` schreiben je Aufruf einen Eintrag, ohne die Verweise.
- **Erwaehnung** ist ein Ereignis `platform.mentioned` **der Quell-App**
  (sonst haette der Eingang keine App, deren `read` er pruefen kann),
  Wichtigkeit `high`, Id aus Quelle, Stand und neuen Zielen. Fehlt die
  Ereignis-Ablage, entsteht keine Erwaehnung; die Verweise stehen trotzdem.
  Ein erwaehnter Agent bekommt den Eintrag, einen Lauf startet noch nichts
  (ADR 0024 ist nicht gebaut).
- **`list_people`** liest die offenen `read`-Freigaben auf die App (Id, Name
  und `app:*`): Personen direkt, Mitglieder von Gruppen (hoechstens 1000 je
  Gruppe), nicht gesperrte Agents; hoechstens 20. Wer die App nicht lesen
  darf oder eine unbekannte App nennt, bekommt eine leere Liste statt 403.
- **`list_actions`**: Menschen brauchen `read` auf Quell- und Ziel-App, die
  Aktion braucht das neue optionale Feld `path`; die Adresse ist
  `<App>/<path>?ref=…&excerpt=…` (Auszug hoechstens 500 Zeichen). Agents
  brauchen nur `execute` auf das Tool und bekommen keine Adresse.
  `list_backlinks` gibt es nur fuer Objekte.
- **Suche:** Treffer tragen `ref`, wenn ihr `kind` eine Art aus `objects`
  ist; so fuegt der Picker Objekte aus der Suche ein, ohne dass eine App ihr
  Such-Tool aendert.
- **Bausteine:** neben `RefChip`, `MentionPicker` und `BacklinksPanel` auch
  `RefText` (Text mit Chips) und `RefActionsMenu` (Knopf fuer Aktionen),
  dazu die Ladefunktionen (`createRefResolver` buendelt alle Chips einer
  Seite in eine Anfrage).
- **Lokal:** Der Ansehen-Proxy (8090) beantwortet die vier neuen Pfade
  selbst, als der Betrachter, der alle Apps sieht, mit denselben Funktionen
  (`resolveInApp`, `filterBacklinks`, `actionsAccepting`, `peopleWithRead`).
- **Erste Anwender:** Das Wiki meldet `@{…}` aus dem Inhalt ausserhalb von
  Code (Seitenlinks bleiben in `page_links`), eine archivierte Seite die
  leere Menge; „Create task from section“ je Ueberschrift. Tasks speichert
  die Quelle in `tasks.source_ref` und meldet sie als `derived`, dazu `@{…}`
  aus Beschreibung und Kommentaren; `tasks.create_from_ref` nimmt
  `wiki:page` und `crm:deal`. Das CRM meldet Verweise aus Notizen und
  naechsten Schritten; dafuer sind auch `activity` und `next-step`
  Objektarten. Knowledge bleibt unveraendert.

## Alternativen

- **URLs als Verweis:** Haengen an Domain und Pfad (ADR 0007), brechen beim
  Verschieben und lassen sich ohne Aufloesen nicht pruefen. Verworfen.
- **Titel im gespeicherten Text:** Gibt Lesern der Quelle Titel aus Apps,
  die sie nicht lesen duerfen, und veraltet. Verworfen.
- **Jede App speichert ihre Rueckverweise selbst:** Keine Gegenrichtung ohne
  Aufrufe in jede App, und jede App braeuchte einen Rechtefilter. Verworfen.
- **Die App loest Verweise anderer Apps selbst auf** (mit `callAppTool`):
  Braucht n mal n Freigaben, und die App saehe Titel, die der Betrachter
  nicht sehen darf. Verworfen.
- **„Aus X wird Y“ als Aufruf von App zu App im Namen der Person:** Braucht
  schreibende Delegation. Der Link in die Ziel-App erreicht dasselbe mit der
  bestehenden Forward-Auth. Verworfen.
- **Der Server der App laedt Chips im Namen des Betrachters** (die App
  reicht die signierten Identitaets-Header an die Control Plane weiter):
  Gaebe jeder App ein Zeitfenster, in dem sie als die Person liest. Der Weg
  aus ADR 0021 ueber `/_platform/` kommt ohne das aus. Verworfen.

## Schnitt

1. **Format.** Parsen und Formatieren in `packages/app-manifest`,
   `extractRefs` im SDK, gesperrte App-Namen.
   DoD: Tests: gueltige und ungueltige Verweise, Subjekt und Objekt
   unterscheidbar, App namens `human` wird abgelehnt.
2. **Aufloesen.** Feld `objects`, Resolver-Vertrag, `resolve_refs` als API
   und MCP-Tool, Cache; Tasks und Wiki bieten Resolver an.
   DoD: Test mit zwei Betrachtern: mit `read` `resolved`, ohne `restricted`
   ohne Titel; Widerruf wirkt beim naechsten Aufruf trotz Cache; Resolver
   aus ergibt `unavailable`.
3. **Rueckverweise.** `refs`, `set_refs`, `list_backlinks`; Wiki meldet
   Verweise aus Seiten ueber die Outbox.
   DoD: Wiki-Seite verweist auf Aufgabe, Aufgabe zeigt den Rueckverweis;
   Betrachter ohne `read` auf dem Wiki sieht ihn nicht; aelterer Stand
   ueberschreibt nichts.
4. **Erwaehnungen** (braucht ADR 0022 Schritt 2).
   DoD: Test: erwaehnte Person mit `read` bekommt `platform.mentioned`, ohne
   `read` nicht; erneutes `set_refs` mit derselben Menge erzeugt nichts.
5. **Oberflaeche.** Pfade unter `/_platform/`, `list_people`,
   `RefChip`, `MentionPicker`, `BacklinksPanel`; das Wiki nutzt sie im
   Editor.
   DoD: Tests der Bausteine fuer alle Zustaende, UI-Linter gruen, E2E:
   Person erwaehnen und Aufgabe verlinken im Wiki.
6. **Aktionen.** Feld `actions`, `list_actions`, `tasks.create_from_ref`,
   Menue im Wiki.
   DoD: Agent legt per MCP eine Aufgabe aus einer Wiki-Seite an, Rueckverweis
   `derived` erscheint; ohne `execute` taucht die Aktion nicht auf; E2E fuer
   den Weg der Person.

## Entscheidungen des Nutzers (27.11.2026)

- **Prioritaet:** jetzt, vor den uebrigen Schritten des Zielbilds.
- **Picker:** Menschen und Agents mit Lesezugriff auf dieselbe App.
- **Schreibweise im Text:** `@{app:typ:id}`.
- **Cache** aufgeloester Verweise: 60 s.
- **`set_refs`** braucht eine Freigabe; `lokal-einrichten.ts` erteilt sie
  lokal wie bei ADR 0020 (siehe ADR 0022).
