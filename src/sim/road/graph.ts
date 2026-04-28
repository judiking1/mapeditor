// Road graph: SoA storage for nodes and segments with free lists for ID reuse.
// Lives on the main thread for editing; snapshots will be shipped to the worker
// when vehicle simulation comes online (M4).

import type { Vec3 } from '../../math/vec';
import { cubicAt } from './bezier';

const ALIVE = 1;

// Node packed into nodePos (x,y,z) + nodeFlags (alive bit + degree later)
// Segment: segNodes (a,b) + segCtrl (c0xyz, c1xyz) + segFlags (alive | type<<4)
export interface RoadGraph {
  nodeCount: number;
  segCount: number;
  nodeCapacity: number;
  segCapacity: number;
  nodePos: Float32Array;
  nodeFlags: Int32Array;
  segNodes: Int32Array;
  segCtrl: Float32Array;
  segFlags: Int32Array;
  freeNodes: number[];
  freeSegs: number[];
  // Bumped on any structural change so renderers know to rebuild meshes.
  version: number;
}

export const createRoadGraph = (nodeCapacity = 4096, segCapacity = 4096): RoadGraph => ({
  nodeCount: 0,
  segCount: 0,
  nodeCapacity,
  segCapacity,
  nodePos: new Float32Array(nodeCapacity * 3),
  nodeFlags: new Int32Array(nodeCapacity),
  segNodes: new Int32Array(segCapacity * 2),
  segCtrl: new Float32Array(segCapacity * 6),
  segFlags: new Int32Array(segCapacity),
  freeNodes: [],
  freeSegs: [],
  version: 0,
});

const growNodes = (g: RoadGraph): void => {
  const cap = g.nodeCapacity * 2;
  const pos = new Float32Array(cap * 3); pos.set(g.nodePos);
  const flags = new Int32Array(cap); flags.set(g.nodeFlags);
  g.nodePos = pos; g.nodeFlags = flags; g.nodeCapacity = cap;
};

const growSegs = (g: RoadGraph): void => {
  const cap = g.segCapacity * 2;
  const nodes = new Int32Array(cap * 2); nodes.set(g.segNodes);
  const ctrl = new Float32Array(cap * 6); ctrl.set(g.segCtrl);
  const flags = new Int32Array(cap); flags.set(g.segFlags);
  g.segNodes = nodes; g.segCtrl = ctrl; g.segFlags = flags; g.segCapacity = cap;
};

export const addNode = (g: RoadGraph, p: Vec3): number => {
  let id = g.freeNodes.pop();
  if (id === undefined) {
    if (g.nodeCount >= g.nodeCapacity) growNodes(g);
    id = g.nodeCount++;
  }
  g.nodePos[id * 3 + 0] = p[0];
  g.nodePos[id * 3 + 1] = p[1];
  g.nodePos[id * 3 + 2] = p[2];
  g.nodeFlags[id] = ALIVE;
  g.version++;
  return id;
};

export const removeNode = (g: RoadGraph, id: number): void => {
  if ((g.nodeFlags[id] ?? 0) === 0) return;
  g.nodeFlags[id] = 0;
  g.freeNodes.push(id);
  g.version++;
};

export const addSegment = (
  g: RoadGraph, a: number, b: number, c0: Vec3, c1: Vec3, type = 0,
): number => {
  let id = g.freeSegs.pop();
  if (id === undefined) {
    if (g.segCount >= g.segCapacity) growSegs(g);
    id = g.segCount++;
  }
  g.segNodes[id * 2 + 0] = a;
  g.segNodes[id * 2 + 1] = b;
  g.segCtrl[id * 6 + 0] = c0[0]; g.segCtrl[id * 6 + 1] = c0[1]; g.segCtrl[id * 6 + 2] = c0[2];
  g.segCtrl[id * 6 + 3] = c1[0]; g.segCtrl[id * 6 + 4] = c1[1]; g.segCtrl[id * 6 + 5] = c1[2];
  g.segFlags[id] = ALIVE | ((type & 0xf) << 4);
  g.version++;
  return id;
};

export const removeSegment = (g: RoadGraph, id: number): void => {
  if ((g.segFlags[id] ?? 0) === 0) return;
  g.segFlags[id] = 0;
  g.freeSegs.push(id);
  g.version++;
};

export const isNodeAlive = (g: RoadGraph, id: number): boolean =>
  ((g.nodeFlags[id] ?? 0) & ALIVE) !== 0;

export const isSegAlive = (g: RoadGraph, id: number): boolean =>
  ((g.segFlags[id] ?? 0) & ALIVE) !== 0;

