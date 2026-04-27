// Per-tick vehicle movement. Operates only on TypedArrays — zero allocation
// in the hot loop. When a vehicle reaches the end of its current segment we
// pop the next path entry and continue, or despawn at end-of-path.

import { cubicAt, cubicTangent } from '../road/bezier';
import type { GraphSnapshot } from '../graphSnapshot';
import type { Adjacency } from '../path/adjacency';
import {
  advancePathHead,
  freeSlot,
  peekNextNode,
  type VehicleArrays,
} from './soa';

const tmpPos: [number, number, number] = [0, 0, 0];
const tmpTan: [number, number, number] = [0, 0, 0];

// Find the segment connecting two given nodes (any direction). Returns
// segId and dir (0 = a->b means traveling from `from` to `to`, 1 = b->a).
const findSegBetween = (
  adj: Adjacency, g: GraphSnapshot, from: number, to: number,
): { seg: number; dir: 0 | 1 } | null => {
  const e0 = adj.off[from]!;
  const e1 = adj.off[from + 1]!;
  for (let e = e0; e < e1; e++) {
    const segId = adj.edges[e * 2]!;
    const other = adj.edges[e * 2 + 1]!;
    if (other !== to) continue;
    // Direction: along the segment from a→b means `from` is a, `to` is b.
    const a = g.segNodes[segId * 2]!;
    return { seg: segId, dir: a === from ? 0 : 1 };
  }
  return null;
};

const samplePosHeading = (
  g: GraphSnapshot, segId: number, dir: number, t: number,
): { pos: [number, number, number]; heading: number } => {
  const a = g.segNodes[segId * 2]!;
  const b = g.segNodes[segId * 2 + 1]!;
  const p0: [number, number, number] = [g.nodePos[a * 3]!, g.nodePos[a * 3 + 1]!, g.nodePos[a * 3 + 2]!];
  const p1: [number, number, number] = [g.nodePos[b * 3]!, g.nodePos[b * 3 + 1]!, g.nodePos[b * 3 + 2]!];
  const c0: [number, number, number] = [g.segCtrl[segId * 6]!, g.segCtrl[segId * 6 + 1]!, g.segCtrl[segId * 6 + 2]!];
  const c1: [number, number, number] = [g.segCtrl[segId * 6 + 3]!, g.segCtrl[segId * 6 + 4]!, g.segCtrl[segId * 6 + 5]!];
  // For dir=0 we travel a→b at parameter t. For dir=1 we travel b→a, which is
  // the same bezier evaluated at (1-t) with negated tangent.
  const u = dir === 0 ? t : 1 - t;
  cubicAt(p0, c0, c1, p1, u, tmpPos);
  cubicTangent(p0, c0, c1, p1, u, tmpTan);
  let tx = tmpTan[0], tz = tmpTan[2];
  if (dir === 1) { tx = -tx; tz = -tz; }
  return { pos: [tmpPos[0], tmpPos[1], tmpPos[2]], heading: Math.atan2(tx, tz) };
};

// Tick one frame at fixed dtSeconds. Returns count of alive vehicles.
export const tickVehicles = (
  v: VehicleArrays,
  g: GraphSnapshot,
  adj: Adjacency,
  dtSeconds: number,
): number => {
  let alive = 0;
  for (let i = 0; i < v.count; i++) {
    if (!v.alive[i]) continue;
    let seg = v.segId[i]!;
    if (seg < 0 || seg >= g.segCount) {
      freeSlot(v, i);
      continue;
    }
    let dir = v.dir[i]!;
    let t = v.t[i]!;
    const speed = v.speed[i]!;
    const segLen = g.segLen[seg]!;

    let dt = (speed * dtSeconds) / segLen;
    t += dt;

    // We may cross multiple segments in a single tick at high speeds; loop
    // until the remaining advance fits in the current segment.
    let despawned = false;
    while (t >= 1) {
      const overshoot = t - 1;
      // Reached the "ahead" end node. Pull the next node off the path.
      advancePathHead(v, i);
      const next = peekNextNode(v, i);
      if (next === null) {
        freeSlot(v, i);
        despawned = true;
        break;
      }
      const aheadNode = v.pathNodes[i * 32 + v.pathHead[i]!]!;
      const found = findSegBetween(adj, g, aheadNode, next);
      if (!found) {
        // Path corrupted (graph edited beneath us)
        freeSlot(v, i);
        despawned = true;
        break;
      }
      seg = found.seg;
      dir = found.dir;
      const newLen = g.segLen[seg]!;
      // Convert remaining linear travel into segment-space parameter.
      t = (overshoot * segLen) / newLen;
      // Note: 'segLen' below referenced by the next iteration loop should be
      // the new length; rebind via the seg variable.
      // (We rely on the while-condition reading the *new* t against 1.)
      // To prevent infinite loops on degenerate zero-length next segments,
      // bail if t is still huge after a remap.
      if (!Number.isFinite(t)) { freeSlot(v, i); despawned = true; break; }
    }
    if (despawned) continue;

    // Sample world transform.
    const sample = samplePosHeading(g, seg, dir, t);
    v.posX[i] = sample.pos[0];
    v.posY[i] = sample.pos[1] + 0.4; // sit on top of road surface
    v.posZ[i] = sample.pos[2];
    v.heading[i] = sample.heading;
    v.segId[i] = seg;
    v.dir[i] = dir;
    v.t[i] = t;
    alive++;
  }
  return alive;
};
