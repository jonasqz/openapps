# Architektur und Rechtemodell

Die Control Plane ist die einzige eigene App. Coolify, Traefik und Postgres
bleiben Standard-Bausteine, die sie steuert.

```
                        ┌──────────────────────────────┐
   Mensch  ──┐          │        Control Plane         │
   Agent   ──┼──► Traefik ──►  Next.js + Better Auth   │
             │  forward-auth   Rechtemodell, Katalog   │
             │     │           Review-Gate, Audit-Log  │
             │     │          └───────┬──────┬─────────┘
             │     │                  │      │
             │     │        Coolify REST/MCP │ SQL (Owner-Rolle)
             │     │                  ▼      ▼
             │     │           ┌──────────┐ ┌───────────────────┐
             └─────┴──────────►│ Coolify  │ │ Shared Postgres   │
                   App-Domains │ deployt  │ │ schema pro App    │
                               └────┬─────┘ │ rolle pro App     │
                                    ▼       └───────────────────┘
                              ┌──────────┐        ▲
                              │   Apps   │────────┘
                              │ (Next.js)│  nur eigenes Schema
                              └──────────┘
```

Apps enthalten keinen Login- und keinen Rechte-Code: Das Gateway prüft jeden
Aufruf, die Datenbank-Rolle begrenzt jeden Zugriff.

## Ein Rechtemodell für alle

Wer (Mensch, Gruppe, App, Agent) darf was (lesen, schreiben, ausführen) auf
welcher Ressource (App, Tabelle/View, Tool). Freigaben liegen zentral in der
Control Plane. In v1 genutzt für:

| Richtung | Beispiel | Durchgesetzt von |
| --- | --- | --- |
| Mensch → App | Gruppe „Team“ darf Projektliste öffnen | Traefik-Forward-Auth gegen die Control Plane |
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
5. Bei Freigabe legt die Control Plane Schema, Rolle, Env und Auth-Middleware an
   und deployt über Coolify.
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
Die Schnittstelle kennt: Projekt/App anlegen, Env setzen, deployen, Status,
Rollback, Domain und Labels setzen. Kein Coolify-Begriff sickert darüber hinaus,
damit das Backend austauschbar bleibt (Abbruchpfad, falls Coolify nicht trägt).
