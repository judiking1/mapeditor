import { describe, expect, it } from 'vitest';
import { addNode, addSegment, createRoadGraph } from '../road/graph';
import { straightControls } from '../road/bezier';
import { buildGraphSnapshot } from '../graphSnapshot';
import { buildAdjacency } from './adjacency';
import { AStar } from './astar';

const ring = (n: number) => {
  const g = createRoadGraph();
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ids.push(addNode(g, [Math.cos(a) * 100, 0, Math.sin(a) * 100]));
  }
  for (let i = 0; i < n; i++) {
    const a = ids[i]!;
    const b = ids[(i + 1) % n]!;
    const ab = straightControls(
      [Math.cos((i / n) * Math.PI * 2) * 100, 0, Math.sin((i / n) * Math.PI * 2) * 100],
      [Math.cos(((i + 1) / n) * Math.PI * 2) * 100, 0, Math.sin(((i + 1) / n) * Math.PI * 2) * 100],
    );
    addSegment(g, a, b, ab.c0, ab.c1);
  }
  return { graph: g, ids };
};

describe('A* on road graph', () => {
  it('finds path on a ring', () => {
    const { graph } = ring(8);
    const snap = buildGraphSnapshot(graph);
    const adj = buildAdjacency(snap);
    const astar = new AStar();
    const r = astar.find(snap, adj, 0, 4);
    expect(r).not.toBeNull();
    expect(r!.nodes[0]).toBe(0);
    expect(r!.nodes[r!.nodes.length - 1]).toBe(4);
    // Ring has two equal-length sides — either direction (4 hops) is fine.
    expect(r!.nodes.length).toBe(5);
    expect(r!.segs.length).toBe(4);
  });

  it('returns null for unreachable goal', () => {
    const g = createRoadGraph();
    const a = addNode(g, [0, 0, 0]);
    const b = addNode(g, [50, 0, 0]);
    addNode(g, [200, 0, 0]); // isolated
    const ab = straightControls([0, 0, 0], [50, 0, 0]);
    addSegment(g, a, b, ab.c0, ab.c1);
    const snap = buildGraphSnapshot(g);
    const adj = buildAdjacency(snap);
    const astar = new AStar();
    const r = astar.find(snap, adj, 0, 2);
    expect(r).toBeNull();
  });
});
