import { describe, expect, it } from 'vitest';
import { readEnv } from '../src/lib/env';

/**
 * Pflicht-Variablen. Der Grundsatz dahinter steht in `CLAUDE.md`: halb
 * konfiguriert ist schlimmer als nicht konfiguriert — lieber der Start
 * verweigert als eine Plattform, die mit einer Luecke laeuft.
 */
const VOLLSTAENDIG: Record<string, string> = {
  DATABASE_URL: 'postgres://openapps_app@localhost:5432/openapps',
  APP_DATABASE_HOST: 'localhost:5432/openapps',
  APPS_DOMAIN: 'intern.example.com',
  CONTROL_PLANE_HOST: 'intern.example.com',
  CONTROL_PLANE_SERVICE_URL: 'http://openapps-control-plane:3000',
  OPENAPPS_AUTH_MASTER_SECRET: 'master-secret-nur-fuer-tests-0123456789',
};

describe('readEnv', () => {
  it('liest eine vollstaendige Umgebung', () => {
    const env = readEnv(VOLLSTAENDIG);
    expect(env.controlPlaneUrl).toBe('http://openapps-control-plane:3000');
    expect(env.controlPlaneHost).toBe('intern.example.com');
  });

  it('verweigert den Start ohne CONTROL_PLANE_SERVICE_URL', () => {
    // Ohne diese Adresse schreibt der Generator keinen Router fuer die Control
    // Plane. Dann muesste Coolify ihr eine Domain geben — und dieser Router
    // traegt unsere Middlewares nicht, die Anmeldung staende ungeschuetzt da.
    const { CONTROL_PLANE_SERVICE_URL: _weg, ...ohne } = VOLLSTAENDIG;
    expect(() => readEnv(ohne)).toThrowError(/CONTROL_PLANE_SERVICE_URL/);
  });

  it('verweigert den Start, wenn eine andere Pflicht-Variable fehlt', () => {
    for (const schluessel of [
      'DATABASE_URL',
      'APP_DATABASE_HOST',
      'CONTROL_PLANE_HOST',
      'OPENAPPS_AUTH_MASTER_SECRET',
    ]) {
      const ohne = { ...VOLLSTAENDIG };
      delete ohne[schluessel];
      expect(() => readEnv(ohne), schluessel).toThrowError(new RegExp(schluessel));
    }
  });

  it('weist ein zu kurzes Master-Secret ab', () => {
    expect(() => readEnv({ ...VOLLSTAENDIG, OPENAPPS_AUTH_MASTER_SECRET: 'zu-kurz' })).toThrowError(
      /OPENAPPS_AUTH_MASTER_SECRET/,
    );
  });
});
