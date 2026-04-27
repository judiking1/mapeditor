// A* over the road node graph. Node→node search; cost is bezier-true segment
// length. Heuristic is straight-line distance. Returns the node sequence
// from start to goal (inclusive). Reusable buffers cut steady-state alloc.

import type { GraphSnapshot } from '../graphSnapshot';
import type { Adjacency } from './adjacency';
import { NodeHeap } from './heap';

export class AStar {
  private gScore: Float32Array;
  private came: Int32Array;
  private cameSeg: Int32Array;
  private closed: Uint8Array;
  private heap: NodeHeap;
  private capacity = 0;

  constructor(initialCap = 1024) {
    this.gScore = new Float32Array(initialCap);
    this.came = new Int32Array(initialCap);
    this.cameSeg = new Int32Array(initialCap);
    this.closed = new Uint8Array(initialCap);
    this.heap = new NodeHeap(Math.max(64, initialCap >> 2));
    this.capacity = initialCap;
  }

  private resize(needed: number): void {
    if (needed <= this.capacity) return;
    let cap = this.capacity;
    while (cap < needed) cap *= 2;
    this.gScore = new Float32Array(cap);
    this.came = new Int32Array(cap);
    this.cameSeg = new Int32Array(cap);
    this.closed = new Uint8Array(cap);
    this.capacity = cap;
  }

  // Returns [start..goal] node ids (inclusive) or null if unreachable.
  // outSegSequence (optional) is filled with the segment ids between
  // consecutive nodes (length = nodes.length - 1).
  find(
    g: GraphSnapshot, adj: Adjacency, start: number, goal: number,
  ): { nodes: Int32Array; segs: Int32Array } | null {
    if (start === goal) {
      return { nodes: new Int32Array([start]), segs: new Int32Array(0) };
    }
    if (start < 0 || goal < 0 || start >= g.nodeCount || goal >= g.nodeCount) return null;

    this.resize(g.nodeCount);
    this.gScore.fill(Number.POSITIVE_INFINITY);
    this.came.fill(-1);
    this.cameSeg.fill(-1);
    this.closed.fill(0);
    this.heap.reset();

    const gx = g.nodePos[goal * 3]!;
    const gz = g.nodePos[goal * 3 + 2]!;
    const h = (n: number): number => {
      const dx = g.nodePos[n * 3]! - gx;
      const dz = g.nodePos[n * 3 + 2]! - gz;
      return Math.hypot(dx, dz);
    };

    this.gScore[start] = 0;
    this.heap.push(start, h(start));

    while (this.heap.length > 0) {
      const top = this.heap.popMin()!;
      const u = top.node;
      if (u === goal) break;
      if (this.closed[u]) continue;
      this.closed[u] = 1;
      const gu = this.gScore[u]!;
      const e0 = adj.off[u]!;
      const e1 = adj.off[u + 1]!;
      for (let e = e0; e < e1; e++) {
        const segId = adj.edges[e * 2]!;
        const v = adj.edges[e * 2 + 1]!;
        if (this.closed[v]) continue;
        const tentative = gu + g.segLen[segId]!;
        if (tentative < this.gScore[v]!) {
          this.gScore[v] = tentative;
          this.came[v] = u;
          this.cameSeg[v] = segId;
          this.heap.push(v, tentative + h(v));
        }
      }
    }

    if (this.came[goal] === -1 && this.gScore[goal] === Number.POSITIVE_INFINITY) return null;

    // Reconstruct
    let count = 0;
    for (let n = goal; n !== -1; n = this.came[n]!) {
      count++;
      if (n === start) break;
    }
    const nodes = new Int32Array(count);
    const segs = new Int32Array(Math.max(0, count - 1));
    let idx = count - 1;
    for (let n = goal; n !== -1; ) {
      nodes[idx] = n;
      const prev = this.came[n]!;
      const seg = this.cameSeg[n]!;
      if (idx > 0 && seg !== -1) segs[idx - 1] = seg;
      if (n === start) break;
      n = prev;
      idx--;
    }
    return { nodes, segs };
  }
}
