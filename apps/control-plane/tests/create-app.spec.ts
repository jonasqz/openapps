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
    const harness = await setup({ repositoryFailsWith: 'token has no write access' });

    await expect(
      createApp(harness.ctx, {
        actor: admin,
        name: 'projektliste',
        manifest: manifest('projektliste'),
      }),
    ).rejects.toThrow('token has no write access');

    expect(await harness.ctx.apps.findByName('projektliste')).toBeNull();
    // Und kein Schema, keine Rolle: der Fehlschlag hinterlaesst nichts.
    expect(harness.provisioner.provisioned).toEqual([]);
  });

  it('registriert nichts, wenn Schema und Rolle nicht entstehen — und ein zweiter Versuch geht', async () => {
    // Der Fall aus dem ersten lokalen Lauf (ADR 0012): Vorher stand die App
    // schon im Register, als `provision` scheiterte, und jeder weitere
    // Versuch endete in „gibt es schon".
    const harness = await setup();
    const failing = {
      ...harness.ctx,
      provisioner: {
        ...harness.ctx.provisioner,
        provision: () => Promise.reject(new Error('Postgres not reachable')),
      },
    };

    await expect(
      createApp(failing, {
        actor: admin,
        name: 'projektliste',
        manifest: manifest('projektliste'),
        source: gitSource('projektliste'),
      }),
    ).rejects.toThrow('Postgres not reachable');
    expect(await harness.ctx.apps.findByName('projektliste')).toBeNull();

    const app = await createApp(harness.ctx, {
      actor: admin,
      name: 'projektliste',
      manifest: manifest('projektliste'),
      source: gitSource('projektliste'),
    });
    expect(app.name).toBe('projektliste');
  });

  it('traegt die Domain schon beim Anlegen, nicht in einem zweiten Schritt', async () => {
    const harness = createHarness({ appsDomain: 'example.test' });
    await seedBootstrapGrants(harness);
    let setLater = 0;
    const ctx = {
      ...harness.ctx,
      apps: {
        ...harness.ctx.apps,
        setPrimaryDomain: async (...args: Parameters<typeof harness.ctx.apps.setPrimaryDomain>) => {
          setLater += 1;
          await harness.ctx.apps.setPrimaryDomain(...args);
        },
      },
    };

    const app = await createApp(ctx, {
      actor: admin,
      name: 'kanban',
      manifest: manifest('kanban'),
    });

    expect(app.primaryDomain).not.toBeNull();
    expect(setLater).toBe(0);
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
