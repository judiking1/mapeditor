// Auto-placement loop. Each call examines `budget` random zoned-empty cells:
//   - reject if already built
//   - reject if overlapping a road (within roadHalfWidth)
//   - accept if a road is reachable within `accessRadius`
// Cell positions are jittered slightly so identical cells produce distinct
// random heights/seeds.

import type { GraphSnapshot } from '../graphSnapshot';
import { cubicAt } from '../road/bezier';
import {
  cellIndex,
  cellToWorldCenter,
  ZONE_COM,
  ZONE_IND,
  ZONE_NONE,
  ZONE_RES,
  type ZoneGrid,
} from '../zoning/grid';
import { addBuilding, type BuildingStore } from './store';

const ROAD_HALF_WIDTH = 6;
const ACCESS_RADIUS = 22;
const ROAD_SAMPLES = 8;

const heightForZone = (type: number, rand01: number): number => {
  switch (type) {
    case ZONE_RES: return 8 + rand01 * 22;
    case ZONE_COM: return 6 + rand01 * 14;
    case ZONE_IND: return 4 + rand01 * 8;
    default: return 6;
  }
};

// Returns the squared distance from (x, z) to the closest sampled point on
// any segment in `g`, or +Inf if g has no segments.
const minSqDistToRoad = (g: GraphSnapshot, x: number, z: number, cutoffSq: number): number => {
  let best = Number.POSITIVE_INFINITY;
  const tmp: [number, number, number] = [0, 0, 0];
  for (let s = 0; s < g.segCount; s++) {
    const a = g.segNodes[s * 2]!;
    const b = g.segNodes[s * 2 + 1]!;
    // Cheap pre-filter: bounding-circle test using endpoint midpoint and a
    // generous radius (segment length / 2 + cutoff). Falls back to the full
    // bezier sample loop only when worth it.
    const ax = g.nodePos[a * 3]!, az = g.nodePos[a * 3 + 2]!;
    const bx = g.nodePos[b * 3]!, bz = g.nodePos[b * 3 + 2]!;
    const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
    const segLen = g.segLen[s]!;
    const reach = segLen * 0.5 + Math.sqrt(cutoffSq);
    const dxm = x - mx, dzm = z - mz;
    if (dxm * dxm + dzm * dzm > reach * reach) continue;

    const p0: [number, number, number] = [ax, g.nodePos[a * 3 + 1]!, az];
    const p1: [number, number, number] = [bx, g.nodePos[b * 3 + 1]!, bz];
    const c0: [number, number, number] = [g.segCtrl[s * 6]!, g.segCtrl[s * 6 + 1]!, g.segCtrl[s * 6 + 2]!];
    const c1: [number, number, number] = [g.segCtrl[s * 6 + 3]!, g.segCtrl[s * 6 + 4]!, g.segCtrl[s * 6 + 5]!];
    for (let i = 0; i <= ROAD_SAMPLES; i++) {
      cubicAt(p0, c0, c1, p1, i / ROAD_SAMPLES, tmp);
      const dx = tmp[0] - x, dz = tmp[2] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
      if (best < cutoffSq) {
        // Already inside cutoff — caller doesn't need the exact min beyond this.
        return best;
      }
    }
  }
  return best;
};

// Mulberry32 — small fast deterministic PRNG used per-cell.
const cellHash = (cx: number, cz: number, salt = 0): number => {
  let h = (cx * 0x9e3779b1 + cz * 0x85ebca6b + salt * 0xc2b2ae35) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
};

const cellRand01 = (cx: number, cz: number, salt = 0): number =>
  cellHash(cx, cz, salt) / 0x100000000;

export const tickBuildingPlacement = (
  zone: ZoneGrid,
  store: BuildingStore,
  graph: GraphSnapshot,
  budget: number,
): number => {
  if (graph.segCount === 0) return 0;
  const cutoffSq = ACCESS_RADIUS * ACCESS_RADIUS;
  const roadOnSq = ROAD_HALF_WIDTH * ROAD_HALF_WIDTH;
  let placed = 0;
  for (let i = 0; i < budget; i++) {
    const cx = (Math.random() * zone.width) | 0;
    const cz = (Math.random() * zone.height) | 0;
    const idx = cellIndex(zone, cx, cz);
    const z = zone.cells[idx]!;
    if (z === ZONE_NONE) continue;
    if (store.cellToBldg[idx]! >= 0) continue;
    const center = cellToWorldCenter(zone, cx, cz);
    const d2 = minSqDistToRoad(graph, center.x, center.z, cutoffSq);
    if (d2 > cutoffSq) continue;       // too far — no road access
    if (d2 < roadOnSq) continue;       // overlaps the road itself
    const r = cellRand01(cx, cz, 1);
    const h = heightForZone(z, r);
    addBuilding(store, idx, center.x, center.z, h, z, cellHash(cx, cz, 7));
    placed++;
  }
  return placed;
};

// Sweep zoned-but-empty cells when the user erases a zone; remove buildings
// whose cell is no longer zoned.
export const reconcileZoneRemovals = (
  zone: ZoneGrid, store: BuildingStore,
): number => {
  let removed = 0;
  for (let cz = 0; cz < zone.height; cz++) {
    for (let cx = 0; cx < zone.width; cx++) {
      const idx = cellIndex(zone, cx, cz);
      const id = store.cellToBldg[idx]!;
      if (id < 0) continue;
      if (zone.cells[idx]! === ZONE_NONE) {
        store.alive[id] = 0;
        store.cellToBldg[idx] = -1;
        store.free.push(id);
        removed++;
      }
    }
  }
  if (removed > 0) store.version++;
  return removed;
};
