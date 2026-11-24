/**
 * Der lokale Betrieb: Deploy- und Repo-Backend fuer einen Rechner ohne Coolify
 * und ohne GitHub (`infra/lokal/`, ADR 0011).
 *
 * Was hier anders ist als auf dem Server, und was gleich bleibt:
 *
 * - **Gleich:** Der Deploy laeuft durch dieselbe Domaene — Freigabe pruefen,
 *   Review-Gate mit echten Scannern, Schema und Rolle anlegen, Env setzen,
 *   Gateway-Konfiguration schreiben. Nichts davon wird hier abgekuerzt.
 * - **Anders:** Die App-Container baut nicht das Backend, sondern
 *   `docker compose` vorab, je einer pro Standard-App. Sie warten, bis die
 *   Control Plane ihnen Env und Startsignal in ein gemeinsames Verzeichnis
 *   legt (`infra/lokal/app-start.mjs`). Eine App startet also auch lokal nie
 *   mit einer Env, die nicht von der Control Plane kommt.
 * - **Anders:** Der Quelltext kommt aus einem eingebundenen Verzeichnis
 *   (`https://lokal.invalid/<app>`), nicht aus Git. Der Commit-Hash ist lokal nur ein
 *   Etikett; geprueft wird der Stand auf der Platte.
 *
 * Dieser Adapter ist absichtlich nur ueber `OPENAPPS_BACKEND=lokal`
 * erreichbar (`src/lib/runtime.ts`). Ohne die Variable bleibt alles bei
 * Coolify und GitHub.
 */

import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AppGatewayFactsReading,
  BackendAppSpec,
  BackendDeployRequest,
  BackendDeployResult,
  BackendStatus,
  CreatedRepository,
  DeploymentBackend,
  NewRepositorySpec,
  RepositoryBackend,
  RepositoryCheckout,
  RepositoryCheckoutRequest,
} from '../../domain/ports';

export interface LokalConfig {
  /** Gemeinsames Verzeichnis mit den App-Containern: `<dir>/<app>/env.json`. */
  readonly runtimeDir: string;
  /** Eingebundene Quellen der Standard-Apps: `<dir>/<app>/app.json`. */
  readonly sourceDir: string;
  /** Wie lange `deploy` auf die erste Antwort der App wartet. */
  readonly startTimeoutMs?: number;
}

const APP_NAME = /^[a-z][a-z0-9-]{1,40}$/;
const REF_PREFIX = 'lokal:';
/**
 * Lokale Quelle in einer Form, die das Manifest-Schema annimmt (https:// oder
 * git@). `.invalid` ist nach RFC 2606 garantiert keine echte Domain: Es kann
 * nie versehentlich etwas von aussen geholt werden.
 */
const GIT_PREFIX = 'https://lokal.invalid/';

export function lokalConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LokalConfig {
  const runtimeDir = env.LOKAL_RUNTIME_DIR;
  const sourceDir = env.LOKAL_SOURCE_DIR;
  if (
    runtimeDir === undefined ||
    runtimeDir === '' ||
    sourceDir === undefined ||
    sourceDir === ''
  ) {
    throw new Error('OPENAPPS_BACKEND=lokal braucht LOKAL_RUNTIME_DIR und LOKAL_SOURCE_DIR');
  }
  return { runtimeDir, sourceDir };
}

function appNameFromRef(backendRef: string): string {
  const name = backendRef.startsWith(REF_PREFIX) ? backendRef.slice(REF_PREFIX.length) : '';
  if (!APP_NAME.test(name)) throw new Error(`unbekannte lokale Referenz "${backendRef}"`);
  return name;
}

interface Spec {
  readonly appName: string;
  readonly networkAlias: string;
  readonly port: number;
}

