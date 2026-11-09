/**
 * `create_app` legt das Repo an — der fehlende Schritt zu DoD 1
 * („App aus dem Starter-Template per MCP-Befehl anlegen").
 *
 * Geprueft wird vor allem die Reihenfolge: Das Repo entsteht **vor** der
 * Registrierung. Scheitert der Anbieter, darf keine App im Register stehen, die
 * auf ein Repo zeigt, das es nicht gibt.
 */

import { describe, expect, it } from 'vitest';
import { createApp, listApps } from '../src/domain';
import { PermissionDeniedError } from '../src/domain/errors';
import { admin, createHarness, gitSource, manifest, seedBootstrapGrants } from './helpers';

describe('create_app legt das Repo aus dem Starter-Template an', () => {
  it('fragt das Repo-Backend und uebernimmt dessen Git-URL als Quelle', async () => {
    const harness = await setup();

    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'projektliste',
      manifest: manifest('projektliste'),
    });

    expect(harness.repositories.created).toEqual([
      {
        appName: 'projektliste',
        description: 'Test-App projektliste',
        requestedBy: 'user:u-admin',
      },
    ]);

    // Die Quelle kommt vom Backend, nicht aus dem uebergebenen Manifest.
    expect(app.source).toEqual({
      git: 'https://git.test/openapps/projektliste.git',
      tag: 'v0.0.0',
    });
    // Register und Manifest fuehren dieselbe Quelle.
    expect(app.manifest.source).toEqual(app.source);
  });

  it('registriert nichts, wenn das Repo nicht entsteht', async () => {
    const harness = await setup({ repositoryFailsWith: 'Token hat kein Schreibrecht' });

    await expect(
      createApp(harness.ctx, {
        actor: admin,
        name: 'projektliste',
        manifest: manifest('projektliste'),
      }),
    ).rejects.toThrow('Token hat kein Schreibrecht');

    expect(await harness.ctx.apps.findByName('projektliste')).toBeNull();
    // Und kein Schema, keine Rolle: der Fehlschlag hinterlaesst nichts.
    expect(harness.provisioner.provisioned).toEqual([]);
  });

  it('legt kein Repo an, wenn eine Quelle mitgegeben wird', async () => {
    const harness = await setup();

    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'vorhanden',
      manifest: manifest('vorhanden'),
      source: gitSource('vorhanden'),
    });

    expect(harness.repositories.created).toEqual([]);
    expect(app.source).toEqual(gitSource('vorhanden'));
  });

  it('fragt das Repo-Backend nicht, wenn die Freigabe fehlt', async () => {
    const harness = await setup();

    await expect(
      createApp(harness.ctx, {
        actor: { kind: 'user', id: 'u-fremd' },
        name: 'heimlich',
        manifest: manifest('heimlich'),
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // Default-Deny wirkt vor jeder Nebenwirkung.
    expect(harness.repositories.created).toEqual([]);
    expect(harness.provisioner.provisioned).toEqual([]);
  });

  it('legt Schema und Rolle an und macht die App noch fuer niemanden sichtbar', async () => {
    const harness = await setup();

    await createApp(harness.ctx, {
      actor: admin,
      name: 'kanban',
      manifest: manifest('kanban'),
    });

    expect(harness.provisioner.provisioned).toEqual(['app_kanban@app_kanban']);
    // Der Admin sieht sie (Wildcard), ein anderer Mensch nicht.
    expect(await listApps(harness.ctx, { actor: admin })).toHaveLength(1);
    expect(
      await listApps(harness.ctx, { actor: { kind: 'user', id: 'u-lena', groups: ['team'] } }),
    ).toHaveLength(0);
  });
});

async function setup(options?: { repositoryFailsWith?: string }) {
  const harness = createHarness(
    options?.repositoryFailsWith === undefined
      ? {}
      : { repositoryFailsWith: options.repositoryFailsWith },
  );
  await seedBootstrapGrants(harness);
  return harness;
}
