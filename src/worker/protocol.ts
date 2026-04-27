// Wire protocol between the main thread and the simulation worker.
// All messages are typed; no `any`. Bulk arrays (graph snapshot, vehicle
// render buffer) are transferred as ArrayBuffers and reconstructed on the
// other side as typed-array views.

export interface GraphSnapshotMsg {
  version: number;
  nodeCount: number;
  segCount: number;
  nodePos: ArrayBuffer;   // Float32Array, 3 * nodeCount
  segNodes: ArrayBuffer;  // Int32Array,   2 * segCount
  segCtrl: ArrayBuffer;   // Float32Array, 6 * segCount
  segLen: ArrayBuffer;    // Float32Array, segCount
  segType: ArrayBuffer;   // Int32Array,   segCount
}

// Render-side vehicle data layout. One entry per slot, stride 4 floats:
//   [posX, posY, posZ, heading]
export const VEHICLE_RENDER_STRIDE_F32 = 4;
export const VEHICLE_RENDER_STRIDE_BYTES = VEHICLE_RENDER_STRIDE_F32 * 4;

// Header layout (Int32Array view at offset 0):
//   [0] aliveCount, [1] frameCounter (atomic-ish), [2] capacity, [3] reserved
export const VEHICLE_HEADER_I32 = 4;
export const VEHICLE_HEADER_BYTES = VEHICLE_HEADER_I32 * 4;

export const computeVehicleSabBytes = (capacity: number): number =>
  VEHICLE_HEADER_BYTES + capacity * VEHICLE_RENDER_STRIDE_BYTES;

export type SimToMain =
  | {
      type: 'ready';
      capabilities: { sab: boolean };
      // Either a SharedArrayBuffer or a transferable ArrayBuffer for the
      // vehicle render data. Worker ping-pongs by re-sending an updated copy
      // each tick when SAB isn't available.
      vehicleSab: SharedArrayBuffer | null;
      vehicleCapacity: number;
    }
  | { type: 'tick'; simTick: number; simTimeMs: number; vehiclesAlive: number }
  | {
      type: 'vehiclesFallback';
      tick: number;
      aliveCount: number;
      buffer: ArrayBuffer; // Float32Array, capacity * 4 floats
    }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string };

export type MainToSim =
  | {
      type: 'init';
      seed: number;
      worldWidthCells: number;
      worldHeightCells: number;
      cellSizeMeters: number;
      vehicleCapacity: number;
    }
  | { type: 'graphSnapshot'; snapshot: GraphSnapshotMsg }
  | { type: 'spawnVehicles'; count: number }
  | { type: 'clearVehicles' }
  | { type: 'setTimeScale'; scale: 0 | 1 | 3 | 9 }
  | { type: 'shutdown' };

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
export const TICK_SECONDS = 1 / TICK_HZ;
