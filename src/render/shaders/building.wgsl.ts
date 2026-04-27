export const buildingShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;

struct VSIn {
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  // Per-instance: x, z, height, bitcast<u32>(typeAndSeed)
  @location(2) inst: vec4<f32>,
};

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) tint: vec3<f32>,
  @location(3) heightHint: f32,
};

const FOOTPRINT: f32 = 14.0;

fn zoneTint(t: u32, seed: u32) -> vec3<f32> {
  var base: vec3<f32>;
  if (t == 1u) { base = vec3<f32>(0.85, 0.78, 0.65); }       // res - warm beige
  else if (t == 2u) { base = vec3<f32>(0.55, 0.72, 0.85); }  // com - cool teal
  else if (t == 3u) { base = vec3<f32>(0.78, 0.62, 0.40); }  // ind - muted brown
  else { base = vec3<f32>(0.5, 0.5, 0.5); }
  let s = f32((seed >> 8u) & 0xFFu) / 255.0;
  let s2 = f32((seed >> 16u) & 0xFFu) / 255.0;
  let jitter = vec3<f32>(s - 0.5, s2 - 0.5, (s + s2) * 0.5 - 0.5) * 0.12;
  return clamp(base + jitter, vec3<f32>(0.0), vec3<f32>(1.0));
}

@vertex
fn vs(in: VSIn) -> VSOut {
  // localPos is the unit cube [-0.5..0.5] in X,Z; [0..1] in Y.
  let height = in.inst.z;
  let bits = bitcast<u32>(in.inst.w);
  let world = vec3<f32>(
    in.localPos.x * FOOTPRINT + in.inst.x,
    in.localPos.y * height,
    in.localPos.z * FOOTPRINT + in.inst.y,
  );

  let t = bits & 0xfu;
  let seed = bits >> 4u;

  var out: VSOut;
  out.clip = cam.viewProj * vec4<f32>(world, 1.0);
  out.world = world;
  out.normal = in.localNormal;
  out.tint = zoneTint(t, seed);
  out.heightHint = height;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let l = normalize(vec3<f32>(0.4, 0.9, 0.2));
  let lambert = max(dot(n, l), 0.0);
  let amb = mix(vec3<f32>(0.18, 0.20, 0.24), vec3<f32>(0.95, 0.95, 0.92), n.y * 0.5 + 0.5) * 0.35;

  // Cheap window stripes: only on side faces (|n.y| < 0.5). Stripes are
  // horizontal bands every ~3.5m of world Y.
  let isSide = step(abs(n.y), 0.5);
  let band = fract(in.world.y / 3.5);
  let win = smoothstep(0.45, 0.5, band) * (1.0 - smoothstep(0.55, 0.6, band));
  let winCol = mix(in.tint, vec3<f32>(0.95, 0.92, 0.55), 0.55);
  var col = in.tint * (amb + lambert * 0.85);
  col = mix(col, winCol, win * isSide * 0.45);

  // Top face slightly darker for visual separation.
  let isTop = step(0.95, n.y);
  col = mix(col, col * 0.78, isTop);

  return vec4<f32>(col, 1.0);
}
`;
