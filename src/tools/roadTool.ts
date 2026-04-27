// Road-drawing tools. State machine:
//
//   straight: idle -> [click]-> haveStart -> [click]-> committed (back to idle but
//             with last endpoint queued as next start, like CS:2 chained drawing)
//   curved:   idle -> [click]-> haveStart -> [click]-> haveBend -> [click]-> committed
//   erase:    idle -> [click on segment]-> remove
//
// The active tool exposes a preview so the renderer can show the in-progress
// segment. Snapping is to existing nodes within snapRadius (Shift disables).

import type { Vec3 } from '../math/vec';
import { addNode, addSegment, findNearestNode, findNearestSegment, getNodePos, removeSegment, type RoadGraph } from '../sim/road/graph';
import { curvedControls, straightControls } from '../sim/road/bezier';
import type { Tool, ToolContext, ToolPreview } from './types';

const GRID_SNAP = 8; // meters

const snapToGrid = (v: Vec3): Vec3 => [
  Math.round(v[0] / GRID_SNAP) * GRID_SNAP,
  v[1],
  Math.round(v[2] / GRID_SNAP) * GRID_SNAP,
];

// Resolve "where the next click would land": existing node if close enough,
// otherwise grid-snapped cursor. Returns the world position used and the node
// id if it's an existing node (so we can reuse it in the segment).
const resolvePoint = (
  graph: RoadGraph, ctx: ToolContext,
): { pos: Vec3; existing: number | null } | null => {
  if (!ctx.groundPos) return null;
  if (!ctx.shift) {
    const id = findNearestNode(graph, ctx.groundPos, ctx.snapRadius);
    if (id !== null) return { pos: getNodePos(graph, id), existing: id };
  }
  return { pos: snapToGrid(ctx.groundPos), existing: null };
};

export const createStraightRoadTool = (graph: RoadGraph): Tool => {
  let start: { pos: Vec3; existing: number | null } | null = null;
  let cursor: { pos: Vec3; existing: number | null } | null = null;

  return {
    id: 'road-straight',
    onPointerMove: (ctx) => {
      cursor = resolvePoint(graph, ctx);
    },
    onPointerDown: (ctx, button) => {
      if (button !== 0) return;
      const p = resolvePoint(graph, ctx);
      if (!p) return;
      if (!start) {
        start = p;
        return;
      }
      // Skip zero-length placements
      if (Math.hypot(p.pos[0] - start.pos[0], p.pos[2] - start.pos[2]) < 1) {
        return;
      }
      const a = start.existing ?? addNode(graph, start.pos);
      const b = p.existing ?? addNode(graph, p.pos);
      const { c0, c1 } = straightControls(start.pos, p.pos);
      addSegment(graph, a, b, c0, c1, 0);
      // Chain: next segment starts where we just ended.
      start = { pos: p.pos, existing: b };
    },
    onKey: (key, down) => {
      if (down && key === 'Escape') start = null;
    },
    onDeactivate: () => { start = null; cursor = null; },
    preview: (): ToolPreview => {
      if (!start || !cursor) return {};
      const { c0, c1 } = straightControls(start.pos, cursor.pos);
      return { road: { p0: start.pos, c0, c1, p1: cursor.pos } };
    },
  };
};

export const createCurvedRoadTool = (graph: RoadGraph): Tool => {
  let start: { pos: Vec3; existing: number | null } | null = null;
  let bend: Vec3 | null = null;
  let cursor: { pos: Vec3; existing: number | null } | null = null;

  return {
    id: 'road-curved',
    onPointerMove: (ctx) => {
      cursor = resolvePoint(graph, ctx);
    },
    onPointerDown: (ctx, button) => {
      if (button !== 0) return;
      const p = resolvePoint(graph, ctx);
      if (!p) return;
      if (!start) {
        start = p;
        return;
      }
      if (!bend) {
        // Don't snap the bend point — it's a free control handle.
        bend = p.pos;
        return;
      }
      if (Math.hypot(p.pos[0] - start.pos[0], p.pos[2] - start.pos[2]) < 1) return;
      const a = start.existing ?? addNode(graph, start.pos);
      const b = p.existing ?? addNode(graph, p.pos);
      const { c0, c1 } = curvedControls(start.pos, bend, p.pos);
      addSegment(graph, a, b, c0, c1, 0);
      // Chain: next segment starts where we just ended; bend resets.
      start = { pos: p.pos, existing: b };
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
