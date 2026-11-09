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
  GatewayLabelLint,
  GatewayLabelReading,
  NewRepositorySpec,
  PlatformAlarm,
  RepositoryBackend,
  SchemaProvisioner,
} from '../../domain/ports';
import type { ScannerOutput, ScannerProcess } from '../../domain/review-gate/types';

export interface RecordingBackend extends DeploymentBackend {
  readonly calls: readonly { method: string; args: readonly unknown[] }[];
}

export interface RecordingBackendOptions {
  readonly deployOk?: boolean;
  readonly rollbackOk?: boolean;
  /**
   * Der Lint, mit dem das Double die Labels erzeugt, die `ensureGateway`
   * gesetzt haette. Damit liest `readGatewayLabels` im Normalfall genau das
   * zurueck, was ein funktionierendes Backend zeigen wuerde — und ein Test,
   * der einen Befund will, nimmt `gatewayLabels`.
   */
  readonly lint?: GatewayLabelLint;
  /**
   * Was `readGatewayLabels` liefert, ungeachtet dessen, was gesetzt wurde:
   * ein eigener Label-Satz, eine Aenderung des gesetzten Satzes, oder
   * `'unreachable'` fuer „wir wissen nichts".
   */
  readonly gatewayLabels?:
    | Readonly<Record<string, string>>
    | 'unreachable'
    | ((set: Readonly<Record<string, string>>) => Readonly<Record<string, string>>);
}

export function createRecordingBackend(options?: RecordingBackendOptions): RecordingBackend {
  const calls: { method: string; args: readonly unknown[] }[] = [];
  const deployOk = options?.deployOk ?? true;
  const rollbackOk = options?.rollbackOk ?? true;
  /** Was pro Backend-Referenz zuletzt ans Gateway gegeben wurde. */
  const labelsByRef = new Map<string, Readonly<Record<string, string>>>();
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
    async setDomain(ref, domain) {
      note('setDomain', ref, domain);
    },
    async ensureGateway(ref, spec) {
      note('ensureGateway', ref, spec);
      if (options?.lint !== undefined) {
        labelsByRef.set(ref, options.lint.plan(spec).labels);
      }
    },
    async readGatewayLabels(ref): Promise<GatewayLabelReading> {
      note('readGatewayLabels', ref);
      const override = options?.gatewayLabels;
      if (override === 'unreachable') {
        return { state: 'unreachable', reason: 'Backend im Test absichtlich nicht erreichbar' };
      }
      const set = labelsByRef.get(ref) ?? {};
      if (typeof override === 'function') {
        return { state: 'read', labels: override(set) };
      }
      if (override !== undefined) {
        return { state: 'read', labels: override };
      }
      // Kein Lint und kein Vorgabewert: Dann hat dieses Double nie Labels
      // gesehen und sagt das, statt einen leeren Satz als Messung auszugeben.
      if (options?.lint === undefined) {
        return { state: 'unreachable', reason: 'dieses Double kennt keine Labels' };
      }
      return { state: 'read', labels: set };
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
}

/**
 * Legt kein Repo an, merkt sich aber, dass es gefragt wurde — und kann auf
 * Verlangen scheitern. Damit laesst sich pruefen, dass `create_app` nichts
 * registriert, wenn das Repo nicht entsteht.
 */
export function createRecordingRepositoryBackend(options?: {
  failWith?: string;
}): RecordingRepositoryBackend {
  const created: NewRepositorySpec[] = [];
  return {
    created,
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
