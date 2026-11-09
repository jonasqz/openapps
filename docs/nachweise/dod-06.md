# Nachweis DoD 6: Agent nutzt nur freigegebene Tools

**Kriterium:** Ein Agent mit eigener Identität ruft über den Plattform-MCP
Tools einer App auf. Er sieht und nutzt nur freigegebene Tools, ohne Freigabe
wird er blockiert, jeder Aufruf wird protokolliert.

**Art:** Test im Code.

## Der Nachweis ist

`apps/platform-mcp/tests/agent-grants.spec.ts`: zwei Agents mit eigenen
Identitäten, einer mit Freigabe, einer ohne. Geprüft werden drei Dinge pro
Agent — die Tool-Liste, der Aufruf und der Log-Eintrag.

Stand: offen — Test existiert noch nicht.

## Was der Test beweist

- Der Agent ohne Freigabe sieht das Tool nicht in der Liste.
- Ruft er es trotzdem auf (Name bekannt), wird er abgelehnt. Verstecken allein
  reicht nicht.
- Der Agent mit Freigabe ruft es erfolgreich auf.
- Nach `revoke` wird derselbe Aufruf beim nächsten Mal abgelehnt — die Prüfung
  läuft pro Aufruf, ohne Cache über die Freigabe (`docs/01-architektur.md`).
- Beide Fälle, Erfolg und Ablehnung, stehen mit Agent-Identität, Tool und
  Zeitstempel im Log.

## Was der Test nicht beweist

- **Nicht**, dass der Agent nicht an der MCP-Schicht vorbei an die App kommt.
  Der Test prüft den Plattform-MCP. Der direkte HTTP-Weg zur App ist DoD 2.
- **Nicht**, dass das Log vollständig ist. Der Test prüft die Einträge, die er
  erzeugt. Dass kein Pfad existiert, der ohne Log-Eintrag ausführt, folgt
  daraus nicht.
- **Nicht**, dass das Log fälschungssicher oder aufbewahrt ist. Audit-Export
  und Aufbewahrung sind laut `docs/00-brief.md` nicht in v1.
- **Nicht**, dass die Tools der App fachlich richtig arbeiten. Geprüft wird die
  Rechteschicht, nicht die Domänenlogik.
- **Nicht**, dass die Agent-Identität nicht geteilt wird. Zwei Menschen mit
  demselben Agent-Token sind für den Test ein Agent.
