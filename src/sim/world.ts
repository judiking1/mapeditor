// Authoritative world state. Lives inside the worker. Main thread sees only
// snapshots/messages. Heightmap is a Float32Array of size width*height,
// row-major (z then x).

export interface World {
  seed: number;
  widthCells: number;
  heightCells: number;
  cellSize: number;        // meters per cell
  heightmap: Float32Array; // length widthCells * heightCells
  // Future milestones append: roads, buildings, vehicles (all SoA)
}

export const createWorld = (
  seed: number,
  widthCells: number,
  heightCells: number,
  cellSize: number,
): World => ({
  seed,
  widthCells,
  heightCells,
  cellSize,
  heightmap: new Float32Array(widthCells * heightCells),
});

export const heightAt = (w: World, cx: number, cz: number): number => {
  const x = Math.max(0, Math.min(w.widthCells - 1, cx | 0));
  const z = Math.max(0, Math.min(w.heightCells - 1, cz | 0));
  return w.heightmap[z * w.widthCells + x] ?? 0;
};
