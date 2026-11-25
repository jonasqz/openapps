/**
 * Der `basePath` der App — geprueft **vor** dem Deploy (ADR 0007).
 *
 * Warum ein eigener Schritt und nicht ein Zweig im Konfigurations-Lint: Der
 * beurteilt den Satz, den die Control Plane ans Gateway haengt. Der `basePath`
 * steht auf der anderen Seite — er ist eine Eigenschaft des **Builds der App**
 * und bleibt derselbe, egal ob die Router aus Docker-Labels oder aus einer
 * eigenen dynamischen Konfiguration entstehen. Zwei Dinge, die unabhaengig
 * falsch sein koennen, gehoeren in zwei Schritte; sonst steht im Bericht ein
 * Befund unter einem Namen, der nicht dazu passt.
 *
 * Was er beurteilt, ist **woher** der Wert kommt, nicht nur wie er aussieht:
 *
 *  - Aus `OPENAPPS_APP_BASE_PATH`: richtig. Den Wert setzt die Control Plane
 *    pro Deployment aus `appPathFor(app.name)` — er kann dann nicht abweichen,
 *    und zwar auch nach einem Umzug der App nicht.
 *  - Fest im Code, aber gleich dem abgeleiteten Pfad: nicht falsch, also kein
 *    Blocker. Es ist eine Zeitbombe fuer den Tag, an dem die App einen anderen
 *    Pfad bekommt, und steht als Hinweis im Bericht.
 *  - Fest im Code und abweichend, oder gar kein `basePath`: blockierend. Die
 *    App laedt ihre JavaScript-Dateien und Bilder dann von `/` statt von
 *    `/<app>` — sie ist kaputt, und zwar erst im Browser.
 *  - Aus einer anderen Env-Variable: blockierend. Die Plattform setzt sie
 *    nicht, der `basePath` ist im Deployment also leer.
 *
 * Was er nicht kann: Niemand erhebt die Tatsache bisher aus der Arbeitskopie
 * (dasselbe Bild wie bei `publishedPorts` und `dockerNetworks`). `undefined`
 * heisst „nicht erhoben", wird als sichtbarer Hinweis gemeldet und ist
 * ausdruecklich keine stille Freigabe.
 */

import { appPathFor } from '../../naming';
import type { Finding, ReviewInput, ReviewStep, StepResult } from '../types';

export const APP_BASE_PATH_STEP = 'app-base-path';

/** Die Variable, aus der eine App ihren `basePath` nimmt (ADR 0007). */
export const BASE_PATH_ENV = 'OPENAPPS_APP_BASE_PATH';

export function appBasePathStep(): ReviewStep {
  return {
    name: APP_BASE_PATH_STEP,
    kind: 'deterministic',
    run(input: ReviewInput): Promise<StepResult> {
      return Promise.resolve({
        step: APP_BASE_PATH_STEP,
        kind: 'deterministic',
        findings: checkAppBasePath(input),
      });
    },
  };
}

export function checkAppBasePath(input: ReviewInput): readonly Finding[] {
  const findings: Finding[] = [];
  const add = (
    severity: Finding['severity'],
    code: string,
    message: string,
    path?: string,
  ): void => {
    findings.push({
      step: APP_BASE_PATH_STEP,
      severity,
      code,
      message,
      ...(path === undefined ? {} : { path }),
    });
  };

  // Der Name, aus dem der Pfad entsteht, kommt aus dem Register (dasselbe
  // Gateway-Ziel wie beim Konfigurations-Lint), nicht aus dem Manifest der
  // Arbeitskopie: sonst koennte eine App sich den Pfad selbst aussuchen.
  const appName = input.gateway?.appName;
  if (appName === undefined) {
    add(
      'blocking',
      'base_path.no_app_name',
      'no gateway target in the review input: without an app name the path cannot be derived ' +
        'and the basePath cannot be checked (ADR 0007)',
    );
    return findings;
  }

  let expected: string;
  try {
    expected = appPathFor(appName);
  } catch (cause) {
    add(
      'blocking',
      'base_path.underivable',
      `the app path cannot be derived: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return findings;
  }

  const fact = input.codeFacts.basePath;
  if (fact === undefined) {
    add(
      'warning',
      'base_path.unknown',
      `the basePath of the working copy was not collected: whether the app finds its own files ` +
        `under "${expected}" is unchecked for this deploy (ADR 0007)`,
    );
    return findings;
  }

  const where = fact.source;

  if (fact.fromEnv === BASE_PATH_ENV) {
    // Den Wert setzt die Control Plane. Der Fallback im Code gilt nur lokal —
    // ein leerer Fallback ist dort richtig (die App laeuft lokal auf `/`).
    if (fact.value !== null && fact.value !== '' && fact.value !== expected) {
      add(
        'warning',
        'base_path.fallback_differs',
        `the basePath correctly comes from ${BASE_PATH_ENV}, but the fallback in the code is ` +
          `"${fact.value}" rather than "${expected}" or empty: this only shows up locally, ` +
          'but it confuses just as much there',
        where,
      );
    }
    return findings;
  }

  if (fact.fromEnv !== null) {
    add(
      'blocking',
      'base_path.unexpected_env',
      `the basePath comes from "${fact.fromEnv}". The platform does not set this variable; ` +
        `in the deployment the basePath would be empty although the app lives under "${expected}". ` +
        `Expected: ${BASE_PATH_ENV}`,
      where,
    );
    return findings;
  }

  if (fact.value === null || fact.value === '') {
    add(
      'blocking',
      'base_path.missing',
      `the app sets no basePath. Under ADR 0007 it lives at "${expected}"; without a basePath ` +
        `it loads its files from "/" and is broken in the browser. Expected: a basePath ` +
        `from ${BASE_PATH_ENV}`,
      where,
    );
    return findings;
  }

  if (fact.value !== expected) {
    add(
      'blocking',
      'base_path.mismatch',
      `the basePath is fixed to "${fact.value}", but the path of this app is "${expected}"`,
      where,
    );
    return findings;
  }

  add(
    'warning',
    'base_path.hardcoded',
    `the basePath "${fact.value}" is hard-coded instead of coming from ${BASE_PATH_ENV}. It is ` +
      'correct today but stays put if the app ever gets a different path; the control ' +
      'plane sets the variable per deployment',
    where,
  );

  return findings;
}
