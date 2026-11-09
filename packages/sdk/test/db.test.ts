import { describe, expect, it } from 'vitest';
import {
  assertAppConnectionString,
  assertSafeSchemaName,
  createAppPool,
  SdkConfigurationError,
} from '../src/index.js';

const APP_URL = 'postgresql://app_projektliste:geheim@db:5432/openapps';

/** Die riskanten Pfade zuerst: eine App darf nicht als Owner verbinden. */
describe('assertAppConnectionString', () => {
  it('nimmt die Rolle einer App an', () => {
    expect(() => assertAppConnectionString(APP_URL)).not.toThrow();
  });

  it('weist die Superuser-Rolle ab', () => {
    expect(() =>
      assertAppConnectionString('postgresql://postgres:x@db:5432/openapps'),
    ).toThrowError(SdkConfigurationError);
  });

  it('weist eine Owner-Rolle ab', () => {
    for (const role of ['projektliste_owner', 'projektliste-owner', 'app_admin', 'root']) {
      expect(() =>
        assertAppConnectionString(`postgresql://${role}:x@db:5432/openapps`),
      ).toThrowError(SdkConfigurationError);
    }
  });

  it('weist eine Rolle ohne Namen ab', () => {
    expect(() => assertAppConnectionString('postgresql://db:5432/openapps')).toThrowError(
      SdkConfigurationError,
    );
  });

  it('weist einen mitgeschmuggelten search_path ab', () => {
    expect(() => assertAppConnectionString(`${APP_URL}?search_path=public`)).toThrowError(
      SdkConfigurationError,
    );
    expect(() =>
      assertAppConnectionString(`${APP_URL}?options=-c%20search_path%3Dpublic`),
    ).toThrowError(SdkConfigurationError);
  });

  it('weist ein fremdes Protokoll ab', () => {
    expect(() => assertAppConnectionString('mysql://app_x:y@db/openapps')).toThrowError(
      SdkConfigurationError,
    );
  });

  it('weist eine unbrauchbare URL ab', () => {
    expect(() => assertAppConnectionString('nicht-mal-eine-url')).toThrowError(
      SdkConfigurationError,
    );
  });

  it('nagelt die erwartete Rolle fest, wenn sie angegeben ist', () => {
    expect(() => assertAppConnectionString(APP_URL, 'app_projektliste')).not.toThrow();
    expect(() => assertAppConnectionString(APP_URL, 'app_crm')).toThrowError(SdkConfigurationError);
  });
});

describe('assertSafeSchemaName', () => {
  it('nimmt einen einfachen Postgres-Namen an', () => {
    expect(assertSafeSchemaName('app_projektliste')).toBe('app_projektliste');
  });

  it('weist public und Systemschemata ab', () => {
    for (const schema of ['public', 'pg_catalog', 'information_schema']) {
      expect(() => assertSafeSchemaName(schema)).toThrowError(SdkConfigurationError);
    }
  });

  it('weist alles ab, was in einer Startup-Option gefährlich wäre', () => {
    for (const schema of ['app, public', 'app"x', 'App', 'app;drop', '']) {
      expect(() => assertSafeSchemaName(schema)).toThrowError(SdkConfigurationError);
    }
  });
});

describe('createAppPool', () => {
  it('legt einen Pool mit festem search_path an, ohne zu verbinden', async () => {
    const pool = createAppPool({ connectionString: APP_URL, schema: 'app_projektliste' });
    // Cast statt `any`: `pg` legt die effektive Konfiguration auf `pool.options`,
    // die Typen von @types/pg geben die Form aber nicht vollständig her.
    const options = (pool as unknown as { options: Record<string, unknown> }).options;
    try {
      expect(options['options']).toBe('-c search_path=app_projektliste');
      expect(options['application_name']).toBe('app_projektliste');
    } finally {
      await pool.end();
    }
  });

  it('verlangt ein Schema', () => {
    expect(() => createAppPool({ connectionString: APP_URL, schema: '' })).toThrowError(
      SdkConfigurationError,
    );
  });

  it('verlangt eine Verbindungszeichenfolge', () => {
    expect(() => createAppPool({ connectionString: '', schema: 'app_x' })).toThrowError(
      SdkConfigurationError,
    );
  });

  it('weist eine Owner-Verbindung ab, bevor sie verbindet', () => {
    expect(() =>
      createAppPool({
        connectionString: 'postgresql://openapps_owner:x@db:5432/openapps',
        schema: 'app_x',
      }),
    ).toThrowError(SdkConfigurationError);
  });
});
