/**
 * The nestable-checklist walks shared by both task stores. Small, pure, and
 * relied on by every subtask edit — a bug here quietly loses a branch.
 */
import { describe, it, expect } from 'vitest';
import { flattenTree, findNode, mapNode, mapTree, insertNode, removeNode } from './subtree';

interface Node { id: string; label: string; done?: boolean; children?: Node[] }

/** a ─ b ─ d
 *    └ c      e */
const tree = (): Node[] => [
  { id: 'a', label: 'a', children: [
    { id: 'b', label: 'b', children: [{ id: 'd', label: 'd' }] },
    { id: 'c', label: 'c' },
  ] },
  { id: 'e', label: 'e' },
];

describe('flattenTree', () => {
  it('walks depth-first, parents first', () => {
    expect(flattenTree(tree()).map(n => n.id)).toEqual(['a', 'b', 'd', 'c', 'e']);
  });

  it('tolerates absent and empty lists', () => {
    expect(flattenTree(undefined)).toEqual([]);
    expect(flattenTree([])).toEqual([]);
  });
});

describe('findNode', () => {
  it('finds at any depth', () => {
    expect(findNode(tree(), 'd')?.label).toBe('d');
    expect(findNode(tree(), 'nope')).toBeUndefined();
  });
});

describe('mapNode', () => {
  it('replaces only the target', () => {
    const out = mapNode(tree(), 'd', n => ({ ...n, done: true }));
    expect(findNode(out, 'd')?.done).toBe(true);
    expect(findNode(out, 'b')?.done).toBeUndefined();
  });

  it('returns untouched branches by reference', () => {
    // Reference equality is what lets React skip re-rendering siblings.
    const before = tree();
    const out = mapNode(before, 'b', n => ({ ...n, done: true }));
    expect(out[1]).toBe(before[1]);          // 'e' untouched
    expect(out[0]).not.toBe(before[0]);      // 'a' is on the path, so rebuilt
  });

  it('is a no-op for an unknown id', () => {
    const before = tree();
    expect(mapNode(before, 'ghost', n => ({ ...n, done: true }))).toEqual(before);
  });
});

describe('mapTree', () => {
  it('applies to every node at every depth', () => {
    const out = mapTree(tree(), n => ({ ...n, done: true }))!;
    expect(flattenTree(out).every(n => n.done)).toBe(true);
  });

  it('passes undefined through', () => {
    expect(mapTree(undefined, n => n)).toBeUndefined();
  });
});

describe('insertNode', () => {
  it('appends at the top level when no parent is given', () => {
    const out = insertNode(tree(), null, { id: 'z', label: 'z' });
    expect(out.map(n => n.id)).toEqual(['a', 'e', 'z']);
  });

  it('appends under a nested parent', () => {
    const out = insertNode(tree(), 'd', { id: 'z', label: 'z' });
    expect(findNode(out, 'd')?.children?.map(n => n.id)).toEqual(['z']);
  });
});

describe('removeNode', () => {
  it('takes the whole subtree with it', () => {
    const out = removeNode(tree(), 'b');
    expect(flattenTree(out).map(n => n.id)).toEqual(['a', 'c', 'e']);   // 'd' went too
  });

  it('removes a root node', () => {
    expect(removeNode(tree(), 'e').map(n => n.id)).toEqual(['a']);
  });
});
