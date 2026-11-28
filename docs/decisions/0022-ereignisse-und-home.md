# ADR 0022: Ereignisse, Benachrichtigungen und Home

Stand: 27.11.2026 · angenommen (Nutzerentscheidung vom 27.11.2026)

## Kontext

Was in einer App passiert, erfaehrt man nur in dieser App. Wer wissen will,
ob ihm eine Aufgabe zugewiesen, ein Deal gewonnen oder eine Seite geaendert
wurde, oeffnet jede App einzeln. Ein Agent kann nicht fragen, was fuer ihn
neu ist. Und keine App kann auf etwas reagieren, das in einer anderen App
geschieht; „aus einer Mail wird eine Aufgabe“ hat keinen Ausloeser.

Die Plattform weiss als einzige, wer welche App lesen darf (CLAUDE.md 3 und
4). Seit ADR 0020 gibt es einen signierten Weg von App zu Plattform
(`OPENAPPS_CALL_SECRET`, Ziel ueber die Control Plane) und das Muster der
Outbox im Wiki. Beides wird hier wiederverwendet.

**Einordnung:** Kein DoD-Kriterium braucht Ereignisse; nach dem Brief
(„v1 enthaelt nur, was die Kriterien brauchen“) waere das ein Nicht-Ziel fuer
v1. **Nutzerentscheidung vom 27.11.2026: Es wird jetzt gebaut**, vor den
uebrigen Schritten des Zielbilds. Das ist eine benannte Aenderung am
Umfang, nicht an den sieben Kriterien: Sie gelten unveraendert, ihre
Nachweise (vor allem DoD 2 auf der Zielinstanz) stehen weiter aus, und die
Timebox von 6 bis 8 Wochen aus dem Brief deckt diese Arbeit nicht ab.

## Entscheidung

### A. Plattform-Tools fuer Apps ueber den Weg aus ADR 0020

- Apps rufen Plattform-Funktionen wie ein App-Tool, mit dem reservierten
  Ziel `platform`: `callAppTool('platform', '<tool>', args)`. Signatur,
  Fenster, Audit und Fehlercodes sind die aus ADR 0020 A.
- Default-Deny bleibt: Jedes dieser Tools braucht `execute` auf
  `platform.<tool>`, beantragt in `requestedGrants`, auch die Tools, die nur
  eigene Daten des Aufrufers betreffen (`emit_event`, `set_refs`). Der lokale
  Aufbau (`lokal-einrichten.ts`) erteilt solche Antraege einer App fuer sich
  selbst automatisch, wie in ADR 0020; sonst erteilt sie ein Mensch. Die Namen `platform`,
  `human`, `group`, `agent` und `app` werden als App-Namen gesperrt (neue
  Regel in `naming.ts`, betrifft nur neue Apps).

### B. Ereignisse: Push von der App, mit Outbox

- **Neues optionales Manifest-Feld `events`.** Eine App meldet nur Typen, die
  sie dort erklaert:

  ```json
  "events": [
    { "type": "task.assigned", "description": "A task was assigned to someone.", "importance": "high" },
    { "type": "deal.won", "description": "A deal moved to won.", "importance": "normal" }
  ]
  ```

  `type` ist `<objekttyp>.<vorgang>`, eindeutig je App; der volle Name ist
  `<app>.<type>`. `importance` ist `high`, `normal` oder `low`.
- **Ein Ereignis** hat: `id` (von der App vergeben, eindeutig je App, dient
  als Schluessel gegen Doppel), `type`, `object` (Verweis nach ADR 0023,
  bis dahin ein freier Schluessel), `title` (Klartext, kurz), `path` (Link
  zurueck in die App), `actor` (wer es ausgeloest hat, eine Angabe der App,
  nur Anzeige), `audience` (Liste aus `human:<email>`, `group:<name>`,
  `agent:<name>`, begrenzt) und `occurredAt`. **Kein Inhalt** ausser dem
  Titel: Der Inhalt bleibt in der App, Home verlinkt dorthin.
- **SDK:** `emitEvent(event)` schreibt in eine Outbox in derselben
  Transaktion wie die Aenderung und liefert nach dem Commit an das
  Plattform-Tool `emit_event`, Wiederholung wie im Wiki (ADR 0020 D).
  Die Outbox aus dem Wiki wird dafuer ins SDK gehoben (`createOutbox`),
  weil sie jetzt den zweiten Nutzer hat (Muster aus ADR 0019).
