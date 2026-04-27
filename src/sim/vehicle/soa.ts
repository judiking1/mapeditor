// Vehicle storage. The hot per-tick fields live in TypedArrays keyed by slot
// index. Path data is sized per-vehicle (variable length), so we keep it as a
// flat Int32Array packed with offsets — this avoids per-vehicle JS object
// allocations.

const PATH_RING_CAP = 32; // upper bound on path length (nodes) we plan ahead

export interface VehicleArrays {
  capacity: number;
  alive: Uint8Array;     // 1 = active

  // World transform
  posX: Float32Array;
  posY: Float32Array;
  posZ: Float32Array;
  heading: Float32Array; // radians around +Y, 0 = facing +Z

  // Traversal
  segId: Int32Array;     // current segment in snapshot space
  dir: Uint8Array;       // 0 = a->b, 1 = b->a
  t: Float32Array;       // 0..1 along segment in `dir`
  speed: Float32Array;   // m/s

  // Path: flat ring of node IDs per vehicle (PATH_RING_CAP wide).
  // pathNodes[i*PATH_RING_CAP + k] is the (k)th remaining node for vehicle i,
  // 0..pathLen[i]-1; the next one to reach is at pathHead[i].
  pathNodes: Int32Array;
  pathLen: Int32Array;
  pathHead: Int32Array;

  freeList: number[];
  count: number;
}

export const createVehicleArrays = (capacity: number): VehicleArrays => ({
  capacity,
  alive: new Uint8Array(capacity),
  posX: new Float32Array(capacity),
  posY: new Float32Array(capacity),
  posZ: new Float32Array(capacity),
  heading: new Float32Array(capacity),
  segId: new Int32Array(capacity),
  dir: new Uint8Array(capacity),
  t: new Float32Array(capacity),
  speed: new Float32Array(capacity),
  pathNodes: new Int32Array(capacity * PATH_RING_CAP),
  pathLen: new Int32Array(capacity),
  pathHead: new Int32Array(capacity),
  freeList: [],
  count: 0,
});

export const allocSlot = (v: VehicleArrays): number | null => {
  let id = v.freeList.pop();
  if (id === undefined) {
    if (v.count >= v.capacity) return null;
    id = v.count++;
  }
  v.alive[id] = 1;
  return id;
};

export const freeSlot = (v: VehicleArrays, id: number): void => {
  if (!v.alive[id]) return;
  v.alive[id] = 0;
  v.pathLen[id] = 0;
  v.pathHead[id] = 0;
  v.freeList.push(id);
};

export const setPath = (v: VehicleArrays, id: number, nodes: Int32Array): void => {
  // Path nodes include the current node (path[0]) and downstream nodes.
  const n = Math.min(nodes.length, PATH_RING_CAP);
  for (let k = 0; k < n; k++) v.pathNodes[id * PATH_RING_CAP + k] = nodes[k]!;
  v.pathLen[id] = n;
  v.pathHead[id] = 0;
};

export const peekNextNode = (v: VehicleArrays, id: number): number | null => {
  const head = v.pathHead[id]!;
  const next = head + 1;
  if (next >= v.pathLen[id]!) return null;
  return v.pathNodes[id * PATH_RING_CAP + next]!;
};

export const advancePathHead = (v: VehicleArrays, id: number): void => {
  v.pathHead[id] = v.pathHead[id]! + 1;
};

export { PATH_RING_CAP };
