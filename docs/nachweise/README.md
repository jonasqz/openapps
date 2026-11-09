# Nachweis-Mappe

Hier liegt pro DoD-Kriterium der Beleg, dass es erfüllt ist. Die Kriterien
stehen in [`../03-dod.md`](../03-dod.md), die Schwellen in
[`../00-brief.md`](../00-brief.md).

## Die Regel

„Hat funktioniert“ zählt nicht. Ein Nachweis ist entweder ein automatisierter
Test, der im Repo liegt und wiederholbar läuft, oder ein Protokoll mit Datum,
Person, Umgebung, Schritten und Messwerten.

Nicht als Nachweis akzeptiert:

- eine Einschätzung („läuft stabil“, „ging schnell“)
- ein Screenshot ohne Datum und Umgebung
- ein Testlauf, dessen Schritte niemand wiederholen kann
- ein grüner Test, der etwas anderes prüft als das Kriterium

## Zwei Arten von Nachweis

**Protokoll** (Kriterien 1, 5, 7): Ein Mensch führt den Durchlauf aus und füllt
die Vorlage aus. Gemessene Zeit mit Stoppuhr, nicht geschätzt. Abweichungen
werden eingetragen, auch wenn das Ergebnis grün ist.

**Test im Code** (Kriterien 2, 3, 4, 6): Der Nachweis ist ein Testlauf. Die
Datei hier sagt, welcher Test es ist, was er beweist und was er **nicht**
beweist. Das letzte Feld ist das wichtige: Ein Test gegen die Domänenlogik
belegt keine Infrastruktur.

## Wie ein Nachweis geführt wird

1. Vorlage kopieren, Datum und Umgebung eintragen, bevor der Lauf beginnt.
2. Lauf durchführen, ohne zwischendurch zu reparieren. Reparaturen sind ein
   Ergebnis, kein Umweg.
3. Messwerte eintragen. Bei Zeiten: Start und Ende, nicht nur die Differenz.
4. Abweichungen eintragen, auch kleine. Wer nichts einträgt, hat nichts
   beobachtet.
5. Ergebnis setzen: `erfüllt`, `nicht erfüllt` oder `teilweise`. `teilweise`
   ist nicht `erfüllt`.
6. Stand in [`../03-dod.md`](../03-dod.md) nachziehen.

## Wiederholung

- Kriterium 2 wird nach **jedem** Coolify-Update neu geführt. Ein alter grüner
  Lauf gilt nicht für eine neue Coolify-Version.
- Kriterien 1, 5 und 7 werden am Ende von v1 einmal frisch geführt, auch wenn
  sie früher schon grün waren.
- Tests im Code laufen in CI. Ein roter Test setzt den Stand zurück auf
  `offen`.

## Dateien

| # | Datei | Art |
| --- | --- | --- |
| 1 | [`dod-01.md`](dod-01.md) | Protokoll |
| 2 | [`dod-02.md`](dod-02.md) | Test im Code |
| 3 | [`dod-03.md`](dod-03.md) | Test im Code |
| 4 | [`dod-04.md`](dod-04.md) | Test im Code |
| 5 | [`dod-05.md`](dod-05.md) | Protokoll |
| 6 | [`dod-06.md`](dod-06.md) | Test im Code |
| 7 | [`dod-07.md`](dod-07.md) | Protokoll |
