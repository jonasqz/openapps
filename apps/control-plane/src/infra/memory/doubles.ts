/**
 * Test- und Entwicklungs-Doubles fuer die Anschluesse, hinter denen echte
 * Infrastruktur steht. Sie tun nichts, merken sich aber, was von ihnen verlangt
 * wurde — damit ein Test belegen kann, dass die Domaene sie ueberhaupt ruft.
 */

import type {
  AlarmSink,
  BackendDeployResult,
  BackendStatus,
  CreatedRepository,
  DeploymentBackend,
  AppGatewayFacts,
  AppGatewayFactsReading,
  GatewayConfigStore,
  GatewayConfigVerification,
  NewRepositorySpec,
  RepositoryCheckout,
  RepositoryCheckoutRequest,
  PlatformAlarm,
  RepositoryBackend,
  SchemaProvisioner,
} from '../../domain/ports';
import type { GatewayDynamicConfig } from '../../domain/gateway-config';
import type { ScannerOutput, ScannerProcess } from '../../domain/review-gate/types';

export interface RecordingBackend extends DeploymentBackend {
  readonly calls: readonly { method: string; args: readonly unknown[] }[];
}

export interface RecordingBackendOptions {
  readonly deployOk?: boolean;
  readonly rollbackOk?: boolean;
  /**
   * Was `readAppGatewayFacts` liefert. Default ist der gute Fall nach
   * ADR 0008: keine Labels, kein Host-Port, keine Domain. `'unreachable'`
   * steht fuer „wir wissen nichts".
   */
  readonly appGatewayFacts?: Partial<AppGatewayFacts> | 'unreachable';
}

/** Der gute Fall: Coolify hat der App keinen eigenen Weg nach innen gegeben. */
export const NO_OWN_ROUTER: AppGatewayFacts = { labels: {}, portsMappings: '', domains: '' };

export function createRecordingBackend(options?: RecordingBackendOptions): RecordingBackend {
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const deployOk = options?.deployOk ?? true;
  const rollbackOk = options?.rollbackOk ?? true;
  const note = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };

  return {
    calls,
    async createApp(spec) {
      note('createApp', spec);
      return { backendRef: `ref-${spec.appName}` };
    },
    async setEnv(ref, env) {
      note('setEnv', ref, Object.keys(env));
    },
    async deploy(request): Promise<BackendDeployResult> {
      note('deploy', request);
      return { backendRef: request.backendRef, ok: deployOk };
    },
    async status(ref): Promise<BackendStatus> {
      note('status', ref);
      return 'running';
    },
    async rollback(ref, gitSha): Promise<BackendDeployResult> {
      note('rollback', ref, gitSha);
      return { backendRef: ref, ok: rollbackOk };
    },
    async readAppGatewayFacts(ref): Promise<AppGatewayFactsReading> {
      note('readAppGatewayFacts', ref);
      const override = options?.appGatewayFacts;
      if (override === 'unreachable') {
        return { state: 'unreachable', reason: 'Backend im Test absichtlich nicht erreichbar' };
      }
      return { state: 'read', facts: { ...NO_OWN_ROUTER, ...(override ?? {}) } };
    },
  };
}

export interface RecordingAlarmSink extends AlarmSink {
  readonly raised: readonly PlatformAlarm[];
  readonly cleared: readonly { kind: string; subject: string }[];
  /** Die offenen Alarme — erhoben und nicht wieder aufgehoben. */
  open(): readonly PlatformAlarm[];
}

/** Merkt sich Alarme, statt sie ins Log zu schreiben. */
export function createRecordingAlarmSink(): RecordingAlarmSink {
  const raised: PlatformAlarm[] = [];
  const cleared: { kind: string; subject: string }[] = [];
  const key = (kind: string, subject: string): string => `${kind}\u0000${subject}`;
  const openAlarms = new Map<string, PlatformAlarm>();

  return {
    raised,
    cleared,
    open: () => [...openAlarms.values()],
    raise(alarm) {
      raised.push(alarm);
      openAlarms.set(key(alarm.kind, alarm.subject), alarm);
    },
    clear(kind, subject) {
      cleared.push({ kind, subject });
      openAlarms.delete(key(kind, subject));
    },
  };
}

export interface RecordingProvisioner extends SchemaProvisioner {
  /** Was in Postgres wirklich freigegeben waere: `<rolle>@<schema>.<objekt>`. */
  readonly selectGrants: ReadonlySet<string>;
  readonly provisioned: readonly string[];
}

export function createRecordingProvisioner(): RecordingProvisioner {
  const selectGrants = new Set<string>();
  const provisioned: string[] = [];
  const key = (i: { grantee: string; schemaName: string; objectName: string }): string =>
    `${i.grantee}@${i.schemaName}.${i.objectName}`;

  return {
    selectGrants,
    provisioned,
    async provision({ schemaName, dbRole }) {
      provisioned.push(`${dbRole}@${schemaName}`);
      return { dsn: `postgres://${dbRole}@localhost/openapps?schema=${schemaName}` };
    },
    async grantSelect(input) {
      selectGrants.add(key(input));
    },
    async revokeSelect(input) {
      selectGrants.delete(key(input));
    },
  };
}

