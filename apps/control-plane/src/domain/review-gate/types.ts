/**
 * Das Review-Gate: eine Pipeline aus Pruefschritten, die **alle** laufen und
 * deren Ergebnisse danach zusammengefuehrt werden.
 *
 * Der Unterschied, auf dem alles haengt:
 *
 * - `deterministic` — ein Scanner mit reproduzierbarem Ergebnis (gitleaks,
 *   semgrep, Linter, Paritaets- und Manifest-Abgleich). Ein blockierender
 *   Befund hier blockiert den Deploy. Ein Fehler hier blockiert ebenfalls:
 *   ein Scanner, der nicht lief, ist kein gruenes Ergebnis.
 * - `advisory` — ein Urteil ohne Beweis (der Claude-Report). Es darf Befunde
 *   melden, aber es kann nie freigeben und nie blockieren.
 *
 * Ein Claude-Review ist kein Sicherheitsbeweis (Brief, Risiken). Deshalb gibt
 * `mergeReview` nur `pass` zurueck, wenn mindestens ein deterministischer
 * Schritt tatsaechlich gelaufen ist.
 */

import type { AppManifest } from '../types';

export type StepKind = 'deterministic' | 'advisory';

export type Severity = 'info' | 'warning' | 'blocking';

export interface Finding {
  readonly step: string;
  readonly severity: Severity;
  /** Stabiler Code, z. B. 'gitleaks.secret', 'parity.missing_tool'. */
  readonly code: string;
  readonly message: string;
  readonly path?: string;
  readonly line?: number;
}

/** Was ein Schritt ueber den Code weiss, den er pruefen soll. */
export interface ReviewInput {
  readonly appId: string;
  readonly deploymentId: string;
  readonly version: string;
  readonly gitSha: string;
  /** Arbeitskopie des Repos, in der die Scanner laufen. */
  readonly repoDir: string;
  readonly manifest: AppManifest;
  /**
   * Aktionen, die die UI der App anbietet (aus der Analyse des Codes). Jede
   * braucht ein MCP-Tool — sonst blockiert der Paritaets-Schritt.
   */
  readonly uiActions: readonly string[];
  /** Aus dem Code gelesene Tatsachen, gegen die das Manifest geprueft wird. */
  readonly codeFacts: CodeFacts;
}

export interface CodeFacts {
  readonly tables: readonly string[];
  readonly tools: readonly string[];
  readonly envVars: readonly string[];
  /** Ausgehende Netzwerkziele, die im Code vorkommen. */
  readonly outboundHosts?: readonly string[];
}

export interface StepResult {
  readonly step: string;
  readonly kind: StepKind;
  readonly findings: readonly Finding[];
  /**
   * Der Schritt lief nicht, weil es (noch) keine Regeln gibt. Ein uebersprungener
   * Schritt blockiert nicht — anders als ein fehlgeschlagener.
   */
  readonly skipped?: boolean;
  /** Der Schritt ist gescheitert. Bei `deterministic` blockiert das. */
  readonly error?: string;
  readonly durationMs?: number;
}

export interface ReviewStep {
  readonly name: string;
  readonly kind: StepKind;
  run(input: ReviewInput): Promise<StepResult>;
}

export type ReviewDecision = 'pass' | 'blocked';

export interface ReviewResult {
  readonly decision: ReviewDecision;
  readonly steps: readonly StepResult[];
  readonly findings: readonly Finding[];
  readonly blockingFindings: readonly Finding[];
  readonly summary: string;
  readonly ranAt: string;
}

export interface ReviewPipeline {
  readonly steps: readonly ReviewStep[];
  run(input: ReviewInput): Promise<ReviewResult>;
}

/* -------------------------------------------------------------------------- */
/* Anschluesse der Schritte                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Ein externer Scanner-Prozess. Nur diese Schnittstelle ist in v1 ein Stub;
 * das Lesen der Ausgabe und die Zusammenfuehrung sind echt.
 */
export interface ScannerProcess {
  /** Fuehrt den Scanner im Repo aus und liefert seine rohe Ausgabe. */
  run(input: { repoDir: string }): Promise<ScannerOutput>;
}

export interface ScannerOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr?: string;
}

/** Der Claude-Report. Advisory, immer. */
export interface ClaudeReviewer {
  review(input: ReviewInput): Promise<{ summary: string; findings: readonly Finding[] }>;
}
