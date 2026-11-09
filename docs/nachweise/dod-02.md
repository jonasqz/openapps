# Nachweis DoD 2: Jede App hinter dem gemeinsamen Login

**Kriterium:** Jede App liegt hinter dem gemeinsamen Login. Ohne Login kommt man
nicht rein, auch nach einem Coolify-Update.

**Art:** Test im Code. Spec: [`../specs/woche-1-forward-auth.md`](../specs/woche-1-forward-auth.md).

## Der Nachweis ist

`infra/scripts/check-auth.sh`, zweimal ausgeführt: vor und nach einem echten
Coolify-Update. Dazu die Schleifen-Messung während des Updates. Die Läufe
liegen als Textdateien in `dod-02-laeufe/`.

Stand: Skript liegt in `infra/scripts/check-auth.sh`, noch kein Lauf gegen
eine echte Instanz.

## Was der Test beweist

- Keine registrierte App-Domain antwortet ohne Session mit 200, auf keinem der
  geprüften Pfade.
- Eine Domain ohne Router bekommt 403 vom Deny-Backend, nicht 404 einer App.
- Mit selbst gesetzten Auth-Headern kommt ein Aufruf nicht durch.
- Ist die Control Plane aus, sperrt das Gateway statt durchzulassen.
- Das Verhalten ist nach einem echten Coolify-Update unverändert, für die
  konkrete Coolify-Version im Protokoll.

## Was der Test nicht beweist

- **Nicht**, dass es für die nächste Coolify-Version gilt. Der Lauf gilt für
  genau die zwei Versionen im Protokoll. Deshalb läuft er nach jedem Update neu.
- **Nicht**, dass die App-Container unerreichbar sind. Das Skript spricht über
  das Gateway. Ein veröffentlichter Port oder ein zweites Docker-Netz bleibt
  unsichtbar. Dafür ist der Label-Lint zuständig (Abschnitt 3.3 der Spec), und
  der ist ein eigener Nachweis.
- **Nicht**, dass die Freigaben stimmen. Der Test prüft „ohne Session kein
  Zugang“, nicht „mit Session nur die erlaubten Apps“. Das gehört zu DoD 3.
- **Nicht**, dass das App-Secret nicht geleakt ist. Die Signatur-Prüfung hält
  nur, solange das Secret geheim bleibt.
- **Nicht**, dass es während des Updates keine Lücke gab, wenn die
  Schleifen-Messung fehlt. Zwei grüne Einzelläufe sagen nichts über die
  Sekunden dazwischen.

## Protokoll der Läufe

| Datum | Coolify vorher | Coolify nachher | Domains | Lücke während Update | Ergebnis |
| --- | --- | --- | --- | --- | --- |
| | | | | | |
