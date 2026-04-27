export const vehicleShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;

struct VSIn {
  @location(0) localPos: vec3<f32>,
  @location(1) localNormal: vec3<f32>,
  // Per-instance: x, y, z, headingY (radians)
  @location(2) inst: vec4<f32>,
};

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) tint: vec3<f32>,
  @location(2) worldPos: vec3<f32>,
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
  // Rotate local position around +Y by heading. Body forward axis is +Z.
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

  // Per-instance tint, biased toward common car colors via mixing with grey.
  let tint = mix(vec3<f32>(0.6, 0.62, 0.66), hash3(iid + 17u), 0.65);

  var out: VSOut;
  out.clip = cam.viewProj * vec4<f32>(world, 1.0);
  out.normal = nrm;
  out.tint = tint;
  out.worldPos = world;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(in.normal);
  let l = normalize(vec3<f32>(0.4, 0.9, 0.2));
  let lambert = max(dot(n, l), 0.0);
  // Soft sky/ground ambient for a clean toy-city look.
  let amb = mix(vec3<f32>(0.18, 0.20, 0.24), vec3<f32>(0.95, 0.95, 0.92), n.y * 0.5 + 0.5) * 0.45;
  let col = in.tint * (amb + lambert * 0.85);
  return vec4<f32>(col, 1.0);
}
`;
