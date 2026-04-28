export const vehicleShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;

struct VSIn {
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  @location(2) inst: vec4<f32>,  // x, y, z, headingY
};

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) tint: vec3<f32>,
  @location(2) world: vec3<f32>,
};

fn hash3(seed: u32) -> vec3<f32> {
  var s = seed * 747796405u + 2891336453u;
  s = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  let r = f32((s >> 16u) & 0xFFu) / 255.0;
  let g = f32((s >> 8u)  & 0xFFu) / 255.0;
  let b = f32(s          & 0xFFu) / 255.0;
  return vec3<f32>(r, g, b);
}

@vertex
fn vs(in: VSIn, @builtin(instance_index) iid: u32) -> VSOut {
  let h = in.inst.w;
  let cy = cos(h);
  let sy = sin(h);
  let lp = in.localPos;
  let world = vec3<f32>(
    lp.x * cy + lp.z * sy + in.inst.x,
    lp.y + in.inst.y,
   -lp.x * sy + lp.z * cy + in.inst.z,
  );
  let nrm = vec3<f32>(
    in.localNormal.x * cy + in.localNormal.z * sy,
    in.localNormal.y,
   -in.localNormal.x * sy + in.localNormal.z * cy,
  );
  // Bias toward saturated car colors via a per-id hash.
  let tint = mix(vec3<f32>(0.55, 0.58, 0.62), hash3(iid + 17u), 0.75);

  var out: VSOut;
  out.clip = cam.viewProj * vec4<f32>(world, 1.0);
  out.normal = nrm;
  out.tint = tint;
  out.world = world;
  return out;
}

const SUN_DIR  = vec3<f32>(0.42, 0.82, 0.39);
const SUN_COL  = vec3<f32>(1.00, 0.97, 0.88);
const SKY_COL  = vec3<f32>(0.65, 0.78, 0.92);
const GND_COL  = vec3<f32>(0.32, 0.30, 0.28);
const FOG_COL  = vec3<f32>(0.78, 0.85, 0.95);

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let L = normalize(SUN_DIR);
  let nDotL = max(dot(n, L), 0.0);
  let hemi = mix(GND_COL, SKY_COL, n.y * 0.5 + 0.5);

  // A faint specular sheen on the top so cars catch the sun.
  let view = normalize(cam.eye.xyz - in.world);
  let halfV = normalize(view + L);
  let spec = pow(max(dot(n, halfV), 0.0), 32.0) * step(0.5, n.y);

  var col = in.tint * (hemi * 0.55 + SUN_COL * nDotL * 0.95);
  col += SUN_COL * spec * 0.45;

  let dist = length(in.world - cam.eye.xyz);
  let f = 1.0 - exp(-max(dist - 200.0, 0.0) * 0.0009);
  col = mix(col, FOG_COL, clamp(f, 0.0, 0.85));

  return vec4<f32>(col, 1.0);
}
`;