export function createLokalBackend(config: LokalConfig): DeploymentBackend {
  const appDir = (name: string): string => join(config.runtimeDir, name);
  const specs = new Map<string, Spec>();

  const specFor = async (name: string): Promise<Spec> => {
    const known = specs.get(name);
    if (known !== undefined) return known;
    // Nach einem Neustart der Control Plane: aus der Datei, die createApp schrieb.
    const spec = JSON.parse(await readFile(join(appDir(name), 'spec.json'), 'utf8')) as Spec;
    specs.set(name, spec);
    return spec;
  };

  /**
   * Antwortet die App? Gefragt wird ihr Tool-Endpunkt **ohne** Signatur, und
   * die erwartete Antwort ist 401: Genau das heisst, sie laeuft und prueft.
   * Eine 200 hier waere eine App, die Unsigniertes bedient.
   */
  const probe = async (name: string): Promise<boolean> => {
    const spec = await specFor(name);
    try {
      const response = await fetch(
        `http://${spec.networkAlias}:${spec.port}/${name}/api/tools/openapps.probe`,
        { method: 'POST', signal: AbortSignal.timeout(3_000), redirect: 'manual' },
      );
      return response.status === 401;
    } catch {
      return false;
    }
  };

  const writeSignal = async (name: string, gitSha: string): Promise<void> => {
    await writeFile(
      join(appDir(name), 'deploy.json'),
      JSON.stringify({ gitSha, at: new Date().toISOString() }),
      { mode: 0o600 },
    );
  };

  const waitUntilUp = async (name: string): Promise<boolean> => {
    const deadline = Date.now() + (config.startTimeoutMs ?? 120_000);
    while (Date.now() < deadline) {
      if (await probe(name)) return true;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return false;
  };

  return {
    async createApp(spec: BackendAppSpec) {
      if (!APP_NAME.test(spec.appName)) throw new Error(`ungueltiger App-Name "${spec.appName}"`);
      // Nur Apps, fuer die es lokal einen Container gibt. Alles andere waere
      // ein Deploy, der nie antwortet.
      await stat(join(config.sourceDir, spec.appName, 'app.json')).catch(() => {
        throw new Error(`lokal gibt es keine App "${spec.appName}" in ${config.sourceDir}`);
      });
      const record: Spec = {
        appName: spec.appName,
        networkAlias: spec.networkAlias,
        port: spec.port,
      };
      await mkdir(appDir(spec.appName), { recursive: true, mode: 0o700 });
      await writeFile(join(appDir(spec.appName), 'spec.json'), JSON.stringify(record), {
        mode: 0o600,
      });
      specs.set(spec.appName, record);
      return { backendRef: `${REF_PREFIX}${spec.appName}` };
    },

    async setEnv(backendRef, env) {
      const name = appNameFromRef(backendRef);
      await mkdir(appDir(name), { recursive: true, mode: 0o700 });
      // Lokal mit Beispieldaten (`runSeeds` im SDK); auf dem Server setzt das
      // niemand, und eine frische App bleibt leer.
      const withSamples = { ...env, OPENAPPS_SAMPLE_DATA: '1' };
      // 0600: Die DSN mit Passwort und das App-Secret stehen darin.
      await writeFile(join(appDir(name), 'env.json'), JSON.stringify(withSamples), {
        mode: 0o600,
      });
    },

    async deploy(request: BackendDeployRequest): Promise<BackendDeployResult> {
      const name = appNameFromRef(request.backendRef);
      await writeSignal(name, request.gitSha);
      const up = await waitUntilUp(name);
      return up
        ? { backendRef: request.backendRef, ok: true }
        : {
            backendRef: request.backendRef,
            ok: false,
            message: `App "${name}" hat nach dem Startsignal nicht geantwortet`,
          };
    },

    async status(backendRef): Promise<BackendStatus> {
      return (await probe(appNameFromRef(backendRef))) ? 'running' : 'stopped';
    },

    async rollback(backendRef, gitSha) {
      // Lokal gibt es nur den Stand auf der Platte. Der Rollback setzt das
      // Signal, damit der Ablauf in der Domaene derselbe bleibt — mehr kann er
      // hier nicht, und das steht in der Antwort.
      const name = appNameFromRef(backendRef);
      await writeSignal(name, gitSha);
      return {
        backendRef,
        ok: await probe(name),
        message: 'lokal: nur das Etikett gewechselt, der Container bleibt derselbe',
      };
    },

    async readAppGatewayFacts(): Promise<AppGatewayFactsReading> {
      // Ohne Docker-Socket gibt es hier nichts zu messen. „Nicht erreichbar"
      // ist ehrlich und macht laut Domaene **keinen** Befund — eine
      // erfundene leere Messung waere eine Behauptung, die wie ein Nachweis
      // aussieht.
      return {
        state: 'unreachable',
        reason: 'lokaler Betrieb: kein Backend-Inventar (die Container stehen in infra/lokal)',
      };
    },
  };
}

export function createLokalRepositoryBackend(config: LokalConfig): RepositoryBackend {
  return {
    async createFromTemplate(spec: NewRepositorySpec): Promise<CreatedRepository> {
      if (!APP_NAME.test(spec.appName)) throw new Error(`ungueltiger App-Name "${spec.appName}"`);
      await stat(join(config.sourceDir, spec.appName, 'app.json')).catch(() => {
        throw new Error(
          `lokal lassen sich nur vorhandene Apps anlegen (${config.sourceDir}/${spec.appName} fehlt)`,
        );
      });
      return { gitUrl: `${GIT_PREFIX}${spec.appName}`, tag: 'lokal' };
    },

    async checkout(input: RepositoryCheckoutRequest): Promise<RepositoryCheckout> {
      const name = input.gitUrl.startsWith(GIT_PREFIX) ? input.gitUrl.slice(GIT_PREFIX.length) : '';
      if (!APP_NAME.test(name)) {
        throw new Error(`lokal nur https://lokal.invalid/<app>, nicht "${input.gitUrl}"`);
      }
      const root = await mkdtemp(join(tmpdir(), 'openapps-checkout-'));
      const dir = join(root, name);
      const dispose = async (): Promise<void> => {
        await rm(root, { recursive: true, force: true });
      };
      try {
        // Ohne Bauartefakte: Die Scanner sollen den Quelltext lesen, nicht
        // `node_modules` oder `.next`.
        const skip = new Set(['node_modules', '.next', '.turbo', 'dist']);
        await cp(join(config.sourceDir, name), dir, {
          recursive: true,
          filter: (source) => !source.split('/').some((part) => skip.has(part)),
        });
        if ((await readdir(dir)).length === 0) throw new Error('leeres Verzeichnis');
        return { dir, dispose };
      } catch (error) {
        await dispose();
        throw error;
      }
    },
  };
}
