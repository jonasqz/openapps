# Nachweis: Agents arbeiten mit Standard-Apps (lokaler Betrieb)

Stand: 24.11.2026, Stapel aus `infra/lokal/`, ADR 0011.

## Aufbau

- Postgres 16, Control Plane mit Plattform-MCP (`OPENAPPS_BACKEND=lokal`),
  Traefik und Deny-Backend.
- Die Apps `wiki`, `crm` und `wissen`.
- `infra/lokal/apps-ausrollen.sh` hat die drei Apps registriert und deployt.
  Jede lief durch das Review-Gate: gitleaks und semgrep echt, Ergebnis `pass`.
  Danach hatte jede App ihr eigenes Schema und ihre eigene Rolle, hat beim
  Start ihre Migrationen eingespielt und war erst ab dann erreichbar.
- Die Agents waren echte Claude-Code-Läufe (`claude -p`). Jeder hatte nur
  sein eigenes Token und nur den Plattform-MCP, ohne Zugriff aufs Dateisystem
  und ohne andere Server.

## Läufe

| Agent        | Auftrag                                                                                                            | Ergebnis                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `betrieb`    | drei Arbeits-Agents anlegen, 30 Freigaben einzeln vergeben                                                         | alle angelegt, 30/30 Freigaben; Tokens nur in Dateien (0600), nie in der Antwort                                                                |
| `vertrieb`   | neuen Lead erfassen (Firma, Kontakt, Deal, Anruf), Rabattregel aus der Wissensbasis als Notiz mit Quelle, Pipeline | alles angelegt; Regel korrekt aus „Leitfaden Angebotserstellung“ (bis 10 % frei, darüber Freigabe, ab 25.000 € immer Freigabe); Pipeline stimmt |
| `assistent`  | Kundenbriefing im Wiki aus CRM und Reisekostenrichtlinie; danach Deal-Stage ändern                                 | Seite angelegt mit Quellen, Fahrtkosten richtig (2 × 180 km × 0,30 € = 108 €); Stage-Wechsel unmöglich, das Tool wird ihm nicht angeboten       |
| `praktikant` | Urlaubsregel lesen; Wiki schreiben und CRM lesen versuchen                                                         | Lesen geht; Schreiben und CRM sind nicht angeboten; ein direkter Aufruf ergibt „Tool not found“; eine Selbstfreigabe wird abgelehnt             |

Im Audit-Log steht jeder Aufruf, auch die abgelehnten, etwa
`praktikant | grant | denied | darf nicht write auf app:wiki`. In den Apps
tragen die Änderungen den Agenten als Urheber
(`created_by = agent:vertrieb`, `agent:assistent`).

Eine Fehlermeldung aus der App kommt beim Agenten an: Der Vertriebs-Agent rief
`wissen.search` zuerst mit `q` statt `query` auf, bekam die 400-Meldung der App
zurück und korrigierte den Aufruf selbst.

## Was die Läufe gefunden haben

Gefunden haben die Läufe sechs Fehler der Plattform. Alle sind behoben, und
für jeden gibt es einen Test (ADR 0011, Abschnitt „Was der erste lokale Lauf
außerdem fand“). Der siebte, ein nicht atomares `createApp`, ist mit
ADR 0012 behoben.

## Nachtrag: wiederholbar und im Browser

- Die Wege der Agents laufen jetzt auch ohne Sprachmodell als Test
  (`pnpm --filter @openapps/platform-mcp test:lokal`, 7 Fälle). Abgedeckt sind:
  Freigabe auf Tools mit Punkt, Tool-Namen, Argumente bis in die App, die
  Meldung der App bei falschen Argumenten, ein nicht angebotenes Tool, eine
  abgelehnte Selbstfreigabe, der Agent als Urheber und die Sperre.
- Die Oberflächen sind über den Ansehen-Proxy (ADR 0013) im neuen Design
  geprüft: CRM-Pipeline, Firmenliste, Wiki-Liste. Eine Wiki-Seite wurde über
  das Formular angelegt, mit `lokal-ansicht` als Urheber.
- Die Beispieldaten kommen nicht mehr aus den Migrationen, sondern aus
  `seeds/`. Das SDK spielt sie nur mit `OPENAPPS_SAMPLE_DATA=1` ein, und das
  setzt nur der lokale Adapter.

## Zweiter Lauf, auf frisch gebautem Stapel

Alle vier Agents sind noch einmal gelaufen, gegen einen aus dem Repo frisch
gebauten Stapel mit Seeds statt Beispieldaten-Migrationen. Die Ergebnisse
decken sich mit dem ersten Lauf:

- 30 von 30 Freigaben.
- Die Rabattregel ist mit Quelle notiert.
- Die Pipeline steht bei 117.500 €, gewichtet 44.750 €.
- Die Fahrtkosten betragen 108 €.
- Der Assistent konnte die Stage nicht ändern.
- Der Praktikant konnte nur lesen.

Neu gefunden:

- **`list_grants` ohne Angabe** sollte laut Beschreibung die eigenen Freigaben
  zeigen. Stattdessen fiel der Aufruf in „alle Freigaben“ und verlangte
  Admin-Rechte, also bekam der Praktikant `permission_denied`. Behoben in MCP
  und REST (`?all=true` für alle). Abgedeckt durch `tests/list-grants.spec.ts`
  und den lokalen E2E-Test, und der echte Agent sieht seine drei Freigaben.
- **Offen:** Ein gesperrter Agent behält seine Freigaben. Das ist harmlos,
  weil sein Token sofort abgelehnt wird, macht die Liste aber unübersichtlich.
- **Offen:** Plattform-Tools wie `grant` oder `create_agent` sieht jeder
  Agent, auch ohne Recht. Abgewiesen werden sie beim Aufruf. App-Tools sieht
  ein Agent dagegen nur mit Freigabe.

Beim Prüfen vor diesem Lauf fiel außerdem ein eigener Fehler auf, gefunden
von den DB-Tests der Apps: Die alten Beispieldaten-Migrationen waren
versehentlich wieder im Repo (behoben in 1ebb6f1).

## Nicht geprüft

- Die Oberfläche der Control Plane. Sie braucht weiter den Google-Login.
- Der Server-Betrieb mit Coolify. Dieser Lauf ersetzt ihn nicht.
