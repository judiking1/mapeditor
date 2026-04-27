// Minimal vector/matrix helpers used by the renderer + sim.
// Plain functions on tuple arrays — no classes; aliases mirror gl-matrix shape.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Mat4 = Float32Array;

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];

export const v3add = (a: Vec3, b: Vec3, out: Vec3 = [0, 0, 0]): Vec3 => {
  out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2];
  return out;
};

export const v3sub = (a: Vec3, b: Vec3, out: Vec3 = [0, 0, 0]): Vec3 => {
  out[0] = a[0] - b[0]; out[1] = a[1] - b[1]; out[2] = a[2] - b[2];
  return out;
};

export const v3scale = (a: Vec3, s: number, out: Vec3 = [0, 0, 0]): Vec3 => {
  out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s;
  return out;
};

export const v3len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export const v3normalize = (a: Vec3, out: Vec3 = [0, 0, 0]): Vec3 => {
  const l = v3len(a);
  if (l < 1e-9) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
  const inv = 1 / l;
  out[0] = a[0] * inv; out[1] = a[1] * inv; out[2] = a[2] * inv;
  return out;
};

export const v3cross = (a: Vec3, b: Vec3, out: Vec3 = [0, 0, 0]): Vec3 => {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
};

export const v3dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const m4 = (): Mat4 => {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
};

export const m4identity = (out: Mat4): Mat4 => {
  out.fill(0);
  out[0] = 1; out[5] = 1; out[10] = 1; out[15] = 1;
  return out;
};

export const m4multiply = (a: Mat4, b: Mat4, out: Mat4): Mat4 => {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!;
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!;
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!;
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!;

  let b0 = b[0]!, b1 = b[1]!, b2 = b[2]!, b3 = b[3]!;
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4]!; b1 = b[5]!; b2 = b[6]!; b3 = b[7]!;
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8]!; b1 = b[9]!; b2 = b[10]!; b3 = b[11]!;
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12]!; b1 = b[13]!; b2 = b[14]!; b3 = b[15]!;
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
};

// Right-handed perspective, depth 0..1 (WebGPU-style). For WebGL we'll convert.
export const m4perspective = (
  fovYRad: number,
  aspect: number,
  near: number,
  far: number,
  out: Mat4,
): Mat4 => {
  const f = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far * nf;
  out[11] = -1;
  out[14] = far * near * nf;
  return out;
};

// Right-handed, +Y up, looking from eye toward target.
export const m4lookAt = (eye: Vec3, target: Vec3, up: Vec3, out: Mat4): Mat4 => {
  const f: Vec3 = [0, 0, 0];
  v3normalize(v3sub(target, eye, f), f);
  const s: Vec3 = [0, 0, 0];
  v3normalize(v3cross(f, up, s), s);
  const u: Vec3 = [0, 0, 0];
  v3cross(s, f, u);

  out[0] = s[0]; out[1] = u[0]; out[2] = -f[0]; out[3] = 0;
  out[4] = s[1]; out[5] = u[1]; out[6] = -f[1]; out[7] = 0;
  out[8] = s[2]; out[9] = u[2]; out[10] = -f[2]; out[11] = 0;
  out[12] = -v3dot(s, eye);
  out[13] = -v3dot(u, eye);
  out[14] = v3dot(f, eye);
  out[15] = 1;
  return out;
};
