// Spawn helpers. Pick two random alive nodes, plan a route, and attach it to
// a freshly-allocated vehicle slot. Direction along the first segment is
// derived from path[0]→path[1]. Returns the slot id or null on failure.

import { cubicAt, cubicTangent } from '../road/bezier';
import type { GraphSnapshot } from '../graphSnapshot';
import type { Adjacency } from '../path/adjacency';
import type { AStar } from '../path/astar';
import {
  allocSlot,
  freeSlot,
  setPath,
  type VehicleArrays,
} from './soa';

export interface RngLike { random: () => number; }

const tmpPos: [number, number, number] = [0, 0, 0];
const tmpTan: [number, number, number] = [0, 0, 0];

const findEdge = (
  adj: Adjacency, g: GraphSnapshot, from: number, to: number,
): { seg: number; dir: 0 | 1 } | null => {
  const e0 = adj.off[from]!;
  const e1 = adj.off[from + 1]!;
  for (let e = e0; e < e1; e++) {
    if (adj.edges[e * 2 + 1]! !== to) continue;
    const seg = adj.edges[e * 2]!;
    const dir: 0 | 1 = g.segNodes[seg * 2]! === from ? 0 : 1;
    return { seg, dir };
  }
  return null;
};

export const spawnRandomVehicle = (
  v: VehicleArrays,
  g: GraphSnapshot,
  adj: Adjacency,
  astar: AStar,
  rng: RngLike,
): number | null => {
  if (g.segCount === 0 || g.nodeCount < 2) return null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const startNode = (rng.random() * g.nodeCount) | 0;
    const goalNode = (rng.random() * g.nodeCount) | 0;
    if (goalNode === startNode) continue;
    // Skip isolated nodes (no edges) — A* would just fail.
    if (adj.off[startNode]! === adj.off[startNode + 1]!) continue;
    const path = astar.find(g, adj, startNode, goalNode);
    if (!path || path.nodes.length < 2) continue;

    const next = path.nodes[1]!;
    const edge = findEdge(adj, g, startNode, next);
    if (!edge) continue;

    const id = allocSlot(v);
    if (id === null) return null;

    setPath(v, id, path.nodes);
    v.segId[id] = edge.seg;
    v.dir[id] = edge.dir;
    v.t[id] = 0;
    v.speed[id] = 9 + rng.random() * 9; // 9..18 m/s

    // Initial transform: sample at the entry end of the segment.
    const a = g.segNodes[edge.seg * 2]!;
    const b = g.segNodes[edge.seg * 2 + 1]!;
    const p0: [number, number, number] = [g.nodePos[a * 3]!, g.nodePos[a * 3 + 1]!, g.nodePos[a * 3 + 2]!];
    const p1: [number, number, number] = [g.nodePos[b * 3]!, g.nodePos[b * 3 + 1]!, g.nodePos[b * 3 + 2]!];
    const c0: [number, number, number] = [g.segCtrl[edge.seg * 6]!, g.segCtrl[edge.seg * 6 + 1]!, g.segCtrl[edge.seg * 6 + 2]!];
    const c1: [number, number, number] = [g.segCtrl[edge.seg * 6 + 3]!, g.segCtrl[edge.seg * 6 + 4]!, g.segCtrl[edge.seg * 6 + 5]!];
    const u = edge.dir === 0 ? 0 : 1;
    cubicAt(p0, c0, c1, p1, u, tmpPos);
    cubicTangent(p0, c0, c1, p1, u, tmpTan);
    let tx = tmpTan[0], tz = tmpTan[2];
    if (edge.dir === 1) { tx = -tx; tz = -tz; }
    v.posX[id] = tmpPos[0];
    v.posY[id] = tmpPos[1] + 0.4;
    v.posZ[id] = tmpPos[2];
    v.heading[id] = Math.atan2(tx, tz);

    return id;
  }
  return null;
};

export const despawnInvalidated = (
  v: VehicleArrays, g: GraphSnapshot,
): number => {
  let removed = 0;
  for (let i = 0; i < v.count; i++) {
    if (!v.alive[i]) continue;
    const seg = v.segId[i]!;
    if (seg < 0 || seg >= g.segCount) {
      freeSlot(v, i);
      removed++;
    }
  }
  return removed;
};
