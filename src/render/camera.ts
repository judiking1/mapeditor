// Orbital RTS camera: tracks a focus point on the ground plane.
// Yaw rotates around world Y, pitch tilts up/down, distance zooms.

import { m4, m4lookAt, m4multiply, m4perspective, type Mat4, type Vec3 } from '../math/vec';

export interface Camera {
  target: Vec3;            // focus point on the ground (y is usually terrain height)
  distance: number;        // meters from target to eye
  yaw: number;             // radians, around +Y; 0 looks toward -Z
  pitch: number;           // radians, 0 = horizontal, +PI/2 = top-down
  fovYRad: number;
  near: number;
  far: number;
  aspect: number;

  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
  eye: Vec3;
}

export const createCamera = (): Camera => ({
  target: [0, 0, 0],
  distance: 350,
  yaw: 0.6,
  pitch: 0.95,
  fovYRad: (45 * Math.PI) / 180,
  near: 0.5,
  far: 5000,
  aspect: 1,
  view: m4(),
  proj: m4(),
  viewProj: m4(),
  eye: [0, 0, 0],
});

export const updateCamera = (c: Camera): void => {
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const cy = Math.cos(c.yaw);
  const sy = Math.sin(c.yaw);
  // Eye orbits target. pitch=0 puts eye level with target; positive pitch lifts it up.
  c.eye[0] = c.target[0] + c.distance * cp * sy;
  c.eye[1] = c.target[1] + c.distance * sp;
  c.eye[2] = c.target[2] + c.distance * cp * cy;

  m4lookAt(c.eye, c.target, [0, 1, 0], c.view);
  m4perspective(c.fovYRad, c.aspect, c.near, c.far, c.proj);
  m4multiply(c.proj, c.view, c.viewProj);
};

// Project a screen-space (x,y) in 0..1 onto the ground plane y=groundY.
// Returns [x, groundY, z] world coordinates, or null if the ray is parallel.
export const screenToGround = (
  c: Camera,
  ndcX: number,
  ndcY: number,
  groundY: number,
): Vec3 | null => {
  // Build inverse viewProj on the fly. For RTS use we don't call this in hot loops.
  const inv = invert4(c.viewProj);
  if (!inv) return null;
  const near = transform([ndcX, ndcY, 0, 1], inv);
  const far = transform([ndcX, ndcY, 1, 1], inv);
  const nx = near[0] / near[3], ny = near[1] / near[3], nz = near[2] / near[3];
  const fx = far[0] / far[3], fy = far[1] / far[3], fz = far[2] / far[3];
  const dx = fx - nx, dy = fy - ny, dz = fz - nz;
  if (Math.abs(dy) < 1e-6) return null;
  const t = (groundY - ny) / dy;
  return [nx + dx * t, groundY, nz + dz * t];
};

const transform = (v: [number, number, number, number], m: Mat4): [number, number, number, number] => {
  const x = v[0], y = v[1], z = v[2], w = v[3];
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]! * w,
  ];
};

const invert4 = (m: Mat4): Mat4 | null => {
  const out = new Float32Array(16);
  const a00 = m[0]!, a01 = m[1]!, a02 = m[2]!, a03 = m[3]!;
  const a10 = m[4]!, a11 = m[5]!, a12 = m[6]!, a13 = m[7]!;
  const a20 = m[8]!, a21 = m[9]!, a22 = m[10]!, a23 = m[11]!;
  const a30 = m[12]!, a31 = m[13]!, a32 = m[14]!, a33 = m[15]!;
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
};
