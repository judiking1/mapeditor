// Road-drawing tools. State machine:
//
//   straight: idle -> [click]-> haveStart -> [click]-> committed (chained — the
//             new endpoint becomes the next start, like CS:2 ribbon drawing)
//   curved:   idle -> [click]-> haveStart -> [click]-> haveBend -> [click]-> committed
//   erase:    idle -> [click on segment]-> remove
//
// Click resolution priority:
//   1. Existing node within snapRadius (Shift disables snapping)
//   2. Existing segment within tolerance — splits it at the click point
//   3. Free position snapped to the 8m editor grid
//
// The active tool exposes a preview spec so the renderer shows the in-progress
// segment and (later) snap markers.

import type { Vec3 } from '../math/vec';
import {
  addNode,
  addSegment,
  findNearestNode,
  findNearestSegment,
  getNodePos,
  removeSegment,
  splitSegment,
  type RoadGraph,
} from '../sim/road/graph';
import { curvedControls, straightControls } from '../sim/road/bezier';
import type { Tool, ToolContext, ToolPreview } from './types';

const GRID_SNAP = 8; // meters
const SEGMENT_SNAP_TOL = 9; // meters — clicking within this of a road snaps to it

const snapToGrid = (v: Vec3): Vec3 => [
  Math.round(v[0] / GRID_SNAP) * GRID_SNAP,
  v[1],
  Math.round(v[2] / GRID_SNAP) * GRID_SNAP,
];

interface Resolved {
  pos: Vec3;
  // Existing node id if the resolve already binds to one, else null.
  existing: number | null;
  // Pending split: a segment hit that hasn't been split yet (deferred until
  // commit so onPointerMove never mutates the graph).
  pendingSplit?: { seg: number; t: number } | undefined;
  // Visual hint for renderers that want to draw a snap dot.
  hint: 'node' | 'segment' | 'free';
}

const resolvePoint = (graph: RoadGraph, ctx: ToolContext): Resolved | null => {
  if (!ctx.groundPos) return null;
  if (!ctx.shift) {
    const id = findNearestNode(graph, ctx.groundPos, ctx.snapRadius);
    if (id !== null) return { pos: getNodePos(graph, id), existing: id, hint: 'node' };
    const hit = findNearestSegment(graph, ctx.groundPos, Math.min(ctx.snapRadius, SEGMENT_SNAP_TOL));
    if (hit && hit.t > 0.05 && hit.t < 0.95) {
      return { pos: hit.pos, existing: null, pendingSplit: { seg: hit.seg, t: hit.t }, hint: 'segment' };
    }
  }
  return { pos: snapToGrid(ctx.groundPos), existing: null, hint: 'free' };
};

// Convert a Resolved into a definite node id, performing any deferred segment
// split. Caller already knows the position; returns the node id to connect.
const ensureNode = (graph: RoadGraph, r: Resolved): number => {
  if (r.existing !== null) return r.existing;
  if (r.pendingSplit) {
    const id = splitSegment(graph, r.pendingSplit.seg, r.pendingSplit.t);
    if (id !== null) return id;
  }
  return addNode(graph, r.pos);
};

export const createStraightRoadTool = (graph: RoadGraph): Tool => {
  let start: Resolved | null = null;
  let cursor: Resolved | null = null;

  return {
    id: 'road-straight',
    onPointerMove: (ctx) => { cursor = resolvePoint(graph, ctx); },
    onPointerDown: (ctx, button) => {
      if (button !== 0) return;
      const p = resolvePoint(graph, ctx);
      if (!p) return;
      if (!start) {
        start = p;
        return;
      }
      if (Math.hypot(p.pos[0] - start.pos[0], p.pos[2] - start.pos[2]) < 1) return;
      const a = ensureNode(graph, start);
      const b = ensureNode(graph, p);
      const aPos = getNodePos(graph, a);
      const bPos = getNodePos(graph, b);
      const { c0, c1 } = straightControls(aPos, bPos);
      addSegment(graph, a, b, c0, c1, 0);
      start = { pos: bPos, existing: b, hint: 'node' };
    },
    onKey: (key, down) => { if (down && key === 'Escape') start = null; },
    onDeactivate: () => { start = null; cursor = null; },
    preview: (): ToolPreview => {
      if (!start || !cursor) return {};
      const { c0, c1 } = straightControls(start.pos, cursor.pos);
      return { road: { p0: start.pos, c0, c1, p1: cursor.pos } };
    },
  };
};

export const createCurvedRoadTool = (graph: RoadGraph): Tool => {
  let start: Resolved | null = null;
  let bend: Vec3 | null = null;
  let cursor: Resolved | null = null;

  return {
    id: 'road-curved',
    onPointerMove: (ctx) => { cursor = resolvePoint(graph, ctx); },
    onPointerDown: (ctx, button) => {
      if (button !== 0) return;
      const p = resolvePoint(graph, ctx);
      if (!p) return;
      if (!start) { start = p; return; }
      if (!bend) { bend = p.pos; return; }
      if (Math.hypot(p.pos[0] - start.pos[0], p.pos[2] - start.pos[2]) < 1) return;
      const a = ensureNode(graph, start);
      const b = ensureNode(graph, p);
      const aPos = getNodePos(graph, a);
      const bPos = getNodePos(graph, b);
      const { c0, c1 } = curvedControls(aPos, bend, bPos);
      addSegment(graph, a, b, c0, c1, 0);
      start = { pos: bPos, existing: b, hint: 'node' };
      bend = null;
    },
    onKey: (key, down) => {
      if (!down) return;
      if (key === 'Escape') { start = null; bend = null; }
    },
    onDeactivate: () => { start = null; bend = null; cursor = null; },
    preview: (): ToolPreview => {
      if (!start || !cursor) return {};
      const useBend = bend ?? midpoint(start.pos, cursor.pos);
      const { c0, c1 } = curvedControls(start.pos, useBend, cursor.pos);
      return { road: { p0: start.pos, c0, c1, p1: cursor.pos } };
    },
  };
};

export const createEraseTool = (graph: RoadGraph): Tool => ({
  id: 'road-erase',
  onPointerDown: (ctx, button) => {
    if (button !== 0 || !ctx.groundPos) return;
    const hit = findNearestSegment(graph, ctx.groundPos, 8);
    if (hit) removeSegment(graph, hit.seg);
  },
  preview: () => ({}),
});

const midpoint = (a: Vec3, b: Vec3): Vec3 => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  (a[2] + b[2]) / 2,
];
