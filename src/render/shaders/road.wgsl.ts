export const roadShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};

struct Style {
  // x: alpha, y..w: tint rgb (used to bias preview color)
  params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> style: Style;

struct VSIn {
  @location(0) pos: vec3<f32>,
  @location(1) edge: f32,    // -1 left, +1 right; interpolated across ribbon
  @location(2) along: f32,   // arc length from segment start (m)
};

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) edge: f32,
  @location(1) along: f32,
  @location(2) world: vec3<f32>,
};

@vertex
fn vs(in: VSIn) -> VSOut {
  var out: VSOut;
  out.clip = cam.viewProj * vec4<f32>(in.pos, 1.0);
  out.edge = in.edge;
  out.along = in.along;
  out.world = in.pos;
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

fn applyFog(col: vec3<f32>, world: vec3<f32>, eye: vec3<f32>) -> vec3<f32> {
  let d = length(world - eye);
  let f = 1.0 - exp(-max(d - 200.0, 0.0) * 0.0009);
  return mix(col, FOG_COL, clamp(f, 0.0, 0.85));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let absE = abs(in.edge);

  // Asphalt with subtle micro-detail derived from world XZ — keeps flat
  // tarmac from looking plastic.
  let noise = fract(sin(dot(in.world.xz, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  var asphalt = vec3<f32>(0.115, 0.125, 0.140) + (noise - 0.5) * 0.012;

  // Solid white edge stripe (lane markings on the outside).
  let edgeStripe = smoothstep(0.86, 0.94, absE) * (1.0 - smoothstep(0.96, 1.0, absE));
  let white = vec3<f32>(0.92, 0.92, 0.88);
  asphalt = mix(asphalt, white, edgeStripe);

  // Dashed center-line: visible only when |edge| < 0.04, dashed by along.
  // 4m on, 4m off — derived from arc length so curves look natural.
  let centerBand = 1.0 - smoothstep(0.0, 0.05, absE);
  let dashCycle = step(fract(in.along / 8.0), 0.5);
  let yellow = vec3<f32>(0.96, 0.82, 0.30);
  asphalt = mix(asphalt, yellow, centerBand * dashCycle * 0.95);

  // Subtle curb tint along the very edges (outside the painted stripe).
  let curb = smoothstep(0.95, 1.0, absE);
  asphalt = mix(asphalt, vec3<f32>(0.32, 0.34, 0.36), curb * 0.55);

  // Apply lighting (road normal points up).
  var col = hemiLight(asphalt, vec3<f32>(0.0, 1.0, 0.0));

  // Preview tint: blend the configured color with the road appearance,
  // weighted by inverse alpha so committed roads keep the real look.
  let tintW = 1.0 - style.params.x;
  col = mix(col, style.params.yzw, tintW * 0.55);

  col = applyFog(col, in.world, cam.eye.xyz);
  return vec4<f32>(col, style.params.x);
}
`;
