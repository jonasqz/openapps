# ADR 0011: Agent-Aufrufe direkt an die App, und ein lokaler Betrieb

## Kontext

Beim Aufsetzen der ersten Standard-Apps (Wiki, CRM, Wissen) mit echten Agents
fielen drei Lücken auf, die kein Test gezeigt hatte, weil jeder Test nur eine
Seite prüfte:

1. **Agent-Aufrufe kamen nie an.** Der Plattform-MCP leitete App-Tools an
   `https://<apps-domain>/<app>/api/tools/<tool>` weiter, also durch Traefik.
   Dort hängt an jedem App-Router die Forward-Auth, und die verlangt eine
   Browser-Session. Ein Agent hat keine. Jeder Aufruf wäre mit 302 auf den
   Login geendet.
2. **Den Tool-Endpunkt gab es nicht.** Der MCP ruft `/api/tools/<tool>`, das
   Starter-Template bot nur `/api/items`.
3. **Niemand führte die Migrationen einer App aus.** Die Control Plane legt
   Schema und Rolle an, aber keine Tabelle.

Außerdem gab es keinen Weg, die Plattform ohne Coolify und GitHub als Ganzes
auf einem Rechner laufen zu lassen. Ohne ihn hätten wir die drei Lücken erst
auf dem Server gefunden.

## Entscheidung

1. **Der MCP ruft App-Tools direkt am Container auf**, unter
   `http://<netz-alias>:<port>/<app>/api/tools/<tool>`. Das ist dieselbe
   Adresse, die der Router in `openapps.yaml` als Dienst trägt. Signiert wird
   wie bei der Forward-Auth, mit dem abgeleiteten Secret **dieser** App
   (ADR 0004). Die Prüfung, die die Forward-Auth für Menschen macht, hat der
   MCP für den Agenten schon gemacht: Freigabe `execute` auf `<app>.<tool>`,
   pro Aufruf, protokolliert.
2. **Das SDK liefert den Tool-Endpunkt**: `createToolRoute({ name: handler })`.
   Erst Signatur, dann Tool, dann Body. Ein unbekanntes Tool ergibt 404 erst
   nach der Signatur. Fehler gehen ohne Interna nach außen, und Eingabefehler
   tragen eine Meldung, aus der ein Agent lernen kann.
3. **Das SDK liefert `runMigrations`.** Die App migriert beim Start selbst, mit
   ihrer eigenen Rolle, die Eigentümerin ihres Schemas ist und von nichts sonst.
   Es gibt eine Prüfsumme je Datei: Eine nachträglich geänderte Migration
   bricht den Start ab. Ein Advisory-Lock je Schema sorgt dafür, dass nur ein
   Lauf zur Zeit migriert.
4. **Lokaler Betrieb mit `OPENAPPS_BACKEND=lokal`** (`infra/lokal/`,
   `src/adapters/lokal`).
   - Deploy- und Repo-Backend sind ausgetauscht, die Domäne nicht. Review-Gate,
     Schema, Rolle, Env und Gateway-Konfiguration laufen wie auf dem Server.
   - Die App-Container stehen vorab im Compose und warten, bis die Control Plane
     ihnen beim Deploy Env und Startsignal in ein gemeinsames Verzeichnis legt.
   - Das Inventar des Backends meldet der Adapter als „nicht erreichbar“, nicht
     als „sauber“: Ohne Docker-Socket gibt es nichts zu messen.

## Folgen

- Die Apps müssen im Netz der Plattform für die Control Plane erreichbar sein.
  Auf dem Server ist das ohnehin so (Coolify-Netz), lokal ist es das
  Compose-Netz.
- Die Signatur ist für Agent-Aufrufe jetzt die **einzige** Hürde an der App,
  nicht eine von zweien. Das war für Menschen schon so gedacht (ADR 0004: die
  App vertraut dem Beweis, nicht dem Weg). Wer das App-Secret kennt, kann sich
  als jeder ausgeben. Deshalb steht es nur in der Env der App und wird aus dem
  Master-Secret abgeleitet.
- Ein Agent erscheint in der App als Nutzer `agent:<name>`. Apps sehen so, wer
  was angelegt hat, ohne eigene Agent-Logik.
- Lokal gibt es keinen Login für Menschen ohne eigene Google-Zugangsdaten.
  Agents brauchen keinen.
- Der lokale MCP liegt zusätzlich auf `http://localhost:8080/mcp`, nur auf dem
  Loopback. Das ist kein neuer Weg vorbei an etwas: `/mcp` steht auch auf dem
  Server auf der Allowlist der Forward-Auth, das Token prüft der MCP selbst.

## Was der erste lokale Lauf außerdem fand

Mit drei Apps und echten Agents im lokalen Betrieb zeigten sich weitere
Fehler. Behoben sind:

- **Nur eine App pro Instanz.** `apps.primary_domain` war seit Migration 0001
  `UNIQUE`. Unter ADR 0007 teilen alle Apps diese Domain, also scheiterte schon
  die zweite App. Behoben mit Migration 0016 und einem Postgres-Test mit drei
  Apps.
- **Tools mit Punkt ließen sich nicht freigeben.** `crm.contacts.list` wurde
  als Ressourcen-Id abgewiesen, weil die Prüfung genau einen Punkt verlangte.
  Jetzt wird am ersten Punkt getrennt. Tabellen und Views bleiben ohne Punkt.
- **Tool-Namen im MCP**: `crm.contacts.list` ist für Clients wie Claude kein
  gültiger Name. Im MCP heißen App-Tools deshalb `crm__contacts__list`.
- **Argumente gingen verloren.** Ein leeres Eingabeschema ließ zod alle
  Argumente entfernen. App-Tools nehmen ihre Argumente jetzt im Feld `args`.
- **Host-Prüfung im SDK**: Beim direkten Aufruf fehlte die Domain der App.
  Der MCP setzt jetzt `X-Forwarded-Host`.
- **`list_grants` wurde nicht protokolliert**, auch nicht abgelehnt. Jetzt
  steht es im Audit-Log wie `list_apps`.

Offen war danach noch:

- **`createApp` war nicht atomar.** Scheiterte ein Schritt nach dem Eintrag im
  Register, blieb eine halbe App stehen, zum Beispiel ohne Domain. Sie
  blockierte danach ihren Namen und jeden Deploy (`gateway.missing_domain`).
  Behoben mit [ADR 0012](0012-app-anlegen-register-zuletzt.md).

## Alternativen

- **Agent-Ausnahme in der Forward-Auth** (Bearer statt Session akzeptieren):
  Das wäre ein zweiter Auth-Pfad an der empfindlichsten Stelle, und der MCP
  müsste das Token weiterreichen. Verworfen.
- **Eigener Router ohne Forward-Auth für `/api/tools`**: Das wäre ein Router,
  den der Generator nach ADR 0008 gar nicht erzeugen kann, und das mit Absicht.
  Verworfen.
- **Migrationen durch die Control Plane mit der Owner-Rolle**: Dann bräuchte
  die Control Plane Schreibrechte in jedem App-Schema und müsste App-SQL mit
  erhöhten Rechten ausführen. Verworfen; die App-Rolle reicht und kann nicht
  mehr.
- **Lokaler Betrieb mit echtem Coolify in Docker**: Der Aufwand wäre groß, und
  es bliebe die Abhängigkeit von GitHub. Für den Nachweis der Domäne bringt das
  nichts zusätzlich. Bleibt der Weg für den Server-Test.
