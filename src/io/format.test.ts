import { describe, expect, it } from 'vitest';
import { addNode, addSegment, createRoadGraph } from '../sim/road/graph';
import { straightControls } from '../sim/road/bezier';
import { decode, encode } from './format';
import { createZoneGrid, ZONE_RES } from '../sim/zoning/grid';
import { addBuilding, createBuildingStore } from '../sim/buildings/store';

const sampleBundle = () => {
  const graph = createRoadGraph();
  const a = addNode(graph, [0, 0, 0]);
  const b = addNode(graph, [100, 0, 50]);
  const c = addNode(graph, [200, 0, 0]);
  const ab = straightControls([0, 0, 0], [100, 0, 50]);
  const bc = straightControls([100, 0, 50], [200, 0, 0]);
  addSegment(graph, a, b, ab.c0, ab.c1, 0);
  addSegment(graph, b, c, bc.c0, bc.c1, 1);
  const zone = createZoneGrid(64, 64, 16);
  zone.cells[0] = ZONE_RES;
  zone.cells[5] = ZONE_RES;
  const buildings = createBuildingStore(128, zone.cells.length);
  addBuilding(buildings, 0, 0, 0, 12, ZONE_RES, 0xabc);
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
    zone,
    buildings,
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
    graph.segFlags[seg] = 0;
    const zone = createZoneGrid(8, 8, 16);
    const buildings = createBuildingStore(16, zone.cells.length);
    const bundle = {
      meta: { name: '', saveTimeMs: 0, seed: 0, worldWidthCells: 1, worldHeightCells: 1, cellSize: 1 },
      graph, zone, buildings,
    };
    const bytes = encode(bundle);
    const decoded = decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    let liveSeg = 0;
    for (let i = 0; i < decoded.graph.segCount; i++) if (decoded.graph.segFlags[i]! & 1) liveSeg++;
    expect(liveSeg).toBe(0);
  });

  it('round-trips zone cells and buildings', () => {
    const bundle = sampleBundle();
    const bytes = encode(bundle);
    const decoded = decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(decoded.zone.cells[0]).toBe(ZONE_RES);
    expect(decoded.zone.cells[5]).toBe(ZONE_RES);
    expect(decoded.zone.cells[1]).toBe(0);
    let live = 0;
    for (let i = 0; i < decoded.buildings.count; i++) if (decoded.buildings.alive[i]) live++;
    expect(live).toBe(1);
    expect(decoded.buildings.cellToBldg[0]).toBeGreaterThanOrEqual(0);
  });
});
