export const buildingShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;

struct VSIn {
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  @location(2) inst: vec4<f32>,  // x, z, height, bitcast<u32>(typeAndSeed)
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
  if (t == 1u) { base = vec3<f32>(0.85, 0.78, 0.65); }       // res
  else if (t == 2u) { base = vec3<f32>(0.55, 0.72, 0.85); }  // com
  else if (t == 3u) { base = vec3<f32>(0.78, 0.62, 0.40); }  // ind
  else { base = vec3<f32>(0.5, 0.5, 0.5); }
  let s  = f32((seed >> 8u) & 0xFFu) / 255.0;
  let s2 = f32((seed >> 16u) & 0xFFu) / 255.0;
  let jitter = vec3<f32>(s - 0.5, s2 - 0.5, (s + s2) * 0.5 - 0.5) * 0.16;
  return clamp(base + jitter, vec3<f32>(0.0), vec3<f32>(1.0));
}

@vertex
fn vs(in: VSIn) -> VSOut {
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

const SUN_DIR = vec3<f32>(0.42, 0.82, 0.39);
const SUN_COL = vec3<f32>(1.00, 0.97, 0.88);
const SKY_COL = vec3<f32>(0.65, 0.78, 0.92);
const GND_COL = vec3<f32>(0.32, 0.30, 0.28);
const FOG_COL = vec3<f32>(0.78, 0.85, 0.95);

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let L = normalize(SUN_DIR);
  let nDotL = max(dot(n, L), 0.0);
  let hemi = mix(GND_COL, SKY_COL, n.y * 0.5 + 0.5);

  // Window stripes only on side faces (|n.y| small). Bands every ~3.5m of
  // world Y; mixed with a warm window color.
  let isSide = step(abs(n.y), 0.5);
  let band = fract(in.world.y / 3.5);
  let win = smoothstep(0.42, 0.50, band) * (1.0 - smoothstep(0.55, 0.62, band));
  let winCol = mix(in.tint, vec3<f32>(0.95, 0.90, 0.55), 0.65);

  var albedo = in.tint;
  albedo = mix(albedo, winCol, win * isSide * 0.55);
  let isTop = step(0.95, n.y);
  albedo = mix(albedo, albedo * 0.72, isTop);

  var col = albedo * (hemi * 0.55 + SUN_COL * nDotL * 0.95);

  let dist = length(in.world - cam.eye.xyz);
  let f = 1.0 - exp(-max(dist - 200.0, 0.0) * 0.0009);
  col = mix(col, FOG_COL, clamp(f, 0.0, 0.85));

  return vec4<f32>(col, 1.0);
}
`;
