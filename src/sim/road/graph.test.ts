import { describe, expect, it } from 'vitest';
import {
  addNode,
  addSegment,
  createRoadGraph,
  findNearestNode,
  findNearestSegment,
  getNodePos,
  isNodeAlive,
  isSegAlive,
  removeSegment,
  splitSegment,
} from './graph';
import { straightControls } from './bezier';

describe('road graph', () => {
  it('reuses freed segment ids', () => {
    const g = createRoadGraph();
    const a = addNode(g, [0, 0, 0]);
    const b = addNode(g, [50, 0, 0]);
    const { c0, c1 } = straightControls([0, 0, 0], [50, 0, 0]);
    const s = addSegment(g, a, b, c0, c1);
    expect(isSegAlive(g, s)).toBe(true);
    removeSegment(g, s);
    expect(isSegAlive(g, s)).toBe(false);
    const s2 = addSegment(g, a, b, c0, c1);
    expect(s2).toBe(s);
  });

  it('finds nearest node within radius', () => {
    const g = createRoadGraph();
    addNode(g, [0, 0, 0]);
    const id = addNode(g, [100, 0, 0]);
    addNode(g, [200, 0, 0]);
    expect(findNearestNode(g, [99, 0, 1], 10)).toBe(id);
    expect(findNearestNode(g, [50, 0, 0], 5)).toBeNull();
  });

  it('hit-tests a segment along its bezier', () => {
    const g = createRoadGraph();
    const a = addNode(g, [0, 0, 0]);
    const b = addNode(g, [100, 0, 0]);
    const { c0, c1 } = straightControls([0, 0, 0], [100, 0, 0]);
    const s = addSegment(g, a, b, c0, c1);
    const hit = findNearestSegment(g, [50, 0, 1], 5);
    expect(hit?.seg).toBe(s);
    expect(hit?.t).toBeCloseTo(0.5, 1);
  });

  it('bumps version on mutations', () => {
    const g = createRoadGraph();
    const v0 = g.version;
    addNode(g, [0, 0, 0]);
    expect(g.version).toBeGreaterThan(v0);
  });

  it('splits a straight segment at midpoint into two halves', () => {
    const g = createRoadGraph();
    const a = addNode(g, [0, 0, 0]);
    const b = addNode(g, [100, 0, 0]);
    const { c0, c1 } = straightControls([0, 0, 0], [100, 0, 0]);
    const seg = addSegment(g, a, b, c0, c1);
    const newId = splitSegment(g, seg, 0.5);
    expect(newId).not.toBeNull();
    expect(isNodeAlive(g, newId!)).toBe(true);
    const pos = getNodePos(g, newId!);
    expect(pos[0]).toBeCloseTo(50, 4);
    expect(pos[2]).toBeCloseTo(0, 4);
    // After the split there should be exactly two live segments, each
    // connecting (a, newNode) or (newNode, b) — no leftover (a, b) edge.
    let live = 0;
    let abFound = false, anFound = false, nbFound = false;
    for (let i = 0; i < g.segCount; i++) {
      if (!isSegAlive(g, i)) continue;
      live++;
      const ea = g.segNodes[i * 2]!;
      const eb = g.segNodes[i * 2 + 1]!;
      const pair = (x: number, y: number) =>
        (ea === x && eb === y) || (ea === y && eb === x);
      if (pair(a, b)) abFound = true;
      if (pair(a, newId!)) anFound = true;
      if (pair(newId!, b)) nbFound = true;
    }
    expect(live).toBe(2);
    expect(abFound).toBe(false);
    expect(anFound).toBe(true);
    expect(nbFound).toBe(true);
  });

  it('refuses to split very near an endpoint', () => {
    const g = createRoadGraph();
    const a = addNode(g, [0, 0, 0]);
    const b = addNode(g, [100, 0, 0]);
    const { c0, c1 } = straightControls([0, 0, 0], [100, 0, 0]);
    const seg = addSegment(g, a, b, c0, c1);
    expect(splitSegment(g, seg, 0.001)).toBeNull();
    expect(splitSegment(g, seg, 0.999)).toBeNull();
    expect(isSegAlive(g, seg)).toBe(true);
  });
});
