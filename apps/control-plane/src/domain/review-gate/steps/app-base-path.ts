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
      'kein Gateway-Ziel im Review-Eingang — ohne App-Name ist der Pfad nicht ableitbar ' +
        'und der basePath nicht pruefbar (ADR 0007)',
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
      `Pfad der App nicht ableitbar: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return findings;
  }

  const fact = input.codeFacts.basePath;
  if (fact === undefined) {
    add(
      'warning',
      'base_path.unknown',
      `der basePath der Arbeitskopie wurde nicht erhoben — ob die App unter "${expected}" ` +
        'ihre eigenen Dateien findet, ist fuer diesen Deploy ungeprueft (ADR 0007)',
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
        `der basePath kommt richtig aus ${BASE_PATH_ENV}, der Rueckfallwert im Code ist aber ` +
          `"${fact.value}" und nicht "${expected}" oder leer — das faellt nur lokal auf, ` +
          'verwirrt dort aber genau so',
        where,
      );
    }
    return findings;
  }

  if (fact.fromEnv !== null) {
    add(
      'blocking',
      'base_path.unexpected_env',
      `der basePath kommt aus "${fact.fromEnv}". Diese Variable setzt die Plattform nicht; ` +
        `im Deployment waere der basePath leer, obwohl die App unter "${expected}" liegt. ` +
        `Erwartet wird ${BASE_PATH_ENV}`,
      where,
    );
    return findings;
  }

  if (fact.value === null || fact.value === '') {
    add(
      'blocking',
      'base_path.missing',
      `die App setzt keinen basePath. Unter ADR 0007 liegt sie auf "${expected}"; ohne basePath ` +
        `laedt sie ihre Dateien von "/" und ist im Browser kaputt. Erwartet wird ein basePath ` +
        `aus ${BASE_PATH_ENV}`,
      where,
    );
    return findings;
  }

  if (fact.value !== expected) {
    add(
      'blocking',
      'base_path.mismatch',
      `der basePath ist fest "${fact.value}", der Pfad dieser App ist "${expected}"`,
      where,
    );
    return findings;
  }

  add(
    'warning',
    'base_path.hardcoded',
    `der basePath "${fact.value}" steht fest im Code und nicht in ${BASE_PATH_ENV}. Er stimmt ` +
      'heute und bleibt stehen, wenn die App einmal einen anderen Pfad bekommt — die Control ' +
      'Plane setzt die Variable pro Deployment',
    where,
  );

  return findings;
}
