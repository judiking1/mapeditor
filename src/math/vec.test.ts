import { describe, expect, it } from 'vitest';
import { m4, m4identity, m4lookAt, m4multiply, m4perspective, v3cross, v3normalize } from './vec';

describe('vec', () => {
  it('cross product is right-handed', () => {
    const r = v3cross([1, 0, 0], [0, 1, 0]);
    expect(r).toEqual([0, 0, 1]);
  });

  it('normalize preserves direction', () => {
    const r = v3normalize([3, 0, 4]);
    expect(r[0]).toBeCloseTo(0.6, 5);
    expect(r[2]).toBeCloseTo(0.8, 5);
  });
});

describe('mat4', () => {
  it('identity * identity = identity', () => {
    const a = m4identity(m4());
    const b = m4identity(m4());
    const out = m4();
    m4multiply(a, b, out);
    for (let i = 0; i < 16; i++) {
      expect(out[i]).toBe(a[i]);
    }
  });

  it('lookAt eye on +Z looking at origin produces -Z forward', () => {
    const view = m4();
    m4lookAt([0, 0, 10], [0, 0, 0], [0, 1, 0], view);
    const proj = m4();
    m4perspective(Math.PI / 4, 1, 0.1, 100, proj);
    const vp = m4();
    m4multiply(proj, view, vp);
    expect(vp[15]).toBeCloseTo(10, 4);
  });
});
