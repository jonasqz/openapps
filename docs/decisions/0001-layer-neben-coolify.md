# ADR 0001: Layer neben Coolify, kein Fork

Stand 2026-11-09 · angenommen

## Kontext

Coolify kann Container deployen, Domains und Traefik-Labels verwalten und bietet
eine REST-API sowie einen nativen MCP-Server. Was fehlt, ist alles oberhalb
davon: ein gemeinsamer Login, ein Rechtemodell über Apps hinweg, ein
Review-Gate vor dem Deploy und Agent-Zugang mit Rechten. Coolify hat kein
Plugin-System, in das sich das einhängen ließe.

## Entscheidung

Der Layer läuft als eigene App **neben** Coolify und steuert es über REST-API
und MCP. Coolify bleibt unverändert (Apache 2.0). Der Zugriff liegt hinter einer
dünnen Adapter-Schicht (`apps/control-plane/src/adapters/coolify`).

## Folgen

- Coolify-Updates treffen uns nicht im Code, aber möglicherweise im Verhalten —
  vor allem bei den Traefik-Labels, über die die Auth läuft. Daher
  Regressionstests vor und nach jedem Update (DoD 2).
- Die Adapter-Schicht ist Pflicht, nicht Zierde: Sie ist der Abbruchpfad, falls
  Coolify nicht trägt.
- Harte Mandantentrennung gibt uns Coolify nicht. Für v1 (ein Team, intern)
  reicht das; für Managed-Hosting nicht — deshalb ist Managed ein Nicht-Ziel.

## Alternativen

- **Coolify forken und ein Plugin-System einbauen.** Verworfen: wir tragen dann
  die Pflege eines Deploy-Systems mit, die Updates werden zur Daueraufgabe, und
  der Nutzen liegt gar nicht dort.
- **Eigenes Deploy-System bauen.** Verworfen: Monate Arbeit für ein gelöstes
  Problem.
- **Nur Skripte, keine Control Plane.** Verworfen: Das Rechtemodell und das
  Review-Gate brauchen einen Zustand und eine Instanz, die Freigaben
  durchsetzt.