export interface RecordingRepositoryBackend extends RepositoryBackend {
  readonly created: readonly NewRepositorySpec[];
  /** Jeder geholte Commit, in Reihenfolge. */
  readonly checkouts: readonly RepositoryCheckoutRequest[];
  /** Verzeichnisse, die wieder weggeraeumt wurden. */
  readonly disposed: readonly string[];
}

/**
 * Legt kein Repo an, merkt sich aber, dass es gefragt wurde — und kann auf
 * Verlangen scheitern. Damit laesst sich pruefen, dass `create_app` nichts
 * registriert, wenn das Repo nicht entsteht.
 */
export function createRecordingRepositoryBackend(options?: {
  failWith?: string;
  failCheckoutWith?: string;
}): RecordingRepositoryBackend {
  const created: NewRepositorySpec[] = [];
  const checkouts: RepositoryCheckoutRequest[] = [];
  const disposed: string[] = [];
  return {
    created,
    checkouts,
    disposed,
    async checkout(request): Promise<RepositoryCheckout> {
      if (options?.failCheckoutWith !== undefined) {
        throw new Error(options.failCheckoutWith);
      }
      checkouts.push(request);
      // Kein echtes Verzeichnis: Die Scanner sind in diesen Tests ebenfalls
      // Doubles und lesen nichts von der Platte.
      const dir = `/checkout.test/${request.gitSha}`;
      return {
        dir,
        async dispose() {
          disposed.push(dir);
        },
      };
    },
    async createFromTemplate(spec): Promise<CreatedRepository> {
      if (options?.failWith !== undefined) {
        throw new Error(options.failWith);
      }
      created.push(spec);
      return {
        gitUrl: `https://git.test/openapps/${spec.appName}.git`,
        tag: 'v0.0.0',
        webUrl: `https://git.test/openapps/${spec.appName}`,
      };
    },
  };
}

/** Ein Scanner, der eine feste Ausgabe liefert. Fuer Tests des Review-Gates. */
export function createFixedScanner(output: ScannerOutput): ScannerProcess {
  return {
    async run() {
      return output;
    },
  };
}

/** Ein Scanner, der sauber meldet: nichts gefunden. */
export function createCleanScanner(shape: 'gitleaks' | 'semgrep'): ScannerProcess {
  return createFixedScanner({
    exitCode: 0,
    stdout: shape === 'gitleaks' ? '[]' : '{"results": [], "errors": []}',
  });
}

/** Ein Scanner, der scheitert — damit ein Test "faellt zu" belegen kann. */
export function createBrokenScanner(): ScannerProcess {
  return createFixedScanner({ exitCode: 2, stdout: '', stderr: 'Scanner nicht installiert' });
}

/* -------------------------------------------------------------------------- */
/* Die Gateway-Konfiguration                                                   */
/* -------------------------------------------------------------------------- */

export interface RecordingGatewayConfigStore extends GatewayConfigStore {
  /** Jede veroeffentlichte Fassung, in der Reihenfolge der Aufrufe. */
  readonly published: readonly GatewayDynamicConfig[];
  /** Die letzte veroeffentlichte Fassung, oder `undefined`. */
  last(): GatewayDynamicConfig | undefined;
}

export interface RecordingGatewayConfigStoreOptions {
  /**
   * Was `verify` sagt. Default: Es stimmt, was veroeffentlicht wurde — dann
   * prueft der Test die Domaenenlogik und nicht den Vergleich.
   */
  readonly verification?: GatewayConfigVerification;
  /** Soll `publish` scheitern? Fuer den Fall „Datei nicht schreibbar". */
  readonly publishFailsWith?: string;
}

/**
 * Merkt sich die veroeffentlichte Konfiguration, statt sie zu schreiben. Damit
 * kann ein Test die **ganze** Ausgabe des Generators durchgehen, so wie sie im
 * Betrieb entsteht.
 */
export function createRecordingGatewayConfigStore(
  options: RecordingGatewayConfigStoreOptions = {},
): RecordingGatewayConfigStore {
  const published: GatewayDynamicConfig[] = [];
  return {
    published,
    last: () => published[published.length - 1],
    async publish(config) {
      if (options.publishFailsWith !== undefined) {
        throw new Error(options.publishFailsWith);
      }
      published.push(config);
    },
    async verify(config): Promise<GatewayConfigVerification> {
      if (options.verification !== undefined) return options.verification;
      const last = published[published.length - 1];
      if (last === undefined) {
        return { state: 'mismatch', problems: ['es wurde nie eine Konfiguration veroeffentlicht'] };
      }
      // Strukturell und nicht als Referenz: `gatewayConfigFor` erzeugt die
      // Konfiguration vor und nach dem Deploy neu, und zwei gleiche
      // Konfigurationen sind zwei verschiedene Objekte.
      return JSON.stringify(last) === JSON.stringify(config)
        ? { state: 'match' }
        : { state: 'mismatch', problems: ['die veroeffentlichte Fassung ist eine andere'] };
    },
  };
}
