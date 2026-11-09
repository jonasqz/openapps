/**
 * Tool-Paritaet — "Agents first" als Pruefung: jede UI-Aktion braucht ein
 * MCP-Tool (docs/01-architektur.md). Fehlt ein Tool, blockiert der Deploy.
 *
 * Diese Logik ist echt, kein Stub. Was gestubbt ist, ist das Einsammeln der
 * UI-Aktionen aus dem Code; es kommt als `input.uiActions` herein.
 */

import type { Finding, ReviewInput, ReviewStep, StepResult } from '../types';

export const TOOL_PARITY_STEP = 'tool-parity';

export function toolParityStep(): ReviewStep {
  return {
    name: TOOL_PARITY_STEP,
    kind: 'deterministic',
    async run(input: ReviewInput): Promise<StepResult> {
      return {
        step: TOOL_PARITY_STEP,
        kind: 'deterministic',
        findings: checkToolParity(input),
      };
    },
  };
}

export function checkToolParity(input: ReviewInput): readonly Finding[] {
  const manifestTools = new Set(input.manifest.offeredTools.map((t) => t.name));
  const codeTools = new Set(input.codeFacts.tools);
  const findings: Finding[] = [];

  for (const action of input.uiActions) {
    if (!manifestTools.has(action)) {
      findings.push({
        step: TOOL_PARITY_STEP,
        severity: 'blocking',
        code: 'parity.missing_tool',
        message: `UI-Aktion "${action}" hat kein MCP-Tool im Manifest`,
      });
    } else if (!codeTools.has(action)) {
      findings.push({
        step: TOOL_PARITY_STEP,
        severity: 'blocking',
        code: 'parity.tool_not_implemented',
        message: `Tool "${action}" steht im Manifest, ist im Code aber nicht angeboten`,
      });
    }
  }

  return findings;
}
