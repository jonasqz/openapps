/**
 * Die Scanner als Prozessaufruf. Das ist die Stelle, die im Gerüst ein Stub
 * sein darf: `ScannerProcess` hat eine klare Schnittstelle, und das Lesen der
 * Ausgabe sowie die Zusammenfuehrung im Gate sind echt.
 *
 * Laeuft der Scanner nicht, liefert diese Implementierung einen Exit-Code
 * ausserhalb von 0/1 — und das Gate blockiert. Fehlende Pruefung ist keine
 * bestandene Pruefung.
 */

import { spawn } from 'node:child_process';
import type { ScannerOutput, ScannerProcess } from '../domain/review-gate/types';

export interface CommandScannerOptions {
  readonly command: string;
  readonly args: (repoDir: string) => readonly string[];
  readonly timeoutMs?: number;
}

export function createCommandScanner(options: CommandScannerOptions): ScannerProcess {
  return {
    async run({ repoDir }): Promise<ScannerOutput> {
      return runCommand(options.command, options.args(repoDir), repoDir, options.timeoutMs ?? 120_000);
    },
  };
}

/** gitleaks mit JSON-Bericht auf stdout. */
export function gitleaksScanner(binary = 'gitleaks'): ScannerProcess {
  return createCommandScanner({
    command: binary,
    args: (repoDir) => ['detect', '--no-banner', '--report-format', 'json', '--report-path', '-', '--source', repoDir],
  });
}

/** semgrep mit der Sicherheits-Regelmenge. */
export function semgrepScanner(binary = 'semgrep'): ScannerProcess {
  return createCommandScanner({
    command: binary,
    args: (repoDir) => ['--config', 'p/security-audit', '--json', '--quiet', repoDir],
  });
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<ScannerOutput> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      stderr += `\nAbbruch nach ${timeoutMs} ms`;
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      // Nicht installiert, nicht ausfuehrbar: Code 127, damit das Gate blockiert.
      resolve({ exitCode: 127, stdout: '', stderr: `${error.message}${stderr}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}