- **Die Control Plane nimmt an**, wenn Signatur und Freigabe stimmen und der
  Typ im Manifest der laufenden Version steht. Ein Doppel (`id` schon
  bekannt) ergibt `duplicate`, keinen Fehler. Ein nicht erklaerter Typ ist
  400 mit Audit-Eintrag. Angenommene Ereignisse stehen in der Tabelle
  `events`, nicht im Audit-Log; die Tabelle ist selbst das Protokoll.

### C. Benachrichtigungen: abgeleitet, zweimal geprueft

- Beim Annehmen leitet die Control Plane je Empfaenger eine Zeile in
  `notifications` ab: Gruppen werden zu ihren Mitgliedern **zu diesem
  Zeitpunkt** aufgeloest, der Ausloeser selbst bekommt keine.
- **Erste Pruefung beim Ableiten:** nur Subjekte mit `read` auf
  `app:<quelle>`. Wer nicht lesen darf, bekommt keine Zeile; die App erfaehrt
  nicht, wer herausfiel.
- **Zweite Pruefung beim Lesen:** `list_inbox` prueft `read` erneut. Ein
  Widerruf wirkt sofort, die Zeile ist ausgeblendet, nicht geloescht.
- **Zustand je Zeile:** `unread`, `read`, `done`. Reihenfolge ohne Modell:
  zuerst direkt adressiert vor ueber Gruppe, dann `importance`, dann Zeit.
- **Erwaehnungen** erzeugt die Plattform selbst aus den Verweisen (ADR 0023),
  Typ `platform.mentioned`. Die App meldet dafuer kein eigenes Ereignis.
- Auch Agents haben einen Eingang. Eine Erwaehnung eines Agenten ist der
  Ausloeser fuer einen Lauf (ADR 0024).

### D. Home ist eine Seite der Control Plane

- Home liegt unter `/home` auf dem Host der Control Plane, mit einem Eintrag
  oben in der `PlatformShell`. Daten und Logik (Ableitung, Rechte, Zustand)
  liegen ohnehin in der Control Plane; eine eigene App waere nur ein
  weiterer Client derselben API, mit eigenem Deploy, Schema und Review, aber
  ohne eigene Daten.
- Aus jeder App erreichbar wie die Suche aus ADR 0021: im Browser unter
  `/_platform/inbox` auf dem gemeinsamen Host, Person aus der Session. Ein
  Zaehler ungelesener Eintraege in der Leiste kommt spaeter, nicht in diesem
  Schnitt.
- **Keine Benachrichtigungen nach aussen** (Mail, Push) vorerst. Der Eingang
  ist der einzige Kanal.
- **Erst Tool, dann Seite** (CLAUDE.md 1): `GET /api/inbox` und
  `POST /api/inbox/mark` mit den MCP-Tools `list_inbox` und `mark_inbox`.
  Plattform-Tools heissen in snake_case wie `list_apps`, Namen mit Punkt
  gehoeren den Apps. Beide Tools wirken nur auf den Eingang des Aufrufers.
- Die Seite: Liste mit Tastatur-Triage (naechster, vorheriger, oeffnen,
  gelesen, erledigt, Filter nach App), leerem Zustand und Fehlerzustand,
  nur Bausteine aus `packages/ui`.
- Die KI-Zusammenfassung kommt spaeter ueber ADR 0024 und ist ohne
  Modell-Konfiguration nicht sichtbar.

### E. Apps abonnieren Ereignisse anderer Apps: Pull mit Cursor

- Neues optionales Manifest-Feld `subscriptions`:
  `[{ "app": "mail", "type": "message.received" }]`.
- Recht: Das abonnierende Subjekt `app:<name>` braucht `read` auf
  `app:<quelle>`, beantragt in `requestedGrants`, geprueft bei jedem Abruf.
- Abruf ueber die Plattform-Tools `poll_events` (ab Cursor) und
  `ack_events`. Der Cursor liegt in der Control Plane je Abonnement.
  Zustellung mindestens einmal; der Handler muss mit der Ereignis-`id`
  idempotent sein. Das SDK liefert `subscribe(types, handler)` mit derselben
  Schleife wie die Outbox.
