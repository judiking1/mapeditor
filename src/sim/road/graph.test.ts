import { describe, expect, it } from 'vitest';
import {
  addNode,
  addSegment,
  createRoadGraph,
  findNearestNode,
  findNearestSegment,
  isSegAlive,
  removeSegment,
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
});
