// Build a triangle ribbon mesh for all live segments. Vertices are interleaved
// position(3) + edgeFlag(1) where edgeFlag is 0 at the centerline and 1 at the
// curb — fragment shader uses it for lane stripe + curb shading.

import type { Vec3 } from '../../math/vec';
import { cubicAt, cubicTangent } from './bezier';
import { getSegmentEndpoints, type RoadGraph } from './graph';

export interface RoadMesh {
  positions: Float32Array; // (x,y,z, edgeFlag) per vertex; stride 4 floats
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
}

export interface RoadMeshOpts {
  samplesPerSegment: number;
  halfWidth: number;
  yLift: number;
}

export const DEFAULT_ROAD_OPTS: RoadMeshOpts = {
  samplesPerSegment: 18,
  halfWidth: 6,
  yLift: 0.06,
};

const FLOATS_PER_VERT = 4;

const aliveSegmentCount = (g: RoadGraph): number => {
  let n = 0;
  for (let s = 0; s < g.segCount; s++) if ((g.segFlags[s]! & 1) !== 0) n++;
  return n;
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
  const pos: Vec3 = [0, 0, 0];
  const tan: Vec3 = [0, 0, 0];

  for (let s = 0; s < g.segCount; s++) {
    if ((g.segFlags[s]! & 1) === 0) continue;
    const { p0, c0, c1, p1 } = getSegmentEndpoints(g, s);
    const v0 = vBase / FLOATS_PER_VERT;

    for (let i = 0; i <= N; i++) {
      const t = i / N;
      cubicAt(p0, c0, c1, p1, t, pos);
      cubicTangent(p0, c0, c1, p1, t, tan);
      // Perpendicular on XZ plane (right-hand): n = (tz, 0, -tx)
      const tx = tan[0], tz = tan[2];
      const tlen = Math.hypot(tx, tz);
      const inv = tlen < 1e-6 ? 0 : 1 / tlen;
      const nx = tz * inv, nz = -tx * inv;
      const lx = pos[0] - nx * opts.halfWidth;
      const lz = pos[2] - nz * opts.halfWidth;
      const rx = pos[0] + nx * opts.halfWidth;
      const rz = pos[2] + nz * opts.halfWidth;

      // left vertex
      positions[vBase + 0] = lx;
      positions[vBase + 1] = pos[1] + opts.yLift;
      positions[vBase + 2] = lz;
      positions[vBase + 3] = -1; // edge flag, -1 = left curb
      // right vertex
      positions[vBase + 4] = rx;
      positions[vBase + 5] = pos[1] + opts.yLift;
      positions[vBase + 6] = rz;
      positions[vBase + 7] = 1;  // right curb
      vBase += FLOATS_PER_VERT * 2;
    }

    for (let i = 0; i < N; i++) {
      const a = v0 + i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices[iBase + 0] = a;
      indices[iBase + 1] = c;
      indices[iBase + 2] = b;
      indices[iBase + 3] = b;
      indices[iBase + 4] = c;
      indices[iBase + 5] = d;
      iBase += 6;
    }
  }

  return {
    positions,
    indices,
    vertexCount: vBase / FLOATS_PER_VERT,
    indexCount: iBase,
  };
};

// Build a mesh for a single preview segment (not yet committed). Same layout
// as the main road mesh so the same shader/pipeline can render it.
export const buildPreviewMesh = (
  p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3,
  opts: RoadMeshOpts = DEFAULT_ROAD_OPTS,
): RoadMesh => {
  const N = opts.samplesPerSegment;
  const positions = new Float32Array((N + 1) * 2 * FLOATS_PER_VERT);
  const indices = new Uint32Array(N * 6);
  const pos: Vec3 = [0, 0, 0];
  const tan: Vec3 = [0, 0, 0];
  let vBase = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    cubicAt(p0, c0, c1, p1, t, pos);
    cubicTangent(p0, c0, c1, p1, t, tan);
    const tx = tan[0], tz = tan[2];
    const tlen = Math.hypot(tx, tz);
    const inv = tlen < 1e-6 ? 0 : 1 / tlen;
    const nx = tz * inv, nz = -tx * inv;
    const lx = pos[0] - nx * opts.halfWidth;
    const lz = pos[2] - nz * opts.halfWidth;
    const rx = pos[0] + nx * opts.halfWidth;
    const rz = pos[2] + nz * opts.halfWidth;
    positions[vBase + 0] = lx; positions[vBase + 1] = pos[1] + opts.yLift; positions[vBase + 2] = lz; positions[vBase + 3] = -1;
    positions[vBase + 4] = rx; positions[vBase + 5] = pos[1] + opts.yLift; positions[vBase + 6] = rz; positions[vBase + 7] = 1;
    vBase += FLOATS_PER_VERT * 2;
  }
  let iBase = 0;
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    indices[iBase++] = a;
    indices[iBase++] = a + 2;
    indices[iBase++] = a + 1;
    indices[iBase++] = a + 1;
    indices[iBase++] = a + 2;
    indices[iBase++] = a + 3;
  }
  return { positions, indices, vertexCount: (N + 1) * 2, indexCount: N * 6 };
};
