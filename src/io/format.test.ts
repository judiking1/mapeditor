import { describe, expect, it } from 'vitest';
import { addNode, addSegment, createRoadGraph } from '../sim/road/graph';
import { straightControls } from '../sim/road/bezier';
import { decode, encode } from './format';

const sampleBundle = () => {
  const graph = createRoadGraph();
  const a = addNode(graph, [0, 0, 0]);
  const b = addNode(graph, [100, 0, 50]);
  const c = addNode(graph, [200, 0, 0]);
  const ab = straightControls([0, 0, 0], [100, 0, 50]);
  const bc = straightControls([100, 0, 50], [200, 0, 0]);
  addSegment(graph, a, b, ab.c0, ab.c1, 0);
  addSegment(graph, b, c, bc.c0, bc.c1, 1);
  return {
    meta: {
      name: 'test-city',
      saveTimeMs: 1700000000000,
      seed: 42,
      worldWidthCells: 1024,
      worldHeightCells: 512,
      cellSize: 8,
    },
    graph,
  };
};

describe('save format', () => {
  it('round-trips meta + roads', () => {
    const bundle = sampleBundle();
    const bytes = encode(bundle);
    const decoded = decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(decoded.meta).toEqual(bundle.meta);
    // Counts should match (compaction may reuse ids but counts of live entities are preserved).
    let live = 0;
    for (let i = 0; i < decoded.graph.nodeCount; i++) if (decoded.graph.nodeFlags[i]! & 1) live++;
    expect(live).toBe(3);
    let liveSeg = 0;
    for (let i = 0; i < decoded.graph.segCount; i++) if (decoded.graph.segFlags[i]! & 1) liveSeg++;
    expect(liveSeg).toBe(2);
  });

  it('rejects bad magic', () => {
    const bytes = new Uint8Array([0x42, 0x41, 0x44, 0x21, 1, 0, 0, 0]);
    expect(() => decode(bytes.buffer)).toThrow();
  });

  it('skips dead nodes/segments on encode', () => {
    const graph = createRoadGraph();
    const a = addNode(graph, [0, 0, 0]);
    const b = addNode(graph, [100, 0, 0]);
    const ab = straightControls([0, 0, 0], [100, 0, 0]);
    const seg = addSegment(graph, a, b, ab.c0, ab.c1, 0);
    // Mark seg dead
    graph.segFlags[seg] = 0;
    const bundle = { meta: { name: '', saveTimeMs: 0, seed: 0, worldWidthCells: 1, worldHeightCells: 1, cellSize: 1 }, graph };
    const bytes = encode(bundle);
    const decoded = decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    let liveSeg = 0;
    for (let i = 0; i < decoded.graph.segCount; i++) if (decoded.graph.segFlags[i]! & 1) liveSeg++;
    expect(liveSeg).toBe(0);
  });
});
