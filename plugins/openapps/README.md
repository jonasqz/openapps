# Plugin `openapps`

Damit baut und ändert dein eigener Claude Code Apps auf der openapps-Plattform.
Das Plugin enthält drei Dinge:

- **die Verbindung zum Plattform-MCP.** Die Adresse kommt aus
  `OPENAPPS_MCP_URL` (Standard ist der lokale Stapel,
  `http://localhost:8080/mcp`), das Token aus `OPENAPPS_TOKEN`.
- **den Skill `app-fuer-die-plattform-bauen`** mit den Regeln der Plattform.
- **drei Befehle:** `/openapps:neue-app`, `/openapps:app-aendern` und
  `/openapps:status`.

## Installieren

In Claude Code:

```text
/plugin marketplace add jonasqz/openapps
/plugin install openapps@openapps
```

## Verbinden

Jeder Assistent braucht einen eigenen Agent-Zugang. Den legst du in der
Verwaltung unter „Agents“ an oder lässt ihn über den MCP anlegen. Das Token
erscheint dabei genau einmal. Es gehört in deine Umgebung, nicht in ein Repo
und nicht in einen Chat.

Lokal liegt das Token von `betrieb` schon in einer Datei:

```bash
export OPENAPPS_TOKEN="$(cat infra/lokal/.agents/betrieb.token)"
```

Auf dem Server kommt dazu die Adresse:

```bash
export OPENAPPS_MCP_URL="https://<control-plane>/mcp"
```

Dann `claude` starten und mit `/openapps:status` prüfen, was dein Zugang darf.

## Was der Assistent darf

Nur das, was sein Agent-Zugang darf. Die Plattform prüft jeden Aufruf und
schreibt ihn ins Audit-Log. Das Plugin gibt keine Rechte, es verbindet nur.
