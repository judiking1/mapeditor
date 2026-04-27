// Zone grid: a coarse 2D map of cells (16m on a side by default) to zone
// types. The world is centered on the origin so cells span [-W/2..+W/2] in
// X and Z. The grid bumps a version counter on every change so the renderer
// and auto-placer can react cheaply.

export const ZONE_NONE = 0;
export const ZONE_RES = 1;
export const ZONE_COM = 2;
export const ZONE_IND = 3;
export type ZoneKind = 0 | 1 | 2 | 3;

export interface ZoneGrid {
  width: number;          // cells in X
  height: number;         // cells in Z
  cellSize: number;       // meters per cell
  originX: number;        // world X of cell (0,0)'s minimum corner
  originZ: number;        // world Z of cell (0,0)'s minimum corner
  cells: Uint8Array;      // length width*height
  version: number;
}

export const createZoneGrid = (width = 512, height = 512, cellSize = 16): ZoneGrid => {
  const originX = -(width * cellSize) / 2;
  const originZ = -(height * cellSize) / 2;
  return {
    width, height, cellSize,
    originX, originZ,
    cells: new Uint8Array(width * height),
    version: 0,
  };
};

export const cellIndex = (g: ZoneGrid, cx: number, cz: number): number => cz * g.width + cx;

export const worldToCell = (g: ZoneGrid, x: number, z: number): { cx: number; cz: number } => ({
  cx: Math.floor((x - g.originX) / g.cellSize),
  cz: Math.floor((z - g.originZ) / g.cellSize),
});

export const cellToWorldCenter = (g: ZoneGrid, cx: number, cz: number): { x: number; z: number } => ({
  x: g.originX + (cx + 0.5) * g.cellSize,
  z: g.originZ + (cz + 0.5) * g.cellSize,
});

export const inBounds = (g: ZoneGrid, cx: number, cz: number): boolean =>
  cx >= 0 && cz >= 0 && cx < g.width && cz < g.height;

// Paint a circular brush of `radius` cells centered at the world-space (x,z).
// Returns the number of cells changed so callers can decide whether to bump
// downstream invalidation (we already bump g.version internally).
export const paintBrush = (
  g: ZoneGrid,
  worldX: number,
  worldZ: number,
  radiusCells: number,
  zone: ZoneKind,
): number => {
  const center = worldToCell(g, worldX, worldZ);
  const r = Math.max(0, radiusCells | 0);
  let changed = 0;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const cx = center.cx + dx;
      const cz = center.cz + dz;
      if (!inBounds(g, cx, cz)) continue;
      const idx = cellIndex(g, cx, cz);
      if (g.cells[idx] !== zone) {
        g.cells[idx] = zone;
        changed++;
      }
    }
  }
  if (changed > 0) g.version++;
  return changed;
};
