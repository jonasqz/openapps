# ADR 0019: Die Anbindung an die Leiste als Helfer statt als Kopie

Stand: 27.11.2026

## Kontext

ADR 0017 hat die gemeinsame Leiste eingefuehrt. Jede App hat sie mit drei
Dateien angebunden, die bis auf die Bereiche gleich waren:

- `src/lib/shell.ts` mit `loadShell()`: Header lesen, `getUser`,
  `getNavigation`, in die Form der Leiste umbauen, basePath aus der Env.
- `src/components/Shell.tsx`: die Tabelle `SECTIONS`, dazu `usePathname`,
  `router.push`, der aktuelle Eintrag und das Umrechnen des basePath.
- `src/app/layout.tsx` mit `themeScript` per `dangerouslySetInnerHTML`.

Fuenf Kopien (vier Standard-Apps, Vorlage). Ein Fehler darin, etwa ein
doppelter basePath im Router oder ein `try/catch` um `headers()`, waere in
jeder App einzeln zu beheben, und jede neue App kopiert ihn mit.

Zwei Grenzen schraenken den Schnitt ein: Das SDK wird mit `tsc` gebaut und
kennt weder React noch Next. Das Design System wird als Quelle ausgeliefert,
kennt React, aber nicht das SDK. Keines der beiden soll vom anderen abhaengen.

## Entscheidung

Die Anbindung wird in zwei Haelften geteilt, je an der Stelle, die ihre
Abhaengigkeit ohnehin hat:

- **Server: `@openapps/sdk`.** `readShell(headers, manifest)` im Kern des SDK,
  ohne Next: liefert `{ appName, appTitle, platform, user, basePath }` und
  wirft nie. Der Unterpfad `@openapps/sdk/next` liefert
  `loadShell(manifest)`, das nur `headers()` aus `next/headers` liest und
  `readShell` aufruft. `headers()` steht bewusst nicht im `try/catch`, damit
  Next dynamisches Rendern weiter erkennt.
- **Client: `@openapps/ui`.** `sectionNav` (rein, im Kern) baut aus einer
  flachen Tabelle `AppSection[]` und dem Pfad die Gruppen fuer
  `PlatformShell`. Der Unterpfad `@openapps/ui/next` liefert
  `NextPlatformShell`, eine Client-Komponente mit `usePathname` und
  `router.push`. `ThemeScript` (im Kern) ersetzt das eigene
  `dangerouslySetInnerHTML` der Apps.
- **`next` ist optionale peerDependency** von SDK und Design System, je nur
  fuer den Unterpfad `/next`, und devDependency fuer Typpruefung und Tests.
  Die Kerne bleiben ohne `next` nutzbar (Schaufenster, andere Frameworks).
- **Die Typen sind strukturell gleich, nicht geteilt.** `ShellData` im SDK
  passt auf die Props von `NextPlatformShell`, ohne dass ein Paket das andere
  importiert. Die App fuegt beide im Layout zusammen.
- **Die App schreibt nur noch ihre Bereiche.** `SECTIONS` steht im Layout
  (Server-Komponente) und geht als einfache Daten an die Client-Komponente.
  `src/lib/shell.ts` und `src/components/Shell.tsx` entfallen.

## Folgen

- Eine App bindet die Leiste mit `loadShell(manifest)`, `ThemeScript` und
  `<NextPlatformShell {...shell} sections={SECTIONS}>` an. Ein Fehler in der
  Anbindung wird einmal behoben und mit dem naechsten Build jeder App wirksam.
- Das Verhalten bleibt gleich: ohne gueltige Signatur nur die eigene App, nie
  ein Fehler. Tests im SDK und im Design System belegen das.
- `pnpm-lock.yaml` fuehrt `next` jetzt auch fuer `packages/sdk` und
  `packages/ui`. pnpm loest es auf dieselbe Kopie auf wie in den Apps; das
  ist noetig, weil `headers()` und `usePathname` an der Instanz von Next
  haengen, die die App rendert.
- Wer eine Bereichsliste mit Gruppen oder Icons braucht, bekommt sie nicht
  durch die flache Tabelle. Das bleibt mit `sectionNav` plus `PlatformShell`
  moeglich und kommt in den Helfer, wenn eine zweite App es braucht.

## Alternativen

- **Alles in `@openapps/sdk/next`, auch die Client-Komponente:** Das SDK
  muesste React, JSX und das Design System kennen und haette einen Pfad, in
  dem Server-Code mit dem Secret neben Client-Code liegt. Verworfen.
- **Alles in `@openapps/ui/next`, auch `loadShell`:** Das Design System
  hinge dann am SDK und an `node:crypto`, und Code, der das Secret liest,
  laege in einem Paket, das als Quelle in den Browser-Build geht. Verworfen.
- **`readShell(await headers(), manifest)` ohne Unterpfad im SDK:** Das SDK
  braeuchte `next` gar nicht. Jede App schriebe aber wieder den Aufruf von
  `headers()` selbst, und genau dort liegt die Versuchung, ihn in ein
  `try/catch` zu packen.
  `readShell` bleibt fuer andere Frameworks, `loadShell` ist der Normalfall.
- **Die Kopie lassen und per Linter auf Gleichheit pruefen:** Haelt die
  Dateien gleich, aber nicht klein, und jede neue App startet mit drei
  Dateien, die sie nicht aendern darf. Verworfen.
