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
 * 3. Es erteilt die Freigaben, die eine App im Manifest **fuer sich selbst**
 *    als App beantragt (`requestedGrants` mit `subjectKind: app` und dem
 *    eigenen Namen, ADR 0020), etwa dem Wiki das Abliefern an Knowledge.
 *    Nur lokal: Auf dem Server erteilt sie ein Mensch oder Agent mit `grant`.
 *    Antraege fuer Gruppen, Menschen oder Agents erteilt es nicht.
 * 4. Es legt den Agenten `operator` an und gibt ihm die Rechte, die die Gruppe
 *    `platform-admins` hat. Alles Weitere — Arbeits-Agents, Freigaben — macht
 *    `operator` dann ueber den Plattform-MCP, wie jeder andere Agent.
 *
 * Das Token von `operator` erscheint genau einmal, auf stdout, als letzte
 * Zeile `OPERATOR_TOKEN=…`. Das Host-Skript schreibt es in eine Datei mit
 * Modus 0600 und zeigt es nicht an. Ein zweiter Lauf legt nichts doppelt an
 * und gibt kein neues Token aus.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAppManifest } from '@openapps/app-manifest';
import type { AppManifest } from '@openapps/app-manifest';
import {
  createAgentIdentity,
  createApp,
  grant,
  listDeployments,
  requestDeploy,
  type Actor,
  type Verb,
} from '../domain';
import { grantSelfRequests } from './lokal-freigaben';
import { domainContext } from '../lib/runtime';

const OPERATOR: Actor = { kind: 'user', id: 'lokal-betreiber', groups: ['platform-admins'] };

const OPERATOR_RIGHTS: ReadonlyArray<{ verb: Verb; kind: 'app' | 'agent' | 'group' }> = [
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
    throw new Error('lokal-einrichten only runs with OPENAPPS_BACKEND=lokal');
  }
  const sourceDir = process.env.LOKAL_SOURCE_DIR ?? '/lokal/quellen';
  const ctx = domainContext();

  // 1. Apps registrieren und deployen.
  const names = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const manifests: AppManifest[] = [];
  for (const name of names) {
    const dir = join(sourceDir, name);
    const manifest = parseAppManifest(JSON.parse(await readFile(join(dir, 'app.json'), 'utf8')));
    manifests.push(manifest);
    if ((await ctx.apps.findByName(name)) === null) {
      await createApp(ctx, { actor: OPERATOR, name, manifest });
      console.log(`App ${name}: created`);
    }

    const gitSha = await treeSha(dir);
    const deployments = await listDeployments(ctx, { actor: OPERATOR, appIdOrName: name });
    const live = deployments.find((d) => d.status === 'live');
    if (live?.gitSha === gitSha) {
      console.log(`App ${name}: state ${gitSha.slice(0, 8)} is already live`);
      continue;
    }
    if (live?.version === manifest.version) {
      // Das Review-Gate verlangt, dass die Version zum Manifest passt, und
      // eine Version ist nur einmal live. Ein neuer Stand braucht also eine
      // neue Version in app.json — genau wie auf dem Server.
      console.log(
        `App ${name}: source changed, but version ${manifest.version} is already live; bump "version" in app.json`,
      );
      continue;
    }
    const outcome = await requestDeploy(ctx, {
      actor: OPERATOR,
      appIdOrName: name,
      version: manifest.version,
      gitSha,
      // Das Manifest aus dem Quellordner, nicht das beim Anlegen gespeicherte:
      // Sonst prueft das Gate jede neue Version gegen die erste und blockt sie
      // (`manifest.version_mismatch`).
      manifest,
    });
    // `unreachable` heisst lokal nur: Der Adapter kann das Gateway nicht
    // messen (kein Backend-Inventar). Als Fehler gelesen, fuehrt es in die Irre.
    const gateway =
      outcome.gateway.state === 'unreachable' ? 'not measurable locally' : outcome.gateway.state;
    console.log(
      `App ${name}: ${outcome.deployment.status} (Review ${outcome.review.decision}, Gateway ${gateway})`,
    );
  }

  // 2. Freigaben, die Apps fuer sich selbst als App beantragen.
  await grantSelfRequests(ctx, OPERATOR, manifests);

  // 3. Der Betriebs-Agent.
  if ((await ctx.agents.findByName('operator')) === null) {
    const created = await createAgentIdentity(ctx, {
      actor: OPERATOR,
      name: 'operator',
      displayName: 'Operations (local)',
    });
    for (const right of OPERATOR_RIGHTS) {
      await grant(ctx, {
        actor: OPERATOR,
        subject: { kind: 'agent', id: 'operator' },
        verb: right.verb,
        resource: { kind: right.kind, id: '*' },
      });
    }
    console.log('Agent operator: created, same rights as platform-admins');
    console.log(`OPERATOR_TOKEN=${created.token}`);
  } else {
    console.log('Agent operator: already exists (token is not issued again)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  });
