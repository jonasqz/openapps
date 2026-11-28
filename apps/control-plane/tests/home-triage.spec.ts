/**
 * Die Tastatur-Triage von Home (ADR 0022 D), ohne Browser. Riskant: eine
 * Taste, die beim Tippen in einem Feld etwas markiert, oder ein Eintrag, der
 * nach „erledigt" in der offenen Liste stehen bleibt.
 */

import { describe, expect, it } from 'vitest';
import { applyMark, commandForKey, moveIndex } from '../src/app/(verwaltung)/home/triage';

const key = (k: string, extra: Partial<Parameters<typeof commandForKey>[0]> = {}) =>
  commandForKey({
    key: k,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    targetTag: 'BODY',
    ...extra,
  });

describe('commandForKey', () => {
  it('ordnet die Tasten der Triage zu', () => {
    expect(
      ['j', 'ArrowDown', 'k', 'ArrowUp', 'Enter', 'o', 'r', 'u', 'e'].map((k) => key(k)),
    ).toEqual(['next', 'next', 'previous', 'previous', 'open', 'open', 'read', 'unread', 'done']);
    expect(key('x')).toBeNull();
    expect(key('constructor')).toBeNull();
  });

  it('tut nichts beim Tippen, mit Modifikatoren oder bei Enter auf Knopf und Link', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(key('e', { targetTag: tag })).toBeNull();
    expect(key('e', { targetEditable: true })).toBeNull();
    expect(key('k', { metaKey: true })).toBeNull();
    expect(key('r', { ctrlKey: true })).toBeNull();
    expect(key('Enter', { targetTag: 'BUTTON' })).toBeNull();
    expect(key('Enter', { targetTag: 'A' })).toBeNull();
    expect(key('e', { targetTag: 'BUTTON' })).toBe('done');
  });
});

describe('moveIndex und applyMark', () => {
  it('haelt den Index an den Enden fest', () => {
    expect(moveIndex(0, 3, 'previous')).toBe(0);
    expect(moveIndex(2, 3, 'next')).toBe(2);
    expect(moveIndex(1, 3, 'next')).toBe(2);
    expect(moveIndex(5, 0, 'next')).toBe(0);
  });

  it('nimmt Erledigtes aus der offenen Liste und Wiedereroeffnetes aus der erledigten', () => {
    const items = [
      { id: 'a', state: 'unread' as const },
      { id: 'b', state: 'read' as const },
    ];
    expect(applyMark(items, ['a'], 'done', 'open')).toEqual([{ id: 'b', state: 'read' }]);
    expect(applyMark(items, ['a'], 'read', 'open')).toEqual([
      { id: 'a', state: 'read' },
      { id: 'b', state: 'read' },
    ]);
    const done = [{ id: 'c', state: 'done' as const }];
    expect(applyMark(done, ['c'], 'read', 'done')).toEqual([]);
    expect(applyMark(done, ['x'], 'read', 'done')).toEqual(done);
  });
});