- Ein Abonnent sieht alle Ereignisse des Typs, unabhaengig von `audience`,
  weil er die Quell-App ohnehin lesen darf.

### F. Aufbewahrung

- Ereignisse und Benachrichtigungen werden nach einer festen Frist hart
  geloescht (`OPENAPPS_EVENTS_RETENTION_DAYS`, taeglicher Lauf). Default
  90 Tage, per Env aenderbar.
- Das ist kein Audit-Log mit Export und Aufbewahrung; das bleibt im
  Open-Core-Schnitt bezahlt (Brief) und wird hier nicht gebaut.

## Folgen

- Drei neue Tabellen in der Control Plane (`events`, `notifications`,
  `event_cursors`), je eine Migration. Zwei optionale Manifest-Felder, die
  `manifestVersion` bleibt 1. Apps mit aelterem SDK aendern sich nicht.
- **Grenze des Rechtemodells:** Die Plattform kennt `read` nur je App, nicht
  je Objekt. Wer eine App lesen darf und adressiert ist, sieht den Titel. Ob
  eine App Personen adressiert, die das Objekt innerhalb der App nicht sehen
  sollten, ist ihre Adressierung, kein Rechte-Code; das Review-Gate kann es
  nicht pruefen.
- Bei Pull hat ein Abonnent bis zu einem Abrufintervall Verzug.
- Spaetere Gruppenmitglieder sehen keine aelteren Benachrichtigungen.
- Review-Gate: Ein spaeterer Schritt prueft, dass jeder Typ in
  `emitEvent(...)` im Manifest steht (wie „UI-Aktion ohne Tool“).

### Umsetzung: Abweichungen und Festlegungen (Schritte 1 bis 6, 28.11.2026)

- **Empfaenger auch als `user:<id>`.** CRM (`owner`) und Wiki
  (`page_favorites.user_id`) speichern Personen mit der Nutzer-Id aus
  `getUser`, nicht mit der E-Mail. Neben `human:<email>`, `group:<name>` und
  `agent:<name>` nimmt die Plattform deshalb `user:<id>` an und loest es ueber
  die Tabelle von Better Auth zur E-Mail auf; eine unbekannte Id faellt weg.
  `recipientOf` im SDK bildet die Angabe aus dem, was eine App speichert.
- **Eingang je E-Mail bzw. Agent-Name.** Benachrichtigungen eines Menschen
  haengen an seiner E-Mail (wie `group_members`, Migration 0009), damit auch
  Personen ohne bisherige Anmeldung und Gruppenmitglieder adressierbar sind.
  Die erste Pruefung nimmt dafuer die Nutzer-Id (falls vorhanden) und die
  Gruppen der E-Mail. Ein gesperrter Agent bekommt nichts.
- **SDK-Form.** Statt einer freien Funktion `emitEvent(event)` gibt es
  `createEventOutbox({ query }).emit(tx, event)`: Das Einreihen braucht die
  Abfrage der laufenden Transaktion. `createOutbox` ist die aus dem Wiki
  gehobene Schleife; das Wiki benutzt sie seit 0.4.0 fuer `search_outbox`.
- **Freigaben auf `tool:platform.<name>`** vergibt, wer dasselbe Verb auf
  `app:*` hat (Plattform-Administration). Andere Namen als `emit_event`,
  `poll_events` und `ack_events` lassen sich nicht freigeben.
- **Fehlercodes des Ziels `platform`:** falsche Form oder nicht erklaerter
  Typ 400, unbekanntes Plattform-Tool 404, fehlende Ereignis-Ablage 503.
- **Audit.** Wie entschieden steht ein angenommenes Ereignis nicht im
  Audit-Log, jede Ablehnung schon. `list_inbox`, `mark_inbox`, `poll_events`
  und `ack_events` schreiben je Aufruf einen Eintrag (DoD 6); bei einem
  Abonnenten im 30-s-Takt sind das viele Zeilen.
- **Abonnenten sehen `audience` nicht.** Ein Abonnent bekommt Typ, Objekt,
  Titel, Pfad, Ausloeser und Zeit, aber keine Empfaengerliste: keine
  Personendaten an eine andere App, solange kein Fall sie braucht.
