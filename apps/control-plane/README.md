# @openapps/control-plane

Die einzige eigene App des Layers. Sie führt das Register der Apps, hält **das
eine** Rechtemodell, betreibt das Review-Gate, schreibt das Audit-Log und
steuert das Deploy-Backend.

## Aufbau

```
migrations/              aufsteigend numeriert, vorwärts, nie geändert
src/domain/              Domänenlogik — ohne HTTP, ohne Anbieternamen
  can.ts                 die eine Rechteprüfung (Default-Deny, kein Cache)
  apps.ts                createApp, listApps
  deployments.ts         requestDeploy, rollback
  grants.ts              grant, revoke
  review-gate/           Pipeline, Schritte, Zusammenführung
src/adapters/coolify/    der einzige Ort, der Coolify kennt
src/infra/pg/            Repositories, Provisioner, Migrations-Läufer
src/infra/memory/        Speicher im Prozess plus Doubles (Tests, Entwicklung)
src/lib/                 Env, Session, Gateway-Signatur, HTTP-Abbildung
src/app/api/             Route-Handler — rufen nur die Domäne
src/app/                 zwei Seiten: Apps und Freigaben
tests/                   die riskanten Pfade (DoD 3 und DoD 4)
```

## Die vier Regeln dieses Pakets

1. **Agents first.** Jede Aktion ist zuerst Domänenfunktion, dann Endpunkt und
   MCP-Tool, zuletzt Button. `src/app/api` enthält keine Logik.
2. **Default-Deny.** `can` gibt `false` zurück, solange keine passende, nicht
   widerrufene Freigabe existiert. Es gibt keinen Zweig ohne Freigabe.
3. **Kein Cache über Freigaben.** Jede Prüfung fragt den Speicher, damit ein
   Widerruf sofort wirkt (DoD 3).
4. **Coolify nur im Adapter.** Außerhalb von `src/adapters/coolify` kommt das
   Wort nicht vor. Trägt Coolify nicht, wird ein Ordner ersetzt.

## Betrieb

```bash
pnpm --filter @openapps/control-plane migrate   # Migrationen vorwärts
pnpm --filter @openapps/control-plane dev       # Entwicklung
pnpm --filter @openapps/control-plane test      # DoD-3- und DoD-4-Tests
```

Variablen stehen in `.env.example`. Secrets kommen nie in den Code.

## Nachweise

- `tests/grants.spec.ts` — DoD 3: blockiert → Freigabe → lesbar → Widerruf →
  blockiert, plus Audit-Einträge.
- `tests/review-gate.spec.ts` — DoD 4: eingebautes Secret blockiert, und ein
  Claude-Report allein gibt nie frei.

Was eine echte Datenbank oder echte Scanner braucht, steht in denselben Dateien
als `it.todo` — sichtbar offen statt stillschweigend fehlend.
