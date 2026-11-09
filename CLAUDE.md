# Arbeiten an diesem Repo

Dies ist der App-Layer neben Coolify. `AGENTS.md` richtet sich an Agents, die
**Apps für** die Plattform bauen; diese Datei gilt für Arbeit **am** Repo selbst.

## Grundsätze

1. **Agents first.** Jede Aktion existiert als API und MCP-Tool, bevor sie einen
   Button bekommt. Ein PR, der einen Button ohne Tool liefert, ist unfertig.
2. **Coolify bleibt unverändert.** Kein Fork, kein Patch. Zugriff nur über die
   dünne Adapter-Schicht in `apps/control-plane/src/adapters/coolify`, damit das
   Backend austauschbar bleibt.
3. **Apps enthalten keinen Auth- und keinen Rechte-Code.** Das Gateway prüft
   jeden Aufruf, die Datenbank-Rolle begrenzt jeden Zugriff.
4. **Ein Rechtemodell.** Wer (Mensch, Gruppe, App, Agent) darf was (lesen,
   schreiben, ausführen) auf welcher Ressource (App, Tabelle/View, Tool).
   Freigaben liegen zentral in der Control Plane, nirgends sonst.
5. **Default-Deny.** Neue Routen, Tools und Tabellen sind gesperrt, bis eine
   Freigabe sie öffnet.
6. **Keine Secrets im Code.** Nur über Env. `gitleaks` blockiert den Rest.

## Konventionen

- TypeScript, strict. Keine `any` ohne Kommentar mit Begründung.
- Datenbank: eine Migration pro Änderung, nie eine bestehende Migration ändern.
- DB-Rollen nie mit `BYPASSRLS` oder `SUPERUSER`.
- UI nur mit Komponenten und Tokens aus `packages/ui`. Keine eigenen Farbwerte,
  keine fremden UI-Bibliotheken.
- Jede Liste hat einen leeren und einen Fehlerzustand.
- Tests: die riskanten Pfade zuerst (Auth, Rechte, Review-Gate), nicht die
  einfachen.

## Vor dem Commit

```bash
pnpm check
```

## Entscheidungen

Architektur-Entscheidungen gehören als kurzes ADR nach `docs/decisions/`, nicht
in einen PR-Kommentar. Format: Kontext, Entscheidung, Folgen, Alternativen.
