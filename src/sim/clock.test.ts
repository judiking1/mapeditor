import { describe, expect, it } from 'vitest';
import { advance, createClock } from './clock';
import { TICK_MS } from '../worker/protocol';

describe('clock', () => {
  it('does not advance while paused', () => {
    const c = createClock();
    c.scale = 0;
    expect(advance(c, 1000)).toBe(0);
    expect(c.tick).toBe(0);
  });

  it('produces N steps for N*TICK_MS at scale 1', () => {
    const c = createClock();
    c.scale = 1;
    const steps = advance(c, TICK_MS * 5 + 1);
    expect(steps).toBe(5);
    expect(c.tick).toBe(5);
  });

  it('clamps accumulator to avoid catch-up storms', () => {
    const c = createClock();
    c.scale = 1;
    const steps = advance(c, 5000); // 5s = ~150 ticks naive
    expect(steps).toBeLessThanOrEqual(8);
  });
});
