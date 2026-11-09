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

import type { GatewayLabelLint } from '../ports';
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
  /**
   * Wohin dieser Deploy ans Gateway gehaengt wuerde. Fehlt die Angabe, kann
   * der Label-Lint nichts pruefen — und blockiert dann, statt durchzulassen.
   */
  readonly gateway?: GatewayReviewTarget;
}

/**
 * Das Gateway-Ziel dieses Deploys, so weit die Control Plane es **vor** dem
 * Deploy kennt. Der Port steht nicht hier: er kommt aus dem Manifest der
 * Arbeitskopie (`domain/app-port.ts`) und ist genau einer der Werte, die der
 * Schritt pruefen soll.
 */
export interface GatewayReviewTarget {
  readonly appName: string;
  /** `null`, solange keine Domain vergeben ist — dann gibt es keinen Router. */
  readonly domain: string | null;
}

export interface CodeFacts {
  readonly tables: readonly string[];
  readonly tools: readonly string[];
  readonly envVars: readonly string[];
  /** Ausgehende Netzwerkziele, die im Code vorkommen. */
  readonly outboundHosts?: readonly string[];
  /**
   * Host-Ports, die die Arbeitskopie veroeffentlichen will — `ports:` in einer
   * `docker-compose.yml`, `-p` in einem Startskript. Spec 3.3 erlaubt keinen
   * einzigen: Ein veroeffentlichter Port macht den Container am Gateway vorbei
   * erreichbar, und dann ist das Signatur-Modell aus 3.2 wertlos.
   *
   * `undefined` heisst **nicht** „keine" — es heisst „nicht erhoben". Der
   * Unterschied steht im Befund `gateway.container_facts_unknown`.
   */
  readonly publishedPorts?: readonly string[];
  /**
   * Docker-Netze, in die die Arbeitskopie den Container legen will. Spec 3.3:
   * nur das Gateway-Netz, kein zweites. Wie bei `publishedPorts` ist
   * `undefined` „nicht erhoben".
   */
  readonly dockerNetworks?: readonly string[];
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

/**
 * Der Label-Lint als Anschluss des Gates. Er liegt in der Adapter-Schicht,
 * weil nur sie weiss, wie ein Label aussieht; was vollstaendig **bedeutet**,
 * beurteilt der Schritt.
 */
export type { GatewayLabelLint };

/** Der Claude-Report. Advisory, immer. */
export interface ClaudeReviewer {
  review(input: ReviewInput): Promise<{ summary: string; findings: readonly Finding[] }>;
}
