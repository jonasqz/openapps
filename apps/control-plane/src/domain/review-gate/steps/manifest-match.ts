/**
 * Manifest-Abgleich — das Manifest muss zum Code passen (AGENTS.md, Regel 4).
 * Ein Code, der eine Tabelle nutzt, die nicht im Manifest steht, umgeht die
 * Schema-Planung; ein Manifest, das Tabellen fuehrt, die es nicht gibt, laesst
 * Rechte offen, die niemand braucht.
 *
 * Echte Vergleichslogik; das Einsammeln der Tatsachen aus dem Code kommt als
 * `input.codeFacts` herein.
 */

import type { Finding, ReviewInput, ReviewStep, StepResult } from '../types';

export const MANIFEST_MATCH_STEP = 'manifest-match';

export function manifestMatchStep(): ReviewStep {
  return {
    name: MANIFEST_MATCH_STEP,
    kind: 'deterministic',
    async run(input: ReviewInput): Promise<StepResult> {
      return {
        step: MANIFEST_MATCH_STEP,
        kind: 'deterministic',
        findings: checkManifestMatch(input),
      };
    },
  };
}

export function checkManifestMatch(input: ReviewInput): readonly Finding[] {
  const findings: Finding[] = [];
  const manifestTables = new Set(input.manifest.requiredTables.map((t) => t.name));
  const manifestTools = new Set(input.manifest.offeredTools.map((t) => t.name));
  // Im Manifest ist eine Env-Variable ein Objekt (Name, secret, Beschreibung);
  // aus dem Code kommt nur der Name.
  const manifestEnv = new Set(input.manifest.env.map((e) => e.name));

  for (const table of input.codeFacts.tables) {
    if (!manifestTables.has(table)) {
      findings.push({
        step: MANIFEST_MATCH_STEP,
        severity: 'blocking',
        code: 'manifest.undeclared_table',
        message: `code uses table "${table}", but the manifest does not list it`,
      });
    }
  }
  for (const table of manifestTables) {
    if (!input.codeFacts.tables.includes(table)) {
      findings.push({
        step: MANIFEST_MATCH_STEP,
        severity: 'warning',
        code: 'manifest.unused_table',
        message: `manifest lists table "${table}", but the code does not use it`,
      });
    }
  }
  for (const tool of input.codeFacts.tools) {
    if (!manifestTools.has(tool)) {
      findings.push({
        step: MANIFEST_MATCH_STEP,
        severity: 'blocking',
        code: 'manifest.undeclared_tool',
        message: `code offers tool "${tool}", but the manifest does not list it`,
      });
    }
  }
  for (const env of input.codeFacts.envVars) {
    if (!manifestEnv.has(env)) {
      findings.push({
        step: MANIFEST_MATCH_STEP,
        severity: 'blocking',
        code: 'manifest.undeclared_env',
        message: `code reads env variable "${env}", but the manifest does not declare it`,
      });
    }
  }
  if (input.manifest.version !== input.version) {
    findings.push({
      step: MANIFEST_MATCH_STEP,
      severity: 'blocking',
      code: 'manifest.version_mismatch',
      message: `manifest version "${input.manifest.version}" does not match the requested version "${input.version}"`,
    });
  }
  return findings;
}
