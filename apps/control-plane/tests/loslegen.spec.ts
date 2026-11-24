/**
 * Das Onboarding (Seite /loslegen und MCP-Prompt loslegen) aus einer Quelle.
 * Geprueft wird, dass die Adresse aus der Konfiguration kommt und nie aus dem
 * Request, und dass im Text nie ein Token stehen kann.
 */

import { describe, expect, it } from 'vitest';
import { loslegenAlsText, loslegenSchritte, publicMcpUrl } from '../src/lib/loslegen';

describe('Loslegen', () => {
  it('nimmt die ausdrueckliche Adresse vor der abgeleiteten', () => {
    expect(
      publicMcpUrl({
        OPENAPPS_PUBLIC_MCP_URL: 'http://localhost:8080/mcp',
        CONTROL_PLANE_HOST: 'cp.example.com',
      }),
    ).toBe('http://localhost:8080/mcp');
    expect(publicMcpUrl({ CONTROL_PLANE_HOST: 'cp.example.com' })).toBe(
      'https://cp.example.com/mcp',
    );
    expect(publicMcpUrl({})).toBe('/mcp');
  });

  it('enthaelt Plugin, Adresse und Befehle, aber kein Token', () => {
    const text = loslegenAlsText({ CONTROL_PLANE_HOST: 'cp.example.com' });
    expect(text).toContain('/plugin install openapps@openapps');
    expect(text).toContain('export OPENAPPS_MCP_URL="https://cp.example.com/mcp"');
    expect(text).toContain('<dein Token>');
    expect(text).toContain('/openapps:neue-app');
    expect(text).not.toMatch(/oa_[A-Za-z0-9_]{10,}/);
  });

  it('zeigt Seite und Prompt dieselben Schritte', () => {
    const text = loslegenAlsText({});
    for (const [i, schritt] of loslegenSchritte({}).entries()) {
      expect(text).toContain(`## ${String(i + 1)}. ${schritt.titel}`);
    }
  });
});
