import { describe, expect, it } from 'vitest';
import { STAGES } from './domain';
import { formatDate, formatEuro, parseEuroToCents } from './format';
import { summarizePipeline, toSafeNumber, weightCents } from './pipeline';
import { likePattern } from './search';

describe('summarizePipeline', () => {
  it('liefert alle fuenf Stages in fester Reihenfolge, auch ohne Deals', () => {
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

  it('rechnet die Beispieldaten richtig', () => {
    // Werte wie in migrations/0002_beispieldaten.sql, Summe als Text wie aus Postgres.
    const summary = summarizePipeline([
      { stage: 'angebot', count: 1, sumCents: '4800000' },
      { stage: 'qualifiziert', count: 1, sumCents: '1200000' },
      { stage: 'lead', count: 1, sumCents: '950000' },
      { stage: 'gewonnen', count: 1, sumCents: '2150000' },
      { stage: 'verloren', count: 1, sumCents: '680000' },
    ]);
    const angebot = summary.stages.find((s) => s.stage === 'angebot');
    expect(angebot).toEqual({ stage: 'angebot', count: 1, sumCents: 4800000, probability: 60, weightedCents: 2880000 });
    // 2.880.000 + 300.000 + 95.000
    expect(summary.totals.weightedOpenCents).toBe(3275000);
    expect(summary.totals.openSumCents).toBe(6950000);
    expect(summary.totals.openCount).toBe(3);
    expect(summary.totals.count).toBe(5);
    expect(summary.totals.wonCents).toBe(2150000);
    expect(summary.totals.lostCents).toBe(680000);
  });

  it('zaehlt gewonnen und verloren nicht in die offene, gewichtete Summe', () => {
    const summary = summarizePipeline([
      { stage: 'gewonnen', count: 2, sumCents: 1000 },
      { stage: 'verloren', count: 3, sumCents: 5000 },
    ]);
    expect(summary.totals.weightedOpenCents).toBe(0);
    expect(summary.totals.openCount).toBe(0);
    expect(summary.stages.find((s) => s.stage === 'gewonnen')?.weightedCents).toBe(1000);
    expect(summary.stages.find((s) => s.stage === 'verloren')?.weightedCents).toBe(0);
  });

  it('rundet halbe Cent auf und bleibt bei grossen Summen exakt', () => {
    expect(weightCents(5n, 10)).toBe(1n); // 0,5 -> 1
    expect(weightCents(4n, 10)).toBe(0n); // 0,4 -> 0
    expect(weightCents(1n, 25)).toBe(0n); // 0,25 -> 0
    expect(weightCents(2n, 25)).toBe(1n); // 0,5 -> 1
    const big = 9_000_000_000_000_000n;
    const summary = summarizePipeline([{ stage: 'lead', count: 1, sumCents: big.toString() }]);
    expect(summary.stages[0]?.weightedCents).toBe(900_000_000_000_000);
  });

  it('wirft, statt still zu runden, wenn eine Summe nicht mehr als JSON-Zahl taugt', () => {
    expect(() =>
      summarizePipeline([{ stage: 'lead', count: 1, sumCents: '9007199254740993' }]),
    ).toThrow(RangeError);
    expect(() => toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
  });

  it('wirft bei einer unbekannten Stage oder kaputten Zahl', () => {
    expect(() => summarizePipeline([{ stage: 'archiv', count: 1, sumCents: 1 }])).toThrow(/Stage/);
    expect(() => summarizePipeline([{ stage: 'lead', count: 1, sumCents: '12,5' }])).toThrow(RangeError);
    expect(() => summarizePipeline([{ stage: 'lead', count: 1.5, sumCents: 1 }])).toThrow(RangeError);
  });

  it('addiert mehrere Zeilen derselben Stage', () => {
    const summary = summarizePipeline([
      { stage: 'lead', count: '2', sumCents: '100' },
      { stage: 'lead', count: 1, sumCents: 50n },
    ]);
    expect(summary.stages[0]).toMatchObject({ count: 3, sumCents: 150, weightedCents: 15 });
  });
});

describe('Betraege im deutschen Format', () => {
  it('zeigt Euro mit Tausenderpunkt und Komma', () => {
    expect(formatEuro(1250050)).toBe('12.500,50\u00a0€');
    expect(formatEuro(0)).toBe('0,00\u00a0€');
  });

  it('liest deutsche Eingaben', () => {
    expect(parseEuroToCents('12.500')).toBe(1250000);
    expect(parseEuroToCents('12500')).toBe(1250000);
    expect(parseEuroToCents('12.500,5')).toBe(1250050);
    expect(parseEuroToCents('12.500,50 €')).toBe(1250050);
    expect(parseEuroToCents(' 1.234.567,89 ')).toBe(123456789);
    expect(parseEuroToCents('0')).toBe(0);
  });

  it('weist mehrdeutige und kaputte Betraege ab', () => {
    for (const input of ['', '12.50', '12,505', '-5', '1.2345', 'zwölf', '12.500.0', '1e5', '90071992547409,92']) {
      expect(parseEuroToCents(input), input).toBeNull();
    }
  });

  it('zeigt ein Datum ohne Zeitzonenverschiebung', () => {
    expect(formatDate('2025-01-01')).toBe('01.01.2025');
    expect(formatDate(null)).toBe('–');
  });
});

describe('likePattern', () => {
  it('macht % und _ zu normalen Zeichen', () => {
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('c:\\x')).toBe('%c:\\\\x%');
    expect(likePattern('Kranz')).toBe('%Kranz%');
  });
});
