/**
 * Der Pfad einer App (ADR 0007) und der `basePath`-Schritt des Review-Gates.
 *
 * Zwei riskante Stellen, deshalb zuerst geprueft:
 *
 * 1. Die Ableitung. Der Pfad ist kein eigenes Feld, sondern folgt dem Namen.
 *    Laeuft `appPathFor` und `appNameFromPath` auseinander, entscheidet die
 *    Forward-Auth ueber eine andere App als die, die antwortet.
 * 2. Der Schritt. Eine App mit falschem oder fehlendem `basePath` ist kaputt,
 *    und zwar erst im Browser — er muss blockieren. Eine nicht erhobene
 *    Tatsache darf dagegen nicht still freigeben.
 */

import { describe, expect, it } from 'vitest';
import { appNameFromPath, appPathFor, appUrlFor, appsDomainFor } from '../src/domain/naming';
import { ValidationError } from '../src/domain/errors';
import { checkAppBasePath } from '../src/domain/review-gate';
import type { BasePathFact, ReviewInput } from '../src/domain/review-gate/types';
import { manifest } from './helpers';

describe('der Pfad einer App ist aus ihrem Namen abgeleitet', () => {
  it('leitet Pfad und Adresse aus dem Namen ab', () => {
    expect(appPathFor('projekte')).toBe('/projekte');
    expect(appPathFor('crm-light')).toBe('/crm-light');
    expect(appUrlFor('projekte', '  Intern.Example.COM ')).toBe(
      'https://intern.example.com/projekte',
    );
  });

  it('weist einen Namen ab, der als Pfadsegment nicht traegt', () => {
    for (const name of ['../etc', 'Projekte', 'a', 'app name', '']) {
      expect(() => appPathFor(name), name).toThrow(ValidationError);
    }
  });

  it('verlangt eine Domain', () => {
    expect(() => appsDomainFor('   ')).toThrow(ValidationError);
  });

  it('liest den Namen aus dem Pfad zurueck — und nur dann, wenn er eindeutig ist', () => {
    expect(appNameFromPath('/projekte')).toBe('projekte');
    expect(appNameFromPath('/projekte/')).toBe('projekte');
    expect(appNameFromPath('/projekte/1/edit?q=x')).toBe('projekte');
    // Nichts davon ist ein App-Pfad. `null` heisst beim Aufrufer „nein".
    for (const path of ['/', '', '/..', '/%2e%2e/projekte', '/PROJEKTE', '/projekte%2fx', '/a']) {
      expect(appNameFromPath(path), path).toBeNull();
    }
  });

  it('ist zu `appPathFor` die Umkehrung', () => {
    for (const name of ['projekte', 'crm-light', 'abc']) {
      expect(appNameFromPath(appPathFor(name))).toBe(name);
    }
  });
});

describe('das Review-Gate prueft den basePath', () => {
  function input(options: { appName?: string | null; basePath?: BasePathFact }): ReviewInput {
    const appName = options.appName === undefined ? 'projekte' : options.appName;
    return {
      appId: 'a-1',
      deploymentId: 'd-1',
      version: '1.0.0',
      gitSha: 'abcdef1',
      repoDir: '/tmp/projekte',
      manifest: manifest('projekte'),
      uiActions: [],
      codeFacts: {
        tables: [],
        tools: [],
        envVars: [],
        ...(options.basePath === undefined ? {} : { basePath: options.basePath }),
      },
      ...(appName === null ? {} : { gateway: { appName, domain: 'intern.example.com' } }),
    };
  }

  const codes = (findings: readonly { code: string }[]): string[] => findings.map((f) => f.code);

  it('gibt frei, wenn der basePath aus der erwarteten Variable kommt und passt', () => {
    const findings = checkAppBasePath(
      input({
        basePath: {
          value: '/projekte',
          fromEnv: 'OPENAPPS_APP_BASE_PATH',
          source: 'next.config.js',
        },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('nimmt einen leeren Rueckfallwert hinter der Variable hin — lokal laeuft die App auf /', () => {
    const findings = checkAppBasePath(
      input({ basePath: { value: '', fromEnv: 'OPENAPPS_APP_BASE_PATH' } }),
    );
    expect(findings).toEqual([]);
  });

  it('warnt, wenn der Rueckfallwert hinter der Variable ein fremder Pfad ist', () => {
    const findings = checkAppBasePath(
      input({ basePath: { value: '/projekt', fromEnv: 'OPENAPPS_APP_BASE_PATH' } }),
    );
    expect(codes(findings)).toEqual(['base_path.fallback_differs']);
    expect(findings[0]?.severity).toBe('warning');
  });

  it('blockiert einen fehlenden basePath', () => {
    for (const value of [null, '']) {
      const findings = checkAppBasePath(input({ basePath: { value, fromEnv: null } }));
      expect(codes(findings)).toEqual(['base_path.missing']);
      expect(findings[0]?.severity).toBe('blocking');
    }
  });

  it('blockiert einen festen basePath, der nicht zum Pfad der App passt', () => {
    const findings = checkAppBasePath(input({ basePath: { value: '/projekt', fromEnv: null } }));
    expect(codes(findings)).toEqual(['base_path.mismatch']);
    expect(findings[0]?.severity).toBe('blocking');
  });

  it('blockiert einen basePath aus einer Variable, die die Plattform nicht setzt', () => {
    const findings = checkAppBasePath(
      input({ basePath: { value: '/projekte', fromEnv: 'NEXT_PUBLIC_BASE_PATH' } }),
    );
    expect(codes(findings)).toEqual(['base_path.unexpected_env']);
    expect(findings[0]?.severity).toBe('blocking');
  });

  it('warnt bei einem fest verdrahteten, aber richtigen basePath — und blockiert nicht', () => {
    const findings = checkAppBasePath(input({ basePath: { value: '/projekte', fromEnv: null } }));
    expect(codes(findings)).toEqual(['base_path.hardcoded']);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('macht eine nicht erhobene Tatsache sichtbar, statt still freizugeben', () => {
    const findings = checkAppBasePath(input({}));
    expect(codes(findings)).toEqual(['base_path.unknown']);
    expect(findings[0]?.severity).toBe('warning');
  });

  it('blockiert, wenn es kein Gateway-Ziel gibt — ohne App-Name kein Pfad', () => {
    const findings = checkAppBasePath(input({ appName: null }));
    expect(codes(findings)).toEqual(['base_path.no_app_name']);
    expect(findings[0]?.severity).toBe('blocking');
  });

  it('blockiert einen App-Namen, aus dem kein Pfad wird', () => {
    const findings = checkAppBasePath(input({ appName: '../etc' }));
    expect(codes(findings)).toEqual(['base_path.underivable']);
  });
});
