# ADR 0017: Eine gemeinsame Leiste für alle Apps

Stand: 25.11.2026

## Kontext

Jede Standard-App baut ihre Navigation selbst (`AppNav` im CRM), ohne
Nutzer, ohne Abmelden und ohne Weg zu den anderen Apps. Nur die Control Plane
nutzt die `AppShell` aus `packages/ui`. Wer von CRM zu Tasks will, tippt die
URL. Wer eine App oder einen Agent anlegen will, muss wissen, dass es die
Verwaltung gibt.

Eine App weiß nicht, welche anderen Apps die Person sehen darf. Das weiß nur
die Control Plane, und Apps enthalten keinen Rechte-Code (CLAUDE.md 3).

## Entscheidung

- **Die Leiste kommt aus `packages/ui` (`PlatformShell`), die Daten kommen
  vom Gateway.** Die Forward-Auth entscheidet ohnehin bei jedem Aufruf über
  die Person. Sie gibt zusätzlich zwei Header mit:

  | Header | Inhalt |
  |---|---|
  | `X-Auth-Nav` | base64url von JSON, siehe unten |
  | `X-Auth-Nav-Signature` | HMAC-SHA256 (Hex) mit dem Secret der App |

  ```json
  {
    "v": 1,
    "platformUrl": "https://admin.example.com",
    "apps": [{ "name": "crm", "title": "CRM", "category": "Sales", "href": "https://apps.example.com/crm" }],
    "canCreateApps": true,
    "isAdmin": false
  }
  ```

  `apps` sind die Apps, die die Person lesen darf: nicht archiviert, mit
  Domain. Signiert wird `openapps-nav-v1`, App-Id, Host, Nutzer-Id,
  Ausstellzeit und der Header-Wert, je durch `\n` getrennt. Der Wert hängt so
  an derselben Entscheidung wie die Identität und ist an diese App gebunden.

- **Die Navigation ist Anzeige, keine Freigabe.** Fehlt der Header oder
  stimmt die Signatur nicht, zeigt die Leiste nur die eigene App. Die App
  antwortet deswegen nie mit einem Fehler. Ob jemand eine App öffnen darf,
  entscheidet weiter die Forward-Auth beim Aufruf dieser App.
- **Beide Header sind immer gesetzt**, notfalls leer, und werden wie die
  Identitäts-Header aus eingehenden Anfragen gelöscht. Sonst könnte ein
  Browser eigene Links in die Leiste schmuggeln.
- **Die App liefert nur ihre eigenen Bereiche.** `getNavigation()` aus
  `@openapps/sdk` liest den Header, die App gibt ihn mit ihren Bereichen an
  `PlatformShell`. Nutzer, App-Liste, „New app“, „New agent“, Settings und
  Abmelden kommen von der Plattform.
- **Aktionen, die die Leiste anbietet, gibt es zuerst als API und Tool**
  (CLAUDE.md 1):
  - „New app“ öffnet einen Dialog, der den Befehl `/openapps:new-app …` für
    den eigenen Assistenten erzeugt. Anlegen selbst bleibt `create_app`.
  - „New agent“ führt zur Agents-Seite der Control Plane (`create_agent`).
  - Settings liegen in der Control Plane unter `/settings`, mit `GET /api/me`
    und dem Tool `whoami` als Gegenstück.

## Folgen

- Die Forward-Auth liest bei jedem Aufruf die Liste der Apps und prüft je App
  die Freigabe. Bei einer Handvoll Apps ist das billig. Wird es teuer, kommt
  ein Cache mit kurzer Laufzeit dazu. Ein Widerruf wirkt beim Öffnen sofort,
  in der Leiste spätestens beim nächsten Aufruf.
- Apps, die mit einem älteren SDK gebaut sind, ignorieren die neuen Header.
  Die Signatur der Identität ändert sich nicht, nichts muss gleichzeitig
  ausgerollt werden.
- Traefik muss die zwei Header in `authResponseHeaders` führen. Die erzeugte
  Konfiguration und ihre Prüfung kennen sie.
- Der lokale Proxy (ADR 0013, 0014) bildet die Header genauso.

## Alternativen

- **Die Leiste holt die Apps im Browser von der Control Plane:** Das braucht
  CORS und ein Cookie, das zwischen zwei Hosts gilt, und lädt nach dem ersten
  Bild. Verworfen.
- **Die App fragt die Control Plane auf dem Server:** Dann bräuchte jede App
  einen Zugang zur Control Plane und müsste für die Person sprechen. Das ist
  Rechte-Code in der App. Verworfen.
- **Die Navigation in die Identitäts-Signatur aufnehmen:** Das änderte das
  Signatur-Format, und alle Apps müssten gleichzeitig neu ausgerollt werden.
  Verworfen zugunsten einer eigenen Signatur.
