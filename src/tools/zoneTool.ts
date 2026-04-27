// Paint zone cells while the left button is held. Brush radius is fixed
// (3 cells) — Shift toggles erase mode.

import { paintBrush, type ZoneGrid, type ZoneKind, ZONE_NONE } from '../sim/zoning/grid';
import type { Tool, ToolContext } from './types';

export const createZoneTool = (grid: ZoneGrid, zone: ZoneKind): Tool => {
  let painting = false;

  const paint = (ctx: ToolContext): void => {
    if (!ctx.groundPos) return;
    const z: ZoneKind = ctx.shift ? ZONE_NONE : zone;
    paintBrush(grid, ctx.groundPos[0], ctx.groundPos[2], 3, z);
  };

  return {
    id: `zone-${zone}`,
    onPointerDown: (ctx, button) => {
      if (button !== 0) return;
      painting = true;
      paint(ctx);
    },
    onPointerMove: (ctx) => { if (painting) paint(ctx); },
    onPointerUp: () => { painting = false; },
    onDeactivate: () => { painting = false; },
    preview: () => ({}),
  };
};
