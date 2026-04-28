// Collect a junction list from the live graph: one disk per node that has
// at least one incident segment. Renderer uses this to draw asphalt caps
// over the perpendicular ribbon ends so intersections look like actual
// intersections and not "two ribbons stacked".

import { isNodeAlive, isSegAlive, type RoadGraph } from './graph';

export interface JunctionList {
  count: number;
  // Stride 4 floats: x, z, radius, _pad
  data: Float32Array;
}

const ROAD_HALF_WIDTH = 6;

export const collectJunctions = (g: RoadGraph): JunctionList => {
  const degree = new Int32Array(g.nodeCount);
  for (let s = 0; s < g.segCount; s++) {
    if (!isSegAlive(g, s)) continue;
    const a = g.segNodes[s * 2]!;
    const b = g.segNodes[s * 2 + 1]!;
    degree[a] = (degree[a] ?? 0) + 1;
    degree[b] = (degree[b] ?? 0) + 1;
  }
  let count = 0;
  for (let i = 0; i < g.nodeCount; i++) {
    if (!isNodeAlive(g, i)) continue;
    if ((degree[i] ?? 0) > 0) count++;
  }
  const data = new Float32Array(count * 4);
  let o = 0;
  // Slightly larger than the ribbon inset so the cap fully covers the seam.
  // Higher-degree junctions get a small bump for cleaner visuals.
  for (let i = 0; i < g.nodeCount; i++) {
    if (!isNodeAlive(g, i)) continue;
    const d = degree[i] ?? 0;
    if (d === 0) continue;
    const radius = ROAD_HALF_WIDTH + 0.5 + (d > 2 ? 1.2 : 0);
    data[o] = g.nodePos[i * 3]!;
    data[o + 1] = g.nodePos[i * 3 + 2]!;
    data[o + 2] = radius;
    data[o + 3] = 0;
    o += 4;
  }
  return { count, data };
};