- **Quittung.** `ack_events({ upTo })` setzt den Cursor aller Abonnements der
  App, deren Quell-App sie gerade lesen darf, auf mindestens `upTo`; weiter
  als das letzte Ereignis geht nicht. Deshalb ein `subscribe` je App. Ein neues
  Abonnement beginnt beim aeltesten Ereignis, das die Aufbewahrung noch haelt.
- **Grenze je Ereignis:** hoechstens 50 Angaben in `audience` und 1000
  Empfaenger nach dem Aufloesen der Gruppen; das Wiki teilt viele Favoriten
  auf mehrere Ereignisse.
- **`/_platform/inbox`** auf dem Host der Apps nur lesend (`GET`), wie die
  Suche. Markieren nur auf dem Host der Control Plane
  (`POST /api/inbox/mark`), mit Pruefung der `Origin`.
- **Aufbewahrung** gemessen an `received_at` (Uhr der Plattform), nicht an
  `occurredAt` der App. Ein unbrauchbarer Wert in
  `OPENAPPS_EVENTS_RETENTION_DAYS` loescht nichts und steht als ALARM im Log.
- **Erste Quellen**, wie beauftragt etwas breiter als im Schnitt: Tasks
  `task.assigned`, `task.commented`, `task.status_changed`; CRM `deal.won`,
  `deal.lost`, `next_step.assigned` und `next_step.due` (stuendlich, einmal je
  Faelligkeitstag, vermerkt in `next_step_due_notices`); Wiki `page.updated`
  bei Bearbeiten und Zuruecksetzen, nicht bei Verschieben oder Archivieren.
- **Gesperrte Namen** gelten in `createApp`; `assertAppName` bleibt, damit
  eine bestehende App gleichen Namens erreichbar bliebe.

## Alternativen

- **Pull fuer das Annehmen** (die Control Plane fragt jede App nach neuen
  Ereignissen): Jede App braucht ein `events.since`, die Control Plane einen
  Takt und einen Cursor je App und traegt die Last aller Apps. Verworfen.
- **Push an Abonnenten** (die Control Plane ruft ein Tool des Abonnenten):
  Braucht Wiederholung, Backoff und Fehlerablage je Abonnent in der Control
  Plane und einen eingehenden Endpunkt je App. Verworfen fuer jetzt; der
  naechste Schritt, wenn der Verzug stoert.
- **Home als eigene Standard-App:** Machbar ueber `/_platform/inbox`
  (ADR 0021), bringt aber einen Deploy, ein Schema und ein Review fuer eine
  App ohne eigene Daten; Tastatur-Triage und Zusammenfassung liegen ohnehin
  an der API der Control Plane. Verworfen (Nutzerentscheidung).
- **Benachrichtigungen erst beim Lesen berechnen** (ohne `notifications`):
  Gelesen/erledigt braucht ohnehin eine Zeile je Subjekt. Verworfen.
- **Ereignisse mit vollem Inhalt:** Kopiert Daten aus der App in die
  Plattform und vergroessert, was ein Widerruf erreichen muss. Verworfen.
- **Eine eigene Freigabe pro Ereignistyp:** Ein zweites Rechtemodell neben
  `read` auf der App. Verworfen.

## Schnitt

Jeder Schritt ist fuer sich nachweisbar. Reihenfolge: Rechte zuerst.

1. **Annehmen.** Feld `events` im Manifest-Paket (Schema, Validierung,
   JSON-Schema), Ziel `platform` mit `emit_event`, Tabelle `events`,
   gesperrte App-Namen.
   DoD: Test gegen Postgres: erklaertes Ereignis angenommen, Doppel ergibt
   `duplicate`, nicht erklaerter Typ 400 mit Audit, falsche Signatur 401 mit
   Audit, ohne Freigabe 403.
2. **Ableiten und Eingang.** `notifications`, `list_inbox`, `mark_inbox`
   als API und MCP-Tool.
   DoD: Test mit zwei Personen, eine ohne `read` auf der Quelle: nur eine
   bekommt die Zeile; Widerruf: beim naechsten `list_inbox` weg; Gruppe wird
   aufgeloest; Ausloeser bekommt nichts.
