/// <reference lib="webworker" />
// Simulation worker. Owns:
//   - the authoritative tick clock (30Hz)
//   - the latest road graph snapshot + derived adjacency
//   - the vehicle SoA + per-tick movement
//   - the render-side vehicle buffer (SharedArrayBuffer when isolation allows,
//     otherwise a freshly-allocated transferable per tick)

import {
  computeVehicleSabBytes,
  TICK_SECONDS,
  VEHICLE_HEADER_BYTES,
  VEHICLE_HEADER_I32,
  VEHICLE_RENDER_STRIDE_F32,
  type GraphSnapshotMsg,
  type MainToSim,
  type SimToMain,
} from './protocol';
import { advance, createClock } from '../sim/clock';
import { createWorld, type World } from '../sim/world';
import { buildAdjacency, type Adjacency } from '../sim/path/adjacency';
import { AStar } from '../sim/path/astar';
import type { GraphSnapshot } from '../sim/graphSnapshot';
import {
  createVehicleArrays,
  freeSlot,
  type VehicleArrays,
} from '../sim/vehicle/soa';
import { despawnInvalidated, spawnRandomVehicle } from '../sim/vehicle/spawn';
import { tickVehicles } from '../sim/vehicle/move';
import { writeRenderSnapshot } from '../sim/vehicle/render';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let world: World | null = null;
const clock = createClock();
let timer: ReturnType<typeof setInterval> | null = null;
let lastNow = 0;
let ticksSinceLastReport = 0;

let snapshot: GraphSnapshot | null = null;
let adjacency: Adjacency | null = null;
let vehicles: VehicleArrays | null = null;
const astar = new AStar();
const rng = { random: () => Math.random() };

let vehicleCapacity = 0;
let vehicleSab: SharedArrayBuffer | null = null;
let sabHeader: Int32Array | null = null;
let sabData: Float32Array | null = null;

let pendingSpawn = 0;

const post = (msg: SimToMain, transfer: Transferable[] = []): void => {
  ctx.postMessage(msg, transfer);
};

const initVehicleBuffers = (capacity: number): SharedArrayBuffer | null => {
  vehicleCapacity = capacity;
  if (typeof SharedArrayBuffer === 'undefined') return null;
  try {
    const sab = new SharedArrayBuffer(computeVehicleSabBytes(capacity));
    vehicleSab = sab;
    sabHeader = new Int32Array(sab, 0, VEHICLE_HEADER_I32);
    sabData = new Float32Array(sab, VEHICLE_HEADER_BYTES, capacity * VEHICLE_RENDER_STRIDE_F32);
    sabHeader[0] = 0;
    sabHeader[1] = 0;
    sabHeader[2] = capacity;
    sabHeader[3] = 0;
    return sab;
  } catch {
    vehicleSab = null;
    sabHeader = null;
    sabData = null;
    return null;
  }
};

const start = (): void => {
  if (timer !== null) return;
  lastNow = performance.now();
  timer = setInterval(() => {
    const now = performance.now();
    const dt = now - lastNow;
    lastNow = now;
    const steps = advance(clock, dt);
    if (steps > 0) tick(steps);
  }, 4);
};

const stop = (): void => {
  if (timer !== null) clearInterval(timer);
  timer = null;
};

const onGraphSnapshot = (m: GraphSnapshotMsg): void => {
  snapshot = {
    version: m.version,
    nodeCount: m.nodeCount,
    segCount: m.segCount,
    nodePos: new Float32Array(m.nodePos),
    segNodes: new Int32Array(m.segNodes),
    segCtrl: new Float32Array(m.segCtrl),
    segLen: new Float32Array(m.segLen),
    segType: new Int32Array(m.segType),
  };
  adjacency = buildAdjacency(snapshot);
  if (vehicles) despawnInvalidated(vehicles, snapshot);
};

const tick = (steps: number): void => {
  if (!vehicles || !snapshot || !adjacency) return;

  if (pendingSpawn > 0 && snapshot.segCount > 0) {
    const tries = Math.min(pendingSpawn, 64);
    for (let i = 0; i < tries; i++) {
      if (spawnRandomVehicle(vehicles, snapshot, adjacency, astar, rng) === null) break;
      pendingSpawn--;
    }
  }

  let alive = 0;
  for (let s = 0; s < steps; s++) {
    alive = tickVehicles(vehicles, snapshot, adjacency, TICK_SECONDS);
  }

  if (vehicleSab && sabHeader && sabData) {
    writeRenderSnapshot(vehicles, { header: sabHeader, data: sabData }, clock.tick);
  } else {
    // Fallback: allocate a fresh transferable per tick.
    const buf = new ArrayBuffer(computeVehicleSabBytes(vehicleCapacity));
    const header = new Int32Array(buf, 0, VEHICLE_HEADER_I32);
    const data = new Float32Array(buf, VEHICLE_HEADER_BYTES, vehicleCapacity * VEHICLE_RENDER_STRIDE_F32);
    writeRenderSnapshot(vehicles, { header, data }, clock.tick);
    post({ type: 'vehiclesFallback', tick: clock.tick, aliveCount: alive, buffer: buf }, [buf]);
  }

  ticksSinceLastReport += steps;
  if (ticksSinceLastReport >= 3) {
    post({ type: 'tick', simTick: clock.tick, simTimeMs: clock.simTimeMs, vehiclesAlive: alive });
    ticksSinceLastReport = 0;
  }
};

ctx.onmessage = (ev: MessageEvent<MainToSim>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init': {
      world = createWorld(msg.seed, msg.worldWidthCells, msg.worldHeightCells, msg.cellSizeMeters);
      vehicles = createVehicleArrays(msg.vehicleCapacity);
      const sab = initVehicleBuffers(msg.vehicleCapacity);
      post({
        type: 'ready',
        capabilities: { sab: sab !== null },
        vehicleSab: sab,
        vehicleCapacity: msg.vehicleCapacity,
      });
      start();
      break;
    }
    case 'graphSnapshot':
      onGraphSnapshot(msg.snapshot);
      break;
    case 'spawnVehicles':
      pendingSpawn += msg.count;
      break;
    case 'clearVehicles':
      if (vehicles) {
        for (let i = 0; i < vehicles.count; i++) if (vehicles.alive[i]) freeSlot(vehicles, i);
      }
      break;
    case 'setTimeScale':
      clock.scale = msg.scale;
      break;
    case 'shutdown':
      stop();
      break;
  }
};

void world;