export const getNodePos = (g: RoadGraph, id: number, out: Vec3 = [0, 0, 0]): Vec3 => {
  out[0] = g.nodePos[id * 3 + 0] ?? 0;
  out[1] = g.nodePos[id * 3 + 1] ?? 0;
  out[2] = g.nodePos[id * 3 + 2] ?? 0;
  return out;
};

export const getSegmentEndpoints = (
  g: RoadGraph, id: number,
): { p0: Vec3; c0: Vec3; c1: Vec3; p1: Vec3 } => {
  const a = g.segNodes[id * 2 + 0]!;
  const b = g.segNodes[id * 2 + 1]!;
  return {
    p0: [g.nodePos[a * 3]!, g.nodePos[a * 3 + 1]!, g.nodePos[a * 3 + 2]!],
    c0: [g.segCtrl[id * 6]!, g.segCtrl[id * 6 + 1]!, g.segCtrl[id * 6 + 2]!],
    c1: [g.segCtrl[id * 6 + 3]!, g.segCtrl[id * 6 + 4]!, g.segCtrl[id * 6 + 5]!],
    p1: [g.nodePos[b * 3]!, g.nodePos[b * 3 + 1]!, g.nodePos[b * 3 + 2]!],
  };
};

// Find the closest live node within `radius` of `p`. Linear scan — fine for
// editor scale (a few thousand nodes). Replace with a spatial index if it
// shows up in profiling.
export const findNearestNode = (
  g: RoadGraph, p: Vec3, radius: number,
): number | null => {
  const r2 = radius * radius;
  let bestId: number | null = null;
  let bestD2 = r2;
  for (let i = 0; i < g.nodeCount; i++) {
    if ((g.nodeFlags[i]! & ALIVE) === 0) continue;
    const dx = (g.nodePos[i * 3]! - p[0]);
    const dz = (g.nodePos[i * 3 + 2]! - p[2]);
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bestId = i; }
  }
  return bestId;
};

// Split a segment at bezier parameter t (0..1, exclusive endpoints). Removes
// the original segment and inserts a new node + two new segments using
// de Casteljau's subdivision so the two halves trace the exact same curve.
// Returns the new node id, or null if t is too close to either endpoint.
export const splitSegment = (g: RoadGraph, segId: number, t: number): number | null => {
  if (!isSegAlive(g, segId)) return null;
  if (t < 0.02 || t > 0.98) return null;
  const { p0, c0, c1, p1 } = getSegmentEndpoints(g, segId);
  const lerp = (a: Vec3, b: Vec3, k: number): Vec3 => [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
  const Q0 = lerp(p0, c0, t);
  const Q1 = lerp(c0, c1, t);
  const Q2 = lerp(c1, p1, t);
  const R0 = lerp(Q0, Q1, t);
  const R1 = lerp(Q1, Q2, t);
  const S  = lerp(R0, R1, t);

  const a = g.segNodes[segId * 2]!;
  const b = g.segNodes[segId * 2 + 1]!;
  const type = (g.segFlags[segId]! >> 4) & 0xf;

  removeSegment(g, segId);
  const newNode = addNode(g, S);
  addSegment(g, a, newNode, Q0, R0, type);
  addSegment(g, newNode, b, R1, Q2, type);
  return newNode;
};

// Closest segment within `tolerance` (meters) on the XZ plane. Returns the
// segment id and parameter t along its bezier — used for hit-testing erase
// and (later) splitting.
export const findNearestSegment = (
  g: RoadGraph, p: Vec3, tolerance: number, samples = 16,
): { seg: number; t: number; pos: Vec3 } | null => {
  const tol2 = tolerance * tolerance;
  let bestSeg: number | null = null;
  let bestT = 0;
  let bestPos: Vec3 = [0, 0, 0];
  let bestD2 = tol2;
  const tmp: Vec3 = [0, 0, 0];
  for (let s = 0; s < g.segCount; s++) {
    if ((g.segFlags[s]! & ALIVE) === 0) continue;
    const e = getSegmentEndpoints(g, s);
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      cubicAt(e.p0, e.c0, e.c1, e.p1, t, tmp);
      const dx = tmp[0] - p[0], dz = tmp[2] - p[2];
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2; bestSeg = s; bestT = t;
        bestPos = [tmp[0], tmp[1], tmp[2]];
      }
    }
  }
  if (bestSeg === null) return null;
  return { seg: bestSeg, t: bestT, pos: bestPos };
};
