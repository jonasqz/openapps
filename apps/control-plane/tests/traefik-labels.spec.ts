/**
 * Die Labels, die eine App hinter das Gateway stellen — und der Label-Lint,
 * der merkt, wenn einer fehlt.
 *
 * Der Port ist der Grund fuer diese Datei: Im Gateway-Lauf
 * (docs/nachweise/dod-02-laeufe/2026-11-09-lokal-gateway.txt) kam ein Router
 * ohne Port-Label mit einem Image ohne `EXPOSE` nicht hoch. Nicht unsicher —
 * der Schutz haengt am Entrypoint —, aber kaputt.
 */

import { describe, expect, it } from 'vitest';
import {
  forwardAuthLabels,
  missingForwardAuthLabels,
  type ForwardAuthLabelInput,
} from '../src/adapters/coolify/traefik';
import { appContainerPort, DEFAULT_APP_PORT } from '../src/domain';
import { ConflictError } from '../src/domain/errors';
import type { AppManifest } from '../src/domain/types';
import { manifest } from './helpers';

const input: ForwardAuthLabelInput = {
  appName: 'projektliste',
  domain: 'projektliste.apps.example.com',
  port: 3000,
  forwardAuthUrl: 'http://127.0.0.1:8090/api/authz/forward',
};

const PORT_LABEL = 'traefik.http.services.openapps-projektliste.loadbalancer.server.port';

describe('Traefik-Labels einer App', () => {
  it('setzt den Port des Dienstes, damit Traefik ihn nicht raten muss', () => {
    const labels = forwardAuthLabels(input);
    expect(labels[PORT_LABEL]).toBe('3000');
    // Der Router zeigt ausdruecklich auf diesen Dienst.
    expect(labels['traefik.http.routers.openapps-projektliste.service']).toBe(
      'openapps-projektliste',
    );
  });

  it('meldet das fehlende Port-Label als fehlend', () => {
    const complete = { ...forwardAuthLabels(input) };
    delete complete[PORT_LABEL];

    expect(missingForwardAuthLabels(complete, input)).toContain(PORT_LABEL);
  });

  it('meldet einen falschen Port als fehlend — ein anderer Port ist kein Port', () => {
    const labels = { ...forwardAuthLabels(input), [PORT_LABEL]: '8080' };

    expect(missingForwardAuthLabels(labels, input)).toEqual([PORT_LABEL]);
  });

  it('nennt nichts fehlend, wenn der Satz vollstaendig ist', () => {
    expect(missingForwardAuthLabels(forwardAuthLabels(input), input)).toEqual([]);
  });

  it('schickt die Forward-Auth auf den internen authz-Entrypoint, nicht auf die oeffentliche URL', () => {
    const labels = forwardAuthLabels(input);
    expect(labels['traefik.http.middlewares.openapps-auth-projektliste.forwardauth.address']).toBe(
      'http://127.0.0.1:8090/api/authz/forward',
    );
  });
});

describe('Port einer App', () => {
  const app = (env: AppManifest['env']) => ({
    name: 'projektliste',
    manifest: { ...manifest('projektliste'), env },
  });

  const portEnv = (value: string): AppManifest['env'] => [
    { name: 'PORT', secret: false, description: 'Port der App', required: true, default: value },
  ];

  it('nimmt die Konvention 3000, wenn das Manifest nichts anderes sagt', () => {
    expect(appContainerPort(app([]))).toBe(DEFAULT_APP_PORT);
    expect(DEFAULT_APP_PORT).toBe(3000);
  });

  it('nimmt den Port aus der Env-Deklaration PORT des Manifests', () => {
    expect(appContainerPort(app(portEnv('8080')))).toBe(8080);
  });

  it('bricht ab, statt bei einem unsinnigen PORT still auf 3000 zurueckzufallen', () => {
    expect(() => appContainerPort(app(portEnv('dreitausend')))).toThrow(ConflictError);
    expect(() => appContainerPort(app(portEnv('0')))).toThrow(ConflictError);
  });
});
