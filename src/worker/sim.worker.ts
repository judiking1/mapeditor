/// <reference lib="webworker" />
// Simulation worker. Runs the authoritative game loop at fixed 30Hz.
// In M0 it just confirms handshake and ticks an empty world. Later milestones
// add roads, vehicles, and economy without touching the main thread.

import type { MainToSim, SimToMain } from './protocol';
import { TICK_MS } from './protocol';
import { advance, createClock } from '../sim/clock';
import { createWorld, type World } from '../sim/world';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let world: World | null = null;
const clock = createClock();
let timer: ReturnType<typeof setInterval> | null = null;
let lastNow = 0;
let ticksSinceLastReport = 0;

const post = (msg: SimToMain, transfer: Transferable[] = []): void => {
  ctx.postMessage(msg, transfer);
};

const start = (): void => {
  if (timer !== null) return;
  lastNow = performance.now();
  // We tick the loop frequently and let the accumulator decide how many steps
  // to actually advance. 4ms gives smooth scaling without busy-waiting.
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

const tick = (steps: number): void => {
  // M0: world is empty; just count ticks. Later we update vehicles, traffic, etc.
  ticksSinceLastReport += steps;
  // Report at most ~10x/s to avoid flooding postMessage.
  if (ticksSinceLastReport >= 3) {
    post({
      type: 'tick',
      simTick: clock.tick,
      simTimeMs: clock.simTimeMs,
      vehiclesAlive: 0,
    });
    ticksSinceLastReport = 0;
  }
};

ctx.onmessage = (ev: MessageEvent<MainToSim>): void => {
  const msg = ev.data;
  switch (msg.type) {
    case 'init':
      world = createWorld(msg.seed, msg.worldWidthCells, msg.worldHeightCells, msg.cellSizeMeters);
      start();
      break;
    case 'setTimeScale':
      clock.scale = msg.scale;
      break;
    case 'shutdown':
      stop();
      break;
  }
};

// SharedArrayBuffer support depends on cross-origin-isolation headers being applied.
const sabOk = typeof SharedArrayBuffer !== 'undefined';
post({ type: 'ready', capabilities: { sab: sabOk } });

void world; // referenced in later milestones
void TICK_MS;
