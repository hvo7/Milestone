/**
 * Generic operations over an infinitely-nestable `{ id, children? }` tree.
 *
 * Both task stores grow the same shape of checklist — a routine's `Subtask`
 * (completed/completedAt) and a Vynues task's `VynuesSubtask` (done) — and both
 * need the same five recursive walks. They lived as two near-identical copies;
 * this is the single implementation, generic over the node type so each store
 * keeps its own field names and just supplies the leaf transform.
 */

/** Anything with a stable id that may nest more of itself. Each store's node
 *  type (Subtask, VynuesSubtask) satisfies this on its own terms. */
export interface TreeNode<T> {
  id: string;
  children?: T[];
}

/** Every node of the tree, depth-first, parents before their children. */
export function flattenTree<T extends TreeNode<T>>(list: T[] | undefined): T[] {
  if (!list?.length) return [];
  return list.flatMap(n => [n, ...flattenTree(n.children)]);
}

/** Find a node anywhere in the tree (undefined if absent). */
export function findNode<T extends TreeNode<T>>(list: T[] | undefined, id: string): T | undefined {
  return flattenTree(list).find(n => n.id === id);
}

/** Replace the node with `id` via `fn`, leaving every other branch untouched.
 *  Returns the original array when nothing matched, so callers can rely on
 *  reference equality to skip needless re-renders. */
export function mapNode<T extends TreeNode<T>>(list: T[], id: string, fn: (n: T) => T): T[] {
  return list.map(n => {
    if (n.id === id) return fn(n);
    if (n.children?.length) {
      const children = mapNode(n.children, id, fn);
      if (children !== n.children) return { ...n, children };
    }
    return n;
  });
}

/** Apply `fn` to every node in the tree, top-down. */
export function mapTree<T extends TreeNode<T>>(list: T[] | undefined, fn: (n: T) => T): T[] | undefined {
  return list?.map(n => {
    const next = fn(n);
    return next.children?.length ? { ...next, children: mapTree(next.children, fn) } : next;
  });
}

/** Append `node` under `parentId` — or at the top level when it's null. */
export function insertNode<T extends TreeNode<T>>(list: T[], parentId: string | null, node: T): T[] {
  if (!parentId) return [...list, node];
  return list.map(n => {
    if (n.id === parentId) return { ...n, children: [...(n.children ?? []), node] };
    if (n.children?.length) return { ...n, children: insertNode(n.children, parentId, node) };
    return n;
  });
}

/** Remove a node and its whole subtree from anywhere in the tree. */
export function removeNode<T extends TreeNode<T>>(list: T[], id: string): T[] {
  return list
    .filter(n => n.id !== id)
    .map(n => (n.children?.length ? { ...n, children: removeNode(n.children, id) } : n));
}
