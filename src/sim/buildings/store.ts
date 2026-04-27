// Building store. SoA + a parallel cell→buildingId index so we can answer
// "is this cell built?" in O(1). Footprint is one zone cell; per-instance
// data carries height + type + per-instance seed for shader-side variation.

export interface BuildingStore {
  capacity: number;
  count: number;       // high-water mark of allocated slots
  alive: Uint8Array;   // 1 if slot occupied
  // Per-slot instance attributes
  posX: Float32Array;
  posZ: Float32Array;
  height: Float32Array;
  typeAndSeed: Int32Array; // low 4 bits = zone type, high 28 bits = seed
  // Reverse index: zone-cell index → building slot id, or -1.
  cellToBldg: Int32Array;
  free: number[];
  version: number;
}

export const createBuildingStore = (capacity: number, totalCells: number): BuildingStore => {
  const cellToBldg = new Int32Array(totalCells);
  cellToBldg.fill(-1);
  return {
    capacity,
    count: 0,
    alive: new Uint8Array(capacity),
    posX: new Float32Array(capacity),
    posZ: new Float32Array(capacity),
    height: new Float32Array(capacity),
    typeAndSeed: new Int32Array(capacity),
    cellToBldg,
    free: [],
    version: 0,
  };
};

export const addBuilding = (
  s: BuildingStore,
  cellIdx: number,
  posX: number,
  posZ: number,
  height: number,
  type: number,
  seed: number,
): number | null => {
  if (s.cellToBldg[cellIdx]! >= 0) return null;
  let id = s.free.pop();
  if (id === undefined) {
    if (s.count >= s.capacity) return null;
    id = s.count++;
  }
  s.alive[id] = 1;
  s.posX[id] = posX;
  s.posZ[id] = posZ;
  s.height[id] = height;
  s.typeAndSeed[id] = (type & 0xf) | ((seed & 0x0fffffff) << 4);
  s.cellToBldg[cellIdx] = id;
  s.version++;
  return id;
};

export const removeBuildingAtCell = (s: BuildingStore, cellIdx: number): boolean => {
  const id = s.cellToBldg[cellIdx]!;
  if (id < 0) return false;
  s.alive[id] = 0;
  s.cellToBldg[cellIdx] = -1;
  s.free.push(id);
  s.version++;
  return true;
};

export const buildingInstanceBytes = (s: BuildingStore): number => s.count * 16;

// Pack live buildings into a Float32 instance buffer:
//   stride 4 floats: [posX, posZ, height, typeAndSeedAsFloatBits]
// We reinterpret the int as a float so the shader can decode via bitcast.
export const packInstanceBuffer = (s: BuildingStore): { data: Float32Array; count: number } => {
  // Allocate exact size for live buildings.
  let live = 0;
  for (let i = 0; i < s.count; i++) if (s.alive[i]) live++;
  const data = new Float32Array(live * 4);
  const ints = new Int32Array(data.buffer);
  let o = 0;
  for (let i = 0; i < s.count; i++) {
    if (!s.alive[i]) continue;
    data[o] = s.posX[i]!;
    data[o + 1] = s.posZ[i]!;
    data[o + 2] = s.height[i]!;
    ints[o + 3] = s.typeAndSeed[i]!;
    o += 4;
  }
  return { data, count: live };
};
