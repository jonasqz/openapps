# Nachweis DoD 3: Schema und DB-Rolle pro App, Freigaben wirken

**Kriterium:** Standard ist eigenes Schema und eigene DB-Rolle pro App. App A
sieht nichts von App B. Nach Freigabe in der Control Plane liest A die
freigegebenen Tabellen/Views von B. Widerruf wirkt sofort.

**Art:** Test im Code.

## Der Nachweis ist

`apps/control-plane/tests/grants.spec.ts`: ein Durchlauf gegen eine echte
Postgres-Instanz, in dieser Reihenfolge — blockiert, Freigabe, lesbar,
Widerruf, wieder blockiert.

Der Test verbindet sich mit der **App-Rolle** von A, nicht mit der
Owner-Rolle. Sonst prüft er sich selbst.

Stand: offen — Test existiert noch nicht.

## Was der Test beweist

- Ohne Freigabe schlägt der Lesezugriff von A auf B in der Datenbank fehl, mit
  einem Postgres-Fehler, nicht mit einem leeren Ergebnis.
- Nach `grant` liest A genau die freigegebene Tabelle oder View.
- Nach `revoke` schlägt derselbe Zugriff wieder fehl, ohne Neustart und ohne
  neues Deploy.
- Die Rollen tragen kein `BYPASSRLS` und sind kein Superuser.
- Das alles gilt, während die Control Plane selbst **ohne** Superuser läuft,
  mit derselben Rolle wie im Betrieb (`CREATEROLE`, sonst nichts). Bis
  Migration 0013 liefen die Tests als Superuser und haben deshalb drei Fehler
  nicht gesehen: Ohne Superuser scheiterte das Anlegen jeder App, jeder zweite
  Deploy, und eine Freigabe zwischen Apps war nur eine WARNING ohne Wirkung.
  Der Test `laeuft selbst ohne Superuser` hält fest, dass es so bleibt.

## Was der Test nicht beweist

- **Nicht**, dass eine App sich nicht eine andere Verbindung beschafft. Der
  Test prüft die Rechte der zugewiesenen Rolle. Eine App, die sich die
  Owner-Zugangsdaten besorgt, umgeht ihn. Das gehört zum Review-Gate (DoD 4)
  und zur Env-Trennung, nicht hierher.
- **Nicht**, dass der Grant-Pfad über den Plattform-MCP korrekt ist, wenn der
  Test direkt auf die Control-Plane-Funktionen geht. Dann fehlt die
  MCP-Schicht.
- **Nicht**, dass Widerruf eine schon offene Transaktion oder einen
  Connection-Pool abschneidet. „Sofort“ heißt im Test: beim nächsten Statement.
  Was mit laufenden Verbindungen passiert, ist eine eigene Prüfung.
- **Nicht**, dass die Domänenlogik der Apps stimmt. Dies ist ein
  Infrastruktur-Test.
- **Nicht**, dass A nicht über die HTTP-API von B liest. Das ist der
  Gateway-Weg und gehört zu DoD 2 und DoD 6.
