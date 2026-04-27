// Compact road-graph snapshot designed for transfer to the worker.
// Only live nodes/segments are included, IDs are densely re-numbered, and
// per-segment bezier length is precomputed (vehicles need it every tick).
// All payloads are typed-arrays so the snapshot can be transferred zero-copy.

import { cubicLength } from './road/bezier';
import { isNodeAlive, isSegAlive, type RoadGraph } from './road/graph';

export interface GraphSnapshot {
  version: number;
  nodeCount: number;
  segCount: number;
  // Live, dense data
  nodePos: Float32Array;     // 3 * nodeCount
  segNodes: Int32Array;      // 2 * segCount (a, b)
  segCtrl: Float32Array;     // 6 * segCount
  segLen: Float32Array;      // segCount
  segType: Int32Array;       // segCount
}

export const buildGraphSnapshot = (g: RoadGraph): GraphSnapshot => {
  // Count live entities first so we can size the typed arrays exactly.
  let nodes = 0, segs = 0;
  const remap = new Int32Array(g.nodeCount);
  remap.fill(-1);
  for (let i = 0; i < g.nodeCount; i++) {
    if (!isNodeAlive(g, i)) continue;
    remap[i] = nodes++;
  }
  for (let s = 0; s < g.segCount; s++) {
    if (!isSegAlive(g, s)) continue;
    segs++;
  }

  const nodePos = new Float32Array(nodes * 3);
  const segNodes = new Int32Array(segs * 2);
  const segCtrl = new Float32Array(segs * 6);
  const segLen = new Float32Array(segs);
  const segType = new Int32Array(segs);

  for (let i = 0; i < g.nodeCount; i++) {
    if (!isNodeAlive(g, i)) continue;
    const r = remap[i]!;
    nodePos[r * 3] = g.nodePos[i * 3]!;
    nodePos[r * 3 + 1] = g.nodePos[i * 3 + 1]!;
    nodePos[r * 3 + 2] = g.nodePos[i * 3 + 2]!;
  }

  let outSeg = 0;
  for (let s = 0; s < g.segCount; s++) {
    if (!isSegAlive(g, s)) continue;
    const a = g.segNodes[s * 2]!;
    const b = g.segNodes[s * 2 + 1]!;
    const ra = remap[a]!;
    const rb = remap[b]!;
    if (ra < 0 || rb < 0) continue;
    segNodes[outSeg * 2] = ra;
    segNodes[outSeg * 2 + 1] = rb;
    for (let k = 0; k < 6; k++) segCtrl[outSeg * 6 + k] = g.segCtrl[s * 6 + k]!;
    const p0: [number, number, number] = [nodePos[ra * 3]!, nodePos[ra * 3 + 1]!, nodePos[ra * 3 + 2]!];
    const p1: [number, number, number] = [nodePos[rb * 3]!, nodePos[rb * 3 + 1]!, nodePos[rb * 3 + 2]!];
    const c0: [number, number, number] = [segCtrl[outSeg * 6]!, segCtrl[outSeg * 6 + 1]!, segCtrl[outSeg * 6 + 2]!];
    const c1: [number, number, number] = [segCtrl[outSeg * 6 + 3]!, segCtrl[outSeg * 6 + 4]!, segCtrl[outSeg * 6 + 5]!];
    segLen[outSeg] = Math.max(0.001, cubicLength(p0, c0, c1, p1, 24));
    segType[outSeg] = (g.segFlags[s]! >> 4) & 0xf;
    outSeg++;
  }

  return {
    version: g.version,
    nodeCount: nodes,
    segCount: segs,
    nodePos, segNodes, segCtrl, segLen, segType,
  };
};

export const snapshotTransferList = (s: GraphSnapshot): Transferable[] => [
  s.nodePos.buffer,
  s.segNodes.buffer,
  s.segCtrl.buffer,
  s.segLen.buffer,
  s.segType.buffer,
];