3. **SDK und erste Quellen.** `createOutbox` aus dem Wiki ins SDK,
   `emitEvent`; Tasks meldet `task.assigned`, CRM `deal.won`, Wiki
   `page.updated` an die, die die Seite als Favorit haben.
   DoD: lokal (`infra/lokal`): Aufgabe zuweisen, erscheint im `list_inbox`
   der Person; mit gestoppter Control Plane gelingt das Speichern und wird
   spaeter geliefert; Wiki-Tests fuer `search-sync` bleiben gruen.
4. **Home-Seite** mit Tastatur-Triage.
   DoD: E2E-Test: Tastenfolge markiert gelesen und erledigt, leerer und
   Fehlerzustand gerendert, UI-Linter gruen.
5. **Abonnements.** `subscriptions`, `poll_events`, `ack_events`,
   `subscribe` im SDK.
   DoD: Test: ohne `read` auf der Quelle nichts, mit Freigabe alles, ohne
   `ack` erneut zugestellt, nach Widerruf nichts mehr.
6. **Aufbewahrung.** Loeschlauf.
   DoD: Test mit gestellter Uhr: aelter als die Frist weg, juenger bleibt.
7. **Zusammenfassung im Home** (haengt an ADR 0024).
   DoD: ohne Modell-Konfiguration nicht sichtbar und kein Fehler.

## Entscheidungen des Nutzers (27.11.2026)

- **Prioritaet:** jetzt, vor den uebrigen Schritten des Zielbilds
  (`docs/08-zielbild.md`).
- **Home** ist eine Seite der Control Plane; der Zaehler in der Leiste
  kommt spaeter.
- **Aufbewahrung** 90 Tage, per Env aenderbar.
- **Plattform-Tools fuer eigene Daten** (`emit_event`, `set_refs`) brauchen
  eine Freigabe; `lokal-einrichten.ts` erteilt sie wie bei ADR 0020, wenn die
  App sie im Manifest beantragt.
- **Keine Benachrichtigungen nach aussen** vorerst.

## Nachrangig, nicht entschieden

Festgehalten, damit nichts verloren geht. Keiner dieser Punkte ist Teil
dieser Entscheidung.

### 4. Echtzeit-Zusammenarbeit im Wiki (mehrere Cursor)

- Braucht eine dauerhafte Verbindung (WebSocket) durch Traefik und die
  Forward-Auth. Prueft die Forward-Auth eine laengere Verbindung nur beim
  Aufbau, wirkt ein Widerruf erst beim naechsten Aufbau. Reicht das?
- CRDT (etwa Yjs) im Wiki oder ein Dienst der Plattform? Wer speichert den
  Zwischenstand, und wie passt das zur Versionsgeschichte (`pages.history`)?
- Wie bearbeitet ein Agent gleichzeitig mit Menschen, ueber dieselben Tools?

### 5. Anbindungen fremder Dienste (Google, Microsoft: Mail und Kalender)

- Vorgemerkt, nicht entschieden: Google zuerst (Gmail, Kalender, ggf.
  Drive), Microsoft danach.

- Das Zielbild legt fest: Konnektor ist eine gewoehnliche App, die
  OAuth-Tokens liegen in der Control Plane, nie in der App. Offen: wie die
  App ein Token nutzt, ohne es zu sehen (Aufruf ueber die Plattform?).
- OAuth pro Nutzer: Zustimmung, Erneuern, Widerruf, was beim Austritt einer
  Person geschieht. Verschluesselung wie Stufe 2 in ADR 0024?
- Daten kopieren (Postfach in die App) oder nur bei Bedarf lesen? Das
  entscheidet Aufbewahrung und was ein Widerruf erreichen muss.
- Egress je Konnektor im Manifest; Freigabe durch Google fuer sensible
  Scopes (Pruefaufwand, Dauer).

### 6. Dateien (Drive, Sheets)

- Wo liegen Dateien: Postgres, ein Objektspeicher neben Coolify oder nur
  beim fremden Dienst? Ein Objektspeicher waere ein weiterer Dienst im
  Betrieb (Schwelle 2 h pro Woche, Brief).
- Rechte je Datei passen nicht in `read` je App. Braucht es eine neue
  Ressourcenart, oder bleibt es bei der App als Grenze?
- Tabellen (Sheets): eigene App mit Rechenlogik oder Anbindung an Google
  Sheets? Was davon wird als Tool fuer Agents angeboten?
