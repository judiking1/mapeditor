// Build a triangle ribbon mesh for all live segments. Per-vertex layout:
//   pos.xyz (3 floats) | edge (1 float, -1 left curb, +1 right) | along (1 float, meters)
// The shader uses `edge` for curb / lane stripe shaping and `along` for
// dashed center-line marks that move with arc length, not parameter.

import type { Vec3 } from '../../math/vec';
import { cubicAt, cubicTangent } from './bezier';
import { getSegmentEndpoints, type RoadGraph } from './graph';

export interface RoadMesh {
  positions: Float32Array; // stride 5 floats (20 bytes)
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export interface RoadMeshOpts {
  samplesPerSegment: number;
  halfWidth: number;
  yLift: number;
  // Pull each ribbon end back by this many meters so junction caps can cover
  // the perpendicular cut without showing a gap. 0 = no inset.
  endInset: number;
}

export const DEFAULT_ROAD_OPTS: RoadMeshOpts = {
  samplesPerSegment: 22,
  halfWidth: 6,
  yLift: 0.06,
  endInset: 5.5,
};

export const PREVIEW_ROAD_OPTS: RoadMeshOpts = {
  ...DEFAULT_ROAD_OPTS,
  endInset: 0, // preview shouldn't be trimmed
};

const FLOATS_PER_VERT = 5;

const aliveSegmentCount = (g: RoadGraph): number => {
  let n = 0;
  for (let s = 0; s < g.segCount; s++) if ((g.segFlags[s]! & 1) !== 0) n++;
  return n;
};

// Sample a bezier and emit ribbon verts for parameter range [tStart..tEnd]
// where the endpoints are clipped by `endInset` meters of arc length on each
// side so junction caps can cover the seam.
const emitRibbon = (
  positions: Float32Array, indices: Uint32Array,
  vBase: number, iBase: number,
  p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3,
  N: number, halfWidth: number, yLift: number, endInset: number,
): { vBase: number; iBase: number } => {
  // First pass: tabulate position and cumulative arc length at each sample.
  const samples = new Float32Array((N + 1) * 4); // x, y, z, cumLen
  const tmp: Vec3 = [0, 0, 0];
  cubicAt(p0, c0, c1, p1, 0, tmp);
  samples[0] = tmp[0]; samples[1] = tmp[1]; samples[2] = tmp[2]; samples[3] = 0;
  let cum = 0;
  let px = tmp[0], pz = tmp[2];
  for (let i = 1; i <= N; i++) {
    cubicAt(p0, c0, c1, p1, i / N, tmp);
    cum += Math.hypot(tmp[0] - px, tmp[2] - pz);
    px = tmp[0]; pz = tmp[2];
    samples[i * 4] = tmp[0]; samples[i * 4 + 1] = tmp[1]; samples[i * 4 + 2] = tmp[2]; samples[i * 4 + 3] = cum;
  }
  const totalLen = cum;
  // Inset clamp — never collapse the segment to nothing.
  const inset = Math.min(endInset, totalLen * 0.42);

  const v0 = vBase / FLOATS_PER_VERT;
  for (let i = 0; i <= N; i++) {
    const sx = samples[i * 4]!;
    const sy = samples[i * 4 + 1]!;
    const sz = samples[i * 4 + 2]!;
    let along = samples[i * 4 + 3]!;
    // Snap the first/last samples inward by `inset` along the polyline so
    // ribbon ends pull back from the node.
    let useX = sx, useZ = sz, useAlong = along;
    if (along < inset) {
      // Lerp toward the next sample until we cross `inset`.
      let j = i;
      while (j < N && samples[j * 4 + 3]! < inset) j++;
      const a = samples[(j - 1) * 4 + 3]!;
      const b = samples[j * 4 + 3]!;
      const span = Math.max(1e-6, b - a);
      const t = (inset - a) / span;
      useX = samples[(j - 1) * 4]! + t * (samples[j * 4]! - samples[(j - 1) * 4]!);
      useZ = samples[(j - 1) * 4 + 2]! + t * (samples[j * 4 + 2]! - samples[(j - 1) * 4 + 2]!);
      useAlong = inset;
    } else if (along > totalLen - inset) {
      let j = i;
      while (j > 0 && samples[j * 4 + 3]! > totalLen - inset) j--;
      const a = samples[j * 4 + 3]!;
      const b = samples[(j + 1) * 4 + 3]!;
      const span = Math.max(1e-6, b - a);
      const t = (totalLen - inset - a) / span;
      useX = samples[j * 4]! + t * (samples[(j + 1) * 4]! - samples[j * 4]!);
      useZ = samples[j * 4 + 2]! + t * (samples[(j + 1) * 4 + 2]! - samples[j * 4 + 2]!);
      useAlong = totalLen - inset;
    }

    // Tangent at the original parameter is fine for normal direction.
    const tan: Vec3 = [0, 0, 0];
    cubicTangent(p0, c0, c1, p1, i / N, tan);
    const tx = tan[0], tz = tan[2];
    const tlen = Math.hypot(tx, tz);
    const inv = tlen < 1e-6 ? 0 : 1 / tlen;
    const nx = tz * inv, nz = -tx * inv;

    const lx = useX - nx * halfWidth;
    const lz = useZ - nz * halfWidth;
    const rx = useX + nx * halfWidth;
    const rz = useZ + nz * halfWidth;

    positions[vBase + 0] = lx;
    positions[vBase + 1] = sy + yLift;
    positions[vBase + 2] = lz;
    positions[vBase + 3] = -1;
    positions[vBase + 4] = useAlong;

    positions[vBase + 5] = rx;
    positions[vBase + 6] = sy + yLift;
    positions[vBase + 7] = rz;
    positions[vBase + 8] = 1;
    positions[vBase + 9] = useAlong;

    vBase += FLOATS_PER_VERT * 2;
  }

  for (let i = 0; i < N; i++) {
    const a = v0 + i * 2;
    const b = a + 1, c = a + 2, d = a + 3;
    indices[iBase + 0] = a;
    indices[iBase + 1] = c;
    indices[iBase + 2] = b;
    indices[iBase + 3] = b;
    indices[iBase + 4] = c;
    indices[iBase + 5] = d;
    iBase += 6;
  }
  return { vBase, iBase };
};

export const buildRoadMesh = (g: RoadGraph, opts: RoadMeshOpts = DEFAULT_ROAD_OPTS): RoadMesh => {
  const alive = aliveSegmentCount(g);
  const N = opts.samplesPerSegment;
  const vertsPerSeg = (N + 1) * 2;
  const idxPerSeg = N * 6;
  const positions = new Float32Array(alive * vertsPerSeg * FLOATS_PER_VERT);
  const indices = new Uint32Array(alive * idxPerSeg);

  if (alive === 0) {
    return { positions, indices, vertexCount: 0, indexCount: 0 };
  }

  let vBase = 0;
  let iBase = 0;
  for (let s = 0; s < g.segCount; s++) {
    if ((g.segFlags[s]! & 1) === 0) continue;
    const e = getSegmentEndpoints(g, s);
    const r = emitRibbon(positions, indices, vBase, iBase, e.p0, e.c0, e.c1, e.p1,
      N, opts.halfWidth, opts.yLift, opts.endInset);
    vBase = r.vBase;
    iBase = r.iBase;
  }

  return {
    positions,
    indices,
    vertexCount: vBase / FLOATS_PER_VERT,
    indexCount: iBase,
  };
};

export const buildPreviewMesh = (
  p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3,
  opts: RoadMeshOpts = PREVIEW_ROAD_OPTS,
): RoadMesh => {
  const N = opts.samplesPerSegment;
  const positions = new Float32Array((N + 1) * 2 * FLOATS_PER_VERT);
  const indices = new Uint32Array(N * 6);
  emitRibbon(positions, indices, 0, 0, p0, c0, c1, p1,
    N, opts.halfWidth, opts.yLift, opts.endInset);
  return { positions, indices, vertexCount: (N + 1) * 2, indexCount: N * 6 };
};
