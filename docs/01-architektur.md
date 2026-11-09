# Architektur und Rechtemodell

Die Control Plane ist die einzige eigene App. Coolify, Traefik und Postgres
bleiben Standard-Bausteine, die sie steuert.

```
   Mensch ──┐                             ┌──────────────────────────────┐
   Agent  ──┴──► Traefik ──forward-auth──►│        Control Plane         │
                   │                      │   Next.js + Better Auth      │
                   │  eine Domain,        │   Rechtemodell, Katalog      │
                   │  ein Pfad je App     │   Review-Gate, Audit-Log     │
                   │                      └───┬──────────┬───────┬───────┘
                   │   openapps.yaml ◄────────┘          │       │
                   │   Router + Auth je Pfad             │       │
                   │   (ADR 0008)         Coolify REST/MCP       SQL (Owner-Rolle)
                   │                                     ▼       ▼
                   ├──► Deny-Backend: 403 auf     ┌──────────┐ ┌───────────────────┐
                   │    jeden Pfad ohne App       │ Coolify  │ │ Shared Postgres   │
                   │                              │ deployt  │ │ schema pro App    │
                   │                              └────┬─────┘ │ rolle pro App     │
                   │                                   ▼       └───────────────────┘
                   │                             ┌──────────┐        ▲
                   └────────────────────────────►│   Apps   │────────┘
                        X-Auth-* signiert        │ (Next.js)│  nur eigenes Schema
                                                 └──────────┘
```

Apps enthalten keinen Login- und keinen Rechte-Code: Das Gateway prüft jeden
Aufruf, die Datenbank-Rolle begrenzt jeden Zugriff.

Alle Apps liegen unter **einer** Domain, getrennt durch ihren Pfad
([ADR 0007](decisions/0007-eine-domain-pfade-statt-subdomains.md)) — keine
Subdomain je App. Die Router dafür stehen in einer dynamischen Datei, die die
Control Plane selbst schreibt
([ADR 0008](decisions/0008-eigene-dynamische-konfiguration.md)); Coolifys
statische Traefik-Konfiguration bleibt unangetastet. Damit gibt es keine Stelle
mehr, die die Forward-Auth global erzwingt: Sie hängt an jedem einzelnen
Router, den der Generator ausgibt, und dort am Typ — ein Router ohne die zwei
Middlewares kann nicht entstehen
(`apps/control-plane/src/domain/gateway-config.ts`).

**Was die geteilte Domain kostet, und es ist kein kleiner Posten:** Ein Cookie
gilt für alle Apps. Prozess- und Datenbanktrennung bleiben, die Trennung im
Browser fällt weg (ADR 0007).

## Ein Rechtemodell für alle

Wer (Mensch, Gruppe, App, Agent) darf was (lesen, schreiben, ausführen) auf
welcher Ressource (App, Tabelle/View, Tool). Freigaben liegen zentral in der
Control Plane. In v1 genutzt für:

| Richtung | Beispiel | Durchgesetzt von |
| --- | --- | --- |
| Mensch → App | Gruppe „Team“ darf Projektliste unter `/projektliste` öffnen | Forward-Auth an jedem Router unserer dynamischen Konfiguration, pro Aufruf gegen die Control Plane |
| App → App | CRM liest `projects.v_active` | Postgres-Grant auf View, gesetzt von der Control Plane |
| Agent → Tool | Agent darf `projects.list` aufrufen, nicht `projects.delete` | Plattform-MCP prüft vor jedem Aufruf, protokolliert jeden |

Default-Deny überall: Was nicht freigegeben ist, ist gesperrt. Widerruf wirkt
sofort — bei Postgres durch `REVOKE`, beim MCP durch Prüfung pro Aufruf (kein
Cache über die Freigabe).

## Ablauf: Mitarbeiter baut App bis live

1. In Claude Code prüft `list_apps`, ob es die App schon gibt.
2. `create_app` legt ein Repo aus dem Starter-Template an.
3. Er baut lokal und pusht.
4. `request_deploy` startet Scanner und Claude-Review.
5. Bei Freigabe legt die Control Plane Schema, Rolle und Env an, schreibt den
   Router samt Forward-Auth in ihre dynamische Konfiguration und deployt über
   Coolify — die App **ohne** eigene Domain, damit Coolify ihr keinen Router
   ohne unsere Middlewares gibt.
6. Er vergibt Freigaben an Gruppen, andere Apps und Agents; die MCP-Tools der
   App werden aktiv.
7. Jede neue Version läuft durch dieselbe Pipeline, Rollback per Befehl.

## Agents first

Jede Funktion einer App gibt es zuerst als API und MCP-Tool, die Oberfläche
kommt danach und nutzt dieselbe API.

- Was ein Mensch in der UI kann, kann ein Agent über MCP, mit denselben Rechten
  aus demselben Rechtemodell.
- Das Starter-Template beginnt mit OpenAPI-Spec und Tools, nicht mit Screens.
- Die Control Plane selbst folgt derselben Regel: Jede Aktion (anlegen,
  deployen, freigeben, zurücksetzen) ist ein Tool im Plattform-MCP, bevor sie
  einen Button bekommt.
- **Prüfung:** Ein Test vergleicht pro App die UI-Aktionen mit den MCP-Tools.
  Fehlt ein Tool, blockiert das Review-Gate.

## Adapter-Schicht zu Coolify

Coolify wird nur über `apps/control-plane/src/adapters/coolify` angesprochen.
Die Schnittstelle kennt: App anlegen (ohne Domain, mit Netz-Alias und Port),
Env setzen, deployen, Status, Rollback — und Zurücklesen, was das Backend der
App selbst gegeben hat. Das Letzte ist eine **Negativ**-Messung: Labels mit
`traefik.*`, veröffentlichte Host-Ports oder eine Domain wären ein Weg an
unserer Konfiguration und damit an der Forward-Auth vorbei. Kein Coolify-Begriff
sickert darüber hinaus, damit das Backend austauschbar bleibt (Abbruchpfad,
falls Coolify nicht trägt).
