# ADR 0005: Ein Vokabular für Subjekte — `human`, nicht `user`

Stand 2026-11-09 · angenommen, Umsetzung offen

## Kontext

`CLAUDE.md` sagt: ein Rechtemodell, zentral in der Control Plane. Beim
parallelen Bauen sind zwei Wörter für dieselbe Sache entstanden:

- `packages/app-manifest` nennt den Menschen `human` (`subjectKindSchema`).
- Migration `0003_grants.sql` nennt ihn `user` (`grant_subject_kind`).

Übersetzt wird derzeit an einer Stelle, `src/domain/manifest-grants.ts`. Das
funktioniert, aber zwei Vokabulare für ein Modell halten nicht lange: Das
dritte Stück Code übersetzt an einer zweiten Stelle, und dann ist es nicht mehr
ein Rechtemodell, sondern zwei mit einer Brücke.

## Entscheidung

`human` gewinnt, in Datenbank, Domäne, Manifest und MCP. Eine neue Migration
führt `ALTER TYPE grant_subject_kind RENAME VALUE 'user' TO 'human'` aus; die
Übersetzungsschicht in `manifest-grants.ts` entfällt.

`human` statt `user`, weil `user` in einer Datenbank doppelt belegt ist — er
heißt dort auch „Datenbankrolle" — und weil das Modell neben Menschen auch
Gruppen, Apps und Agents kennt. `human` sagt, was gemeint ist, und kollidiert
mit nichts.

## Folgen

- Eine neue Migration, keine geänderte: Migration `0003` bleibt, wie sie ist.
- Die Übersetzung verschwindet statt zu wachsen.
- Bis die Migration läuft, gilt weiter die Übersetzung an der einen Stelle. Das
  ist der Zustand, nicht das Ziel — darum steht diese Entscheidung hier,
  bevor das dritte Stück Code sie umgeht.

## Alternativen

- **`user` gewinnt.** Verworfen: Das Manifest ist das Format, das später
  Fremde schreiben (Katalog, Community-Apps). Ein öffentliches Format
  umzubenennen kostet mehr als eine interne Spalte.
- **Die Übersetzung bleibt.** Verworfen: Sie ist genau die Stelle, an der ein
  Rechtemodell zu zwei wird. Eine Brücke zwischen zwei Vokabularen ist billiger
  zu bauen als zu behalten.
