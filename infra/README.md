# Infrastruktur

Was hier liegt, betreibt die Plattform — es ist kein Teil des Produkts.

| Pfad | Was |
| --- | --- |
| `scripts/check-auth.sh` | Nachweis für DoD 2: keine App-Domain ohne Session erreichbar, vor und nach jedem Coolify-Update |
| `domains.txt.example` | Vorlage für die Domainliste, die das Skript prüft |
| `traefik/` | Forward-Auth-Konfiguration und Labels (Woche 1, nach `docs/specs/woche-1-forward-auth.md`) |

## Die größte Annahme

Die Auth läuft über Traefik-Labels, die Coolify verwaltet. Ein Coolify-Update
kann sie ändern oder entfernen — dann sind Apps ungeschützt erreichbar. Deshalb:

```bash
infra/scripts/check-auth.sh infra/domains.txt   # vor dem Update
# Coolify aktualisieren
infra/scripts/check-auth.sh infra/domains.txt   # danach, gleiche Liste
```

Ein Lauf ohne Fehlschlag ist der Nachweis. Ein Dienst, der nicht antwortet,
zählt als Fehlschlag — nicht als geschützt.
