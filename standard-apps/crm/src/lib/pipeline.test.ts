import { describe, expect, it } from 'vitest';
import { STAGES } from './domain';
import { formatDate, formatEuro, parseEuroToCents } from './format';
import { summarizePipeline, toSafeNumber, weightCents } from './pipeline';
import { likePattern } from './search';

describe('summarizePipeline', () => {
  it('returns all five stages in a fixed order, even without deals', () => {
    const summary = summarizePipeline([]);
    expect(summary.stages.map((s) => s.stage)).toEqual([...STAGES]);
    expect(summary.stages.every((s) => s.count === 0 && s.sumCents === 0 && s.weightedCents === 0)).toBe(true);
    expect(summary.totals).toEqual({
      count: 0,
      openCount: 0,
      openSumCents: 0,
      weightedOpenCents: 0,
      wonCents: 0,
      lostCents: 0,
    });
  });

  it('computes the sample data correctly', () => {
    // Werte wie in seeds/0001_beispieldaten.sql, Summe als Text wie aus Postgres.
    const summary = summarizePipeline([
      { stage: 'proposal', count: 1, sumCents: '4800000' },
      { stage: 'qualified', count: 1, sumCents: '1200000' },
      { stage: 'lead', count: 1, sumCents: '950000' },
      { stage: 'won', count: 1, sumCents: '2150000' },
      { stage: 'lost', count: 1, sumCents: '680000' },
    ]);
    const proposal = summary.stages.find((s) => s.stage === 'proposal');
    expect(proposal).toEqual({ stage: 'proposal', count: 1, sumCents: 4800000, probability: 60, weightedCents: 2880000 });
    // 2.880.000 + 300.000 + 95.000
    expect(summary.totals.weightedOpenCents).toBe(3275000);
    expect(summary.totals.openSumCents).toBe(6950000);
    expect(summary.totals.openCount).toBe(3);
    expect(summary.totals.count).toBe(5);
    expect(summary.totals.wonCents).toBe(2150000);
    expect(summary.totals.lostCents).toBe(680000);
  });

  it('keeps won and lost out of the open, weighted total', () => {
    const summary = summarizePipeline([
      { stage: 'won', count: 2, sumCents: 1000 },
      { stage: 'lost', count: 3, sumCents: 5000 },
    ]);
    expect(summary.totals.weightedOpenCents).toBe(0);
    expect(summary.totals.openCount).toBe(0);
    expect(summary.stages.find((s) => s.stage === 'won')?.weightedCents).toBe(1000);
    expect(summary.stages.find((s) => s.stage === 'lost')?.weightedCents).toBe(0);
  });

  it('rounds half cents up and stays exact for large totals', () => {
    expect(weightCents(5n, 10)).toBe(1n); // 0,5 -> 1
    expect(weightCents(4n, 10)).toBe(0n); // 0,4 -> 0
    expect(weightCents(1n, 25)).toBe(0n); // 0,25 -> 0
    expect(weightCents(2n, 25)).toBe(1n); // 0,5 -> 1
    const big = 9_000_000_000_000_000n;
    const summary = summarizePipeline([{ stage: 'lead', count: 1, sumCents: big.toString() }]);
    expect(summary.stages[0]?.weightedCents).toBe(900_000_000_000_000);
  });

  it('throws instead of silently rounding when a total no longer fits a JSON number', () => {
    expect(() =>
      summarizePipeline([{ stage: 'lead', count: 1, sumCents: '9007199254740993' }]),
    ).toThrow(RangeError);
    expect(() => toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });

  it('throws on an unknown stage or a broken number', () => {
    expect(() => summarizePipeline([{ stage: 'archived', count: 1, sumCents: 1 }])).toThrow(/stage/);
    expect(() => summarizePipeline([{ stage: 'lead', count: 1, sumCents: '12,5' }])).toThrow(RangeError);
    expect(() => summarizePipeline([{ stage: 'lead', count: 1.5, sumCents: 1 }])).toThrow(RangeError);
  });

  it('adds up several rows of the same stage', () => {
    const summary = summarizePipeline([
      { stage: 'lead', count: '2', sumCents: '100' },
      { stage: 'lead', count: 1, sumCents: 50n },
    ]);
    expect(summary.stages[0]).toMatchObject({ count: 3, sumCents: 150, weightedCents: 15 });
  });
});

describe('amounts in en-GB format', () => {
  it('shows euros with comma thousands and a decimal point', () => {
    expect(formatEuro(1250050)).toBe('€12,500.50');
    expect(formatEuro(0)).toBe('€0.00');
  });

  it('reads English input', () => {
    expect(parseEuroToCents('12,500')).toBe(1250000);
    expect(parseEuroToCents('12500')).toBe(1250000);
    expect(parseEuroToCents('12,500.5')).toBe(1250050);
    expect(parseEuroToCents('€12,500.50')).toBe(1250050);
    expect(parseEuroToCents('12,500.50 €')).toBe(1250050);
    expect(parseEuroToCents(' 1,234,567.89 ')).toBe(123456789);
    expect(parseEuroToCents('12.50')).toBe(1250);
    expect(parseEuroToCents('0')).toBe(0);
  });

  it('rejects ambiguous and broken amounts, including German-style input', () => {
    const inputs = ['', '12.500', '12,50', '12.500,50', '12.505', '-5', '1,2345', 'twelve', '12,500,0', '1e5', '90071992547409.92'];
    for (const input of inputs) {
      expect(parseEuroToCents(input), input).toBeNull();
    }
  });

  it('shows a calendar date without a time zone shift', () => {
    expect(formatDate('2025-01-01')).toBe('1 Jan 2025');
    expect(formatDate('2025-12-31')).toBe('31 Dec 2025');
    expect(formatDate(null)).toBe('–');
  });
});

describe('likePattern', () => {
  it('treats % and _ as plain characters', () => {
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('c:\\x')).toBe('%c:\\\\x%');
    expect(likePattern('Crane')).toBe('%Crane%');
  });
});
