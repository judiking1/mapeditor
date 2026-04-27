export const roadShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};

struct Style {
  // x: alpha, y: tint r, z: tint g, w: tint b
  params: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> style: Style;

struct VSIn {
  @location(0) pos: vec3<f32>,
  @location(1) edge: f32,   // -1 = left curb, +1 = right curb, 0 = center (interpolated)
};

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) edge: f32,
};

@vertex
fn vs(in: VSIn) -> VSOut {
  var out: VSOut;
  out.clip = cam.viewProj * vec4<f32>(in.pos, 1.0);
  out.edge = in.edge;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let asphalt = vec3<f32>(0.13, 0.14, 0.16);
  let curb    = vec3<f32>(0.55, 0.57, 0.62);
  let stripe  = vec3<f32>(0.95, 0.92, 0.55);

  let absE = abs(in.edge);
  // Curb band near the edge
  let curbBand = smoothstep(0.86, 0.98, absE);
  // Centerline stripe (a thin yellow line at edge ≈ 0)
  let stripeBand = 1.0 - smoothstep(0.0, 0.04, absE);

  var col = mix(asphalt, curb, curbBand);
  col = mix(col, stripe, stripeBand * 0.85);

  // Tint weighted by 1-alpha so opaque committed roads stay neutral while the
  // translucent preview picks up the configured color.
  let tintW = 1.0 - style.params.x;
  col = mix(col, style.params.yzw, tintW * 0.5);

  return vec4<f32>(col, style.params.x);
}
`;
