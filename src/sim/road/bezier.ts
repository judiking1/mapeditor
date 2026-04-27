// Cubic Bezier helpers for road segments. Tangent is the derivative;
// length is approximated by uniform sampling — fine for editor-side use.
// Sim-side path traversal uses precomputed lookup tables (added in M4).

import type { Vec3 } from '../../math/vec';

export const cubicAt = (
  p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3, t: number,
  out: Vec3 = [0, 0, 0],
): Vec3 => {
  const u = 1 - t;
  const b0 = u * u * u;
  const b1 = 3 * u * u * t;
  const b2 = 3 * u * t * t;
  const b3 = t * t * t;
  out[0] = b0 * p0[0] + b1 * c0[0] + b2 * c1[0] + b3 * p1[0];
  out[1] = b0 * p0[1] + b1 * c0[1] + b2 * c1[1] + b3 * p1[1];
  out[2] = b0 * p0[2] + b1 * c0[2] + b2 * c1[2] + b3 * p1[2];
  return out;
};

export const cubicTangent = (
  p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3, t: number,
  out: Vec3 = [0, 0, 0],
): Vec3 => {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  out[0] = a * (c0[0] - p0[0]) + b * (c1[0] - c0[0]) + c * (p1[0] - c1[0]);
  out[1] = a * (c0[1] - p0[1]) + b * (c1[1] - c0[1]) + c * (p1[1] - c1[1]);
  out[2] = a * (c0[2] - p0[2]) + b * (c1[2] - c0[2]) + c * (p1[2] - c1[2]);
  return out;
};

export const cubicLength = (
  p0: Vec3, c0: Vec3, c1: Vec3, p1: Vec3, samples = 16,
): number => {
  let len = 0;
  let px = p0[0], py = p0[1], pz = p0[2];
  const cur: Vec3 = [0, 0, 0];
  for (let i = 1; i <= samples; i++) {
    cubicAt(p0, c0, c1, p1, i / samples, cur);
    len += Math.hypot(cur[0] - px, cur[1] - py, cur[2] - pz);
    px = cur[0]; py = cur[1]; pz = cur[2];
  }
  return len;
};

// Default control points that make A→B render as a straight segment but still
// fit the cubic data model. Splitting at 1/3 and 2/3 keeps curvature zero.
export const straightControls = (a: Vec3, b: Vec3): { c0: Vec3; c1: Vec3 } => {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return {
    c0: [a[0] + dx / 3, a[1] + dy / 3, a[2] + dz / 3],
    c1: [a[0] + (2 * dx) / 3, a[1] + (2 * dy) / 3, a[2] + (2 * dz) / 3],
  };
};

// For a "curved" tool with 3 clicks (start, bend, end), use the bend as both
// inner controls — yields a cubic that visually matches a quadratic through
// the bend point.
export const curvedControls = (a: Vec3, bend: Vec3, b: Vec3): { c0: Vec3; c1: Vec3 } => ({
  c0: [bend[0], bend[1], bend[2]],
  c1: [bend[0], bend[1], bend[2]],
});
