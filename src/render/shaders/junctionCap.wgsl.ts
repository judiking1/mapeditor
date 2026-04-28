export const junctionCapShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};
@group(0) @binding(0) var<uniform> cam: Camera;

struct VSIn {
  // Local disk: (x, z) in [-1..+1]; r = sqrt(x*x+z*z) in [0..1]; center vert is (0,0).
  @location(0) local: vec2<f32>,
  // Per-instance: x, z, radius, _pad
  @location(1) inst: vec4<f32>,
};
struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
  @location(1) localR: f32,
};

const Y_LIFT: f32 = 0.07; // sit slightly above the road ribbon

@vertex
fn vs(in: VSIn) -> VSOut {
  let world = vec3<f32>(
    in.local.x * in.inst.z + in.inst.x,
    Y_LIFT,
    in.local.y * in.inst.z + in.inst.y,
  );
  var out: VSOut;
  out.clip = cam.viewProj * vec4<f32>(world, 1.0);
  out.world = world;
  out.localR = length(in.local);
  return out;
}

const SUN_DIR  = vec3<f32>(0.42, 0.82, 0.39);
const SUN_COL  = vec3<f32>(1.00, 0.97, 0.88);
const SKY_COL  = vec3<f32>(0.65, 0.78, 0.92);
const GND_COL  = vec3<f32>(0.32, 0.30, 0.28);
const FOG_COL  = vec3<f32>(0.78, 0.85, 0.95);

fn hemiLight(albedo: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
  let L = normalize(SUN_DIR);
  let nDotL = max(dot(n, L), 0.0);
  let hemi = mix(GND_COL, SKY_COL, n.y * 0.5 + 0.5);
  return albedo * (hemi * 0.55 + SUN_COL * nDotL * 0.85);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  // Gentle radial vignette at the rim so the cap reads as a junction plate
  // rather than a hard disk against the asphalt.
  let rim = smoothstep(0.94, 1.0, in.localR);
  let noise = fract(sin(dot(in.world.xz, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  var asphalt = vec3<f32>(0.115, 0.125, 0.140) + (noise - 0.5) * 0.012;
  asphalt = mix(asphalt, vec3<f32>(0.32, 0.34, 0.36), rim * 0.55);

  var col = hemiLight(asphalt, vec3<f32>(0.0, 1.0, 0.0));

  let dist = length(in.world - cam.eye.xyz);
  let f = 1.0 - exp(-max(dist - 200.0, 0.0) * 0.0009);
  col = mix(col, FOG_COL, clamp(f, 0.0, 0.85));

  return vec4<f32>(col, 1.0);
}
`;
