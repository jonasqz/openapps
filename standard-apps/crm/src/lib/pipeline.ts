import { OPEN_STAGES, STAGES, STAGE_PROBABILITY, type Stage } from './domain';

/**
 * Die Pipeline-Rechnung als reine Funktion. Die Datenbank liefert je Stage
 * Anzahl und Summe (Summe als Text, weil `sum(bigint)` in Postgres `numeric`
 * ist und `pg` das nicht in eine JS-Zahl presst); alles Weitere passiert hier,
 * in BigInt, damit nichts unterwegs rundet.
 */

export interface StageAggregate {
  stage: string;
  count: number | string;
  sumCents: number | string | bigint;
}

export interface StageSummary {
  stage: Stage;
  count: number;
  sumCents: number;
  /** Abschlusswahrscheinlichkeit in Prozent. */
  probability: number;
  /** sumCents * probability / 100, kaufmaennisch auf ganze Cent gerundet. */
  weightedCents: number;
}

export interface PipelineSummary {
  stages: StageSummary[];
  totals: {
    count: number;
    openCount: number;
    openSumCents: number;
    /** Gewichtete Summe der offenen Deals (lead, qualified, proposal). */
    weightedOpenCents: number;
    wonCents: number;
    lostCents: number;
  };
}

/** Wirft, wenn der Wert nicht als sichere ganze JS-Zahl darstellbar ist. */
export function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`amount ${value} is too large for a JSON number`);
  }
  return Number(value);
}

/** Ganze, nicht negative Zahl aus Datenbank-Text, Zahl oder BigInt. */
function toBigInt(value: number | string | bigint, what: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`${what}: ${value} is not a whole number`);
    return BigInt(value);
  }
  if (!/^-?\d+$/.test(value.trim())) throw new RangeError(`${what}: "${value}" is not a whole number`);
  return BigInt(value.trim());
}

/** a * percent / 100, halbe Cent aufgerundet (Betraege sind nie negativ). */
export function weightCents(cents: bigint, percent: number): bigint {
  const scaled = cents * BigInt(percent);
  return (scaled + 50n) / 100n;
}

export function summarizePipeline(rows: readonly StageAggregate[]): PipelineSummary {
  const byStage = new Map<Stage, { count: bigint; sum: bigint }>();
  for (const stage of STAGES) byStage.set(stage, { count: 0n, sum: 0n });

  for (const row of rows) {
    const entry = byStage.get(row.stage as Stage);
    // Eine Stage, die es nicht gibt, verhindert der Check in der DB. Kommt
    // trotzdem eine, ist das ein Fehler, kein Wert zum Wegschweigen.
    if (entry === undefined) throw new RangeError(`unknown stage: ${row.stage}`);
    entry.count += toBigInt(row.count, 'count');
    entry.sum += toBigInt(row.sumCents, 'sumCents');
  }

  let count = 0n;
  let openCount = 0n;
  let openSum = 0n;
  let weightedOpen = 0n;

  const stages = STAGES.map((stage): StageSummary => {
    const entry = byStage.get(stage) ?? { count: 0n, sum: 0n };
    const probability = STAGE_PROBABILITY[stage];
    const weighted = weightCents(entry.sum, probability);
    count += entry.count;
    if (OPEN_STAGES.includes(stage)) {
      openCount += entry.count;
      openSum += entry.sum;
      weightedOpen += weighted;
    }
    return {
      stage,
      count: toSafeNumber(entry.count),
      sumCents: toSafeNumber(entry.sum),
      probability,
      weightedCents: toSafeNumber(weighted),
    };
  });

  return {
    stages,
    totals: {
      count: toSafeNumber(count),
      openCount: toSafeNumber(openCount),
      openSumCents: toSafeNumber(openSum),
      weightedOpenCents: toSafeNumber(weightedOpen),
      wonCents: toSafeNumber(byStage.get('won')?.sum ?? 0n),
      lostCents: toSafeNumber(byStage.get('lost')?.sum ?? 0n),
    },
  };
}
