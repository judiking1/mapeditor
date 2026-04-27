// Derived adjacency lists from a graph snapshot. We build a CSR-style index
// once per snapshot; each node points into a flat array of (segId, otherNode)
// pairs. This gives O(degree) neighbor iteration and avoids per-step allocs.

import type { GraphSnapshot } from '../graphSnapshot';

export interface Adjacency {
  // CSR: node i's edges occupy edges[off[i]..off[i+1]) at stride 2.
  // edges[k*2]=segId, edges[k*2+1]=neighbor node.
  off: Int32Array;
  edges: Int32Array;
}

export const buildAdjacency = (g: GraphSnapshot): Adjacency => {
  const off = new Int32Array(g.nodeCount + 1);
  // Count incidence per node into off[i+1] so a single prefix-sum yields ranges.
  for (let s = 0; s < g.segCount; s++) {
    const ai = g.segNodes[s * 2]! + 1;
    const bi = g.segNodes[s * 2 + 1]! + 1;
    off[ai] = (off[ai] ?? 0) + 1;
    off[bi] = (off[bi] ?? 0) + 1;
  }
  for (let i = 1; i <= g.nodeCount; i++) {
    off[i] = off[i]! + off[i - 1]!;
  }
  const total = off[g.nodeCount]!;
  const edges = new Int32Array(total * 2);
  // Cursor mirrors off so we can fill edges in node-clustered order.
  const cursor = new Int32Array(g.nodeCount);
  for (let i = 0; i < g.nodeCount; i++) cursor[i] = off[i]!;
  for (let s = 0; s < g.segCount; s++) {
    const a = g.segNodes[s * 2]!;
    const b = g.segNodes[s * 2 + 1]!;
    const ai = cursor[a]!;
    edges[ai * 2] = s;
    edges[ai * 2 + 1] = b;
    cursor[a] = ai + 1;
    const bi = cursor[b]!;
    edges[bi * 2] = s;
    edges[bi * 2 + 1] = a;
    cursor[b] = bi + 1;
  }
  return { off, edges };
};
