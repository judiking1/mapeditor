// Fixed-timestep accumulator. Caller pumps real elapsed ms; we yield N steps.
// Cap accumulator to avoid spiral-of-death after a tab regains focus.

import { TICK_MS } from '../worker/protocol';

export interface Clock {
  acc: number;
  tick: number;
  simTimeMs: number;
  scale: number; // 0 (paused), 1, 3, 9
}

export const createClock = (): Clock => ({ acc: 0, tick: 0, simTimeMs: 0, scale: 1 });

export const advance = (c: Clock, dtMs: number): number => {
  if (c.scale === 0) return 0;
  c.acc += dtMs * c.scale;
  if (c.acc > TICK_MS * 8) c.acc = TICK_MS * 8;
  let steps = 0;
  while (c.acc >= TICK_MS) {
    c.acc -= TICK_MS;
    c.tick++;
    c.simTimeMs += TICK_MS;
    steps++;
  }
  return steps;
};
