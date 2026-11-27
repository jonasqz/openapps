import { describe, expect, it } from 'vitest';
import { moveProblem } from './move';
import { buildTree, flattenTree, type TreeSource } from './tree';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';

const page = (id: string, parentId: string | null, title = id.slice(-1)): TreeSource => ({
  id,
  parentId,
  title,
  updatedAt: '2026-11-27T10:00:00.000Z',
});

describe('moveProblem — no cycles', () => {
  it('allows the top level and unrelated parents', () => {
    expect(moveProblem(A, null, [])).toBeUndefined();
    // B liegt in einem anderen Ast: Kette von B ist nur B.
    expect(moveProblem(A, B, [B])).toBeUndefined();
    // Unter den eigenen Vorfahren zurueck ist kein Kreis.
    expect(moveProblem(C, A, [A])).toBeUndefined();
  });

  it('rejects the page as its own parent', () => {
    expect(moveProblem(A, A, [A])).toMatch(/own parent/);
  });

  it('rejects a direct or deep subpage as the new parent', () => {
    // A -> B -> C: A unter C waere ein Kreis; die Kette von C enthaelt A.
    expect(moveProblem(A, B, [B, A])).toMatch(/own subpages/);
    expect(moveProblem(A, C, [C, B, A])).toMatch(/own subpages/);
  });

  it('rejects even when the chain order is unusual', () => {
    expect(moveProblem(A, C, [A, B, C])).toBeDefined();
  });
});

describe('buildTree — nested and cycle-safe', () => {
  it('nests children under parents in input order', () => {
    const tree = buildTree([page(A, null), page(B, A), page(C, A), page(D, B)]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children.map((node) => node.id)).toEqual([B, C]);
    expect(tree[0]?.children[0]?.children.map((node) => node.id)).toEqual([D]);
  });

  it('puts pages whose parent is missing at the top instead of dropping them', () => {
    const tree = buildTree([page(B, A), page(C, null)]);
    expect(tree.map((node) => node.id).sort()).toEqual([B, C].sort());
  });

  it('returns a subtree for rootId even if the root has a parent outside the list', () => {
    const tree = buildTree([page(B, A), page(C, B)], B);
    expect(tree.map((node) => node.id)).toEqual([B]);
    expect(tree[0]?.children.map((node) => node.id)).toEqual([C]);
    expect(buildTree([page(C, B)], A)).toEqual([]);
  });

  it('terminates on cyclic data and shows each page at most once', () => {
    // Gegen jede Regel: A -> B -> A, dazu D oben.
    const tree = buildTree([page(A, B), page(B, A), page(D, null)]);
    const ids = flattenTree(tree).map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(D);
  });
});

describe('flattenTree — move targets', () => {
  const tree = buildTree([page(A, null), page(B, A), page(C, B), page(D, null)]);

  it('lists every page with its depth', () => {
    expect(flattenTree(tree).map((node) => [node.id, node.depth])).toEqual([
      [A, 0],
      [B, 1],
      [C, 2],
      [D, 0],
    ]);
  });

  it('leaves out the page itself and all its subpages', () => {
    expect(flattenTree(tree, B).map((node) => node.id)).toEqual([A, D]);
    expect(flattenTree(tree, A).map((node) => node.id)).toEqual([D]);
  });
});
