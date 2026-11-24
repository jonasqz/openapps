/**
 * Einrichten des lokalen Betriebs (infra/lokal, ADR 0011). Laeuft im
 * Container der Control Plane:
 *
 *   docker compose -f infra/lokal/docker-compose.yml exec control-plane \
 *     node_modules/.bin/tsx src/infra/lokal-einrichten.ts
 *
 * Was es tut, und mit welchem Recht:
 *
 * 1. Es handelt als **Betreiber dieses Rechners** — ein Nutzer in der Gruppe
 *    `platform-admins`, so wie der Bootstrap-Admin auf dem Server. Wer diesen
 *    Befehl ausfuehren kann, hat ohnehin die Owner-DSN in der Hand; das Skript
 *    gibt ihm nicht mehr, es macht es nur nachvollziehbar: Jeder Schritt laeuft
 *    durch die Domaene und steht im Audit-Log als `user:lokal-betreiber`.
 * 2. Es registriert die Standard-Apps aus `LOKAL_SOURCE_DIR` und deployt sie —
 *    durch dasselbe Review-Gate wie auf dem Server.
 * 3. Es legt den Agenten `betrieb` an und gibt ihm die Rechte, die die Gruppe
 *    `platform-admins` hat. Alles Weitere — Arbeits-Agents, Freigaben — macht
 *    `betrieb` dann ueber den Plattform-MCP, wie jeder andere Agent.
 *
 * Das Token von `betrieb` erscheint genau einmal, auf stdout, als letzte
 * Zeile `BETRIEB_TOKEN=…`. Das Host-Skript schreibt es in eine Datei mit
 * Modus 0600 und zeigt es nicht an. Ein zweiter Lauf legt nichts doppelt an
 * und gibt kein neues Token aus.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAppManifest } from '@openapps/app-manifest';
import {
  createAgentIdentity,
  createApp,
  grant,
  listDeployments,
  requestDeploy,
  type Actor,
  type Verb,
} from '../domain';
import { domainContext } from '../lib/runtime';

const OPERATOR: Actor = { kind: 'user', id: 'lokal-betreiber', groups: ['platform-admins'] };

const BETRIEB_RIGHTS: ReadonlyArray<{ verb: Verb; kind: 'app' | 'agent' | 'group' }> = [
  { verb: 'read', kind: 'app' },
  { verb: 'write', kind: 'app' },
  { verb: 'execute', kind: 'app' },
  { verb: 'read', kind: 'agent' },
  { verb: 'write', kind: 'agent' },
  { verb: 'read', kind: 'group' },
  { verb: 'write', kind: 'group' },
];

/** Etikett fuer den lokalen Stand: Pruefsumme ueber die Quelldateien. */
async function treeSha(dir: string): Promise<string> {
  const hash = createHash('sha1');
  const walk = async (current: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (['node_modules', '.next', '.turbo', 'dist'].includes(entry.name)) continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) hash.update(entry.name).update(await readFile(full));
    }
  };
  await walk(dir);
  return hash.digest('hex');
}

async function main(): Promise<void> {
  if (process.env.OPENAPPS_BACKEND !== 'lokal') {
    throw new Error('lokal-einrichten laeuft nur mit OPENAPPS_BACKEND=lokal');
  }
  const sourceDir = process.env.LOKAL_SOURCE_DIR ?? '/lokal/quellen';
  const ctx = domainContext();

  // 1. Apps registrieren und deployen.
  const names = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const name of names) {
    const dir = join(sourceDir, name);
    const manifest = parseAppManifest(JSON.parse(await readFile(join(dir, 'app.json'), 'utf8')));
    if ((await ctx.apps.findByName(name)) === null) {
      await createApp(ctx, { actor: OPERATOR, name, manifest });
      console.log(`App ${name}: angelegt`);
    }

    const gitSha = await treeSha(dir);
    const deployments = await listDeployments(ctx, { actor: OPERATOR, appIdOrName: name });
    const live = deployments.find((d) => d.status === 'live');
    if (live?.gitSha === gitSha) {
      console.log(`App ${name}: Stand ${gitSha.slice(0, 8)} ist schon live`);
      continue;
    }
    if (live?.version === manifest.version) {
      // Das Review-Gate verlangt, dass die Version zum Manifest passt, und
      // eine Version ist nur einmal live. Ein neuer Stand braucht also eine
      // neue Version in app.json — genau wie auf dem Server.
      console.log(
        `App ${name}: Stand geaendert, aber Version ${manifest.version} ist schon live — erhoehe "version" in app.json`,
      );
      continue;
    }
    const outcome = await requestDeploy(ctx, {
      actor: OPERATOR,
      appIdOrName: name,
      version: manifest.version,
      gitSha,
    });
    console.log(
      `App ${name}: ${outcome.deployment.status} (Review ${outcome.review.decision}, Gateway ${outcome.gateway.state})`,
    );
  }

  // 2. Der Betriebs-Agent.
  if ((await ctx.agents.findByName('betrieb')) === null) {
    const created = await createAgentIdentity(ctx, {
      actor: OPERATOR,
      name: 'betrieb',
      displayName: 'Betrieb (lokal)',
    });
    for (const right of BETRIEB_RIGHTS) {
      await grant(ctx, {
        actor: OPERATOR,
        subject: { kind: 'agent', id: 'betrieb' },
        verb: right.verb,
        resource: { kind: right.kind, id: '*' },
      });
    }
    console.log('Agent betrieb: angelegt, Rechte wie platform-admins');
    console.log(`BETRIEB_TOKEN=${created.token}`);
  } else {
    console.log('Agent betrieb: gibt es schon (Token wird nicht neu ausgegeben)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
