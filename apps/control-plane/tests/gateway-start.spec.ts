/**
 * Die Gateway-Konfiguration entsteht beim Start, nicht erst beim ersten
 * Deploy.
 *
 * Der Fall, um den es geht: ein frischer Server, keine einzige App. Bisher
 * schrieb nur ein Deploy `openapps.yaml`; ohne Datei gibt es keinen Router fuer
 * die Control Plane, ohne Router keinen Login, ohne Login keinen Deploy.
 */

import { describe, expect, it } from 'vitest';
import { CONTROL_PLANE_ROUTER } from '../src/domain/gateway-config';
import { createApp, publishGatewayAtStartup } from '../src/domain';
import { admin, createHarness, manifest, seedBootstrapGrants } from './helpers';

describe('Gateway beim Start', () => {
  it('schreibt ohne eine einzige App einen Router fuer die Control Plane — mit beiden Middlewares', async () => {
    const harness = createHarness({ appsDomain: 'apps.test' });

    const config = await publishGatewayAtStartup(harness.ctx);

    expect(harness.gatewayConfig.published).toHaveLength(1);
    const router = config.http.routers[CONTROL_PLANE_ROUTER];
    expect(router, 'kein Router fuer die Control Plane').toBeDefined();
    expect(router?.middlewares).toEqual(['openapps-strip-auth-headers', 'openapps-forward-auth']);
  });

  it('nimmt angelegte Apps mit — die Datei kommt aus der Datenbank, nicht vom Host', async () => {
    const harness = createHarness({ appsDomain: 'apps.test' });
    await seedBootstrapGrants(harness);
    await createApp(harness.ctx, {
      actor: admin,
      name: 'projekte',
      manifest: manifest('projekte'),
    });

    const config = await publishGatewayAtStartup(harness.ctx);

    expect(Object.keys(config.http.routers).length).toBeGreaterThan(1);
  });

  it('wirft, wenn das Schreiben scheitert — der Start meldet das als Alarm', async () => {
    const harness = createHarness({
      appsDomain: 'apps.test',
      gatewayPublishFailsWith: 'EACCES: /traefik/dynamic',
    });
    await expect(publishGatewayAtStartup(harness.ctx)).rejects.toThrow(/EACCES/);
  });
});
