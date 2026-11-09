# Lizenz

**Noch offen.** Deshalb liegt bewusst keine `LICENSE`-Datei im Repo: ohne sie
gilt „alle Rechte vorbehalten“, und das ist für die interne Phase richtig.

Zu entscheiden ist sie, wenn die OSS-Frage nach 4 Wochen Betrieb beantwortet
wird. Stand der Überlegung aus dem Brief:

- **AGPL** würde verhindern, dass ein Hoster den Layer einfach als eigenes
  Angebot übernimmt. Das passt zum Open-Core-Schnitt: frei ist, was ein Team zum
  Bauen und Betreiben braucht; bezahlt ist die Governance plus der Betrieb.
- Coolify selbst ist Apache 2.0 und bleibt unverändert. Wir forken es nicht, wir
  steuern es — die Lizenzwahl hier berührt Coolify nicht.
- blyck bleibt kommerziell. Der Layer kann als Verbreitungskanal dienen; die
  bezahlten Agent-Leitplanken können aus blyck kommen.

Fällt die Entscheidung, kommt sie als ADR nach `docs/decisions/` und erst dann
als `LICENSE` ins Repo.
