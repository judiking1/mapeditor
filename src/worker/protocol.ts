// Wire protocol between the main thread and the simulation worker.
// All messages are typed; no `any`. Numbers are plain JS numbers — bulk arrays
// (heightmaps, vehicle SoA) are transferred as ArrayBuffers in `transfer`.

export type SimToMain =
  | { type: 'ready'; capabilities: { sab: boolean } }
  | { type: 'tick'; simTick: number; simTimeMs: number; vehiclesAlive: number }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; msg: string };

export type MainToSim =
  | {
      type: 'init';
      seed: number;
      worldWidthCells: number;
      worldHeightCells: number;
      cellSizeMeters: number;
    }
  | { type: 'setTimeScale'; scale: 0 | 1 | 3 | 9 }
  | { type: 'shutdown' };

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
