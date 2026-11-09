/**
 * Test- und Entwicklungs-Doubles fuer die Anschluesse, hinter denen echte
 * Infrastruktur steht. Sie tun nichts, merken sich aber, was von ihnen verlangt
 * wurde — damit ein Test belegen kann, dass die Domaene sie ueberhaupt ruft.
 */

import type {
  BackendDeployResult,
  BackendStatus,
  DeploymentBackend,
  SchemaProvisioner,
} from '../../domain/ports';
import type { ScannerOutput, ScannerProcess } from '../../domain/review-gate/types';

export interface RecordingBackend extends DeploymentBackend {
  readonly calls: readonly { method: string; args: readonly unknown[] }[];
}

export function createRecordingBackend(
  options?: { deployOk?: boolean; rollbackOk?: boolean },
): RecordingBackend {
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
    async setDomain(ref, domain) {
      note('setDomain', ref, domain);
    },
    async ensureGateway(ref, spec) {
      note('ensureGateway', ref, spec);
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
