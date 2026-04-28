export const groundShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};
@group(0) @binding(0) var<uniform> cam: Camera;

struct VSIn {
  @location(0) pos: vec3<f32>,
};
struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) world: vec3<f32>,
};

@vertex
fn vs(in: VSIn) -> VSOut {
  var out: VSOut;
  out.clip = cam.viewProj * vec4<f32>(in.pos, 1.0);
  out.world = in.pos;
  return out;
}

fn gridStrength(coord: vec2<f32>, scale: f32, lineWidth: f32) -> f32 {
  let c = coord / scale;
  let d = fwidth(c);
  let g = abs(fract(c - 0.5) - 0.5) / max(d, vec2<f32>(1e-4));
  let l = min(g.x, g.y);
  return 1.0 - smoothstep(0.0, lineWidth, l);
}

const FOG_COL = vec3<f32>(0.78, 0.85, 0.95);

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let xz = in.world.xz;
  let minor = gridStrength(xz, 8.0, 1.0);
  let major = gridStrength(xz, 64.0, 1.0);

  // Soft grass-like ground with two-tone hemisphere shading. The grid lines
  // sit on top with distance fade so the horizon stays clean.
  let dist = length(in.world - cam.eye.xyz);
  let fade = 1.0 - smoothstep(450.0, 1400.0, dist);

  let bg = mix(vec3<f32>(0.36, 0.45, 0.30), vec3<f32>(0.42, 0.52, 0.36), 0.5 + 0.5 * sin(xz.x * 0.013) * cos(xz.y * 0.011));
  var col = bg;
  col = mix(col, vec3<f32>(0.60, 0.68, 0.50), minor * 0.45 * fade);
  col = mix(col, vec3<f32>(0.85, 0.90, 0.78), major * 0.65 * fade);

  // North/east axis hairlines so the world has a recognisable origin.
  let axisX = 1.0 - smoothstep(0.0, fwidth(xz.y) * 1.5, abs(xz.y));
  let axisZ = 1.0 - smoothstep(0.0, fwidth(xz.x) * 1.5, abs(xz.x));
  col = mix(col, vec3<f32>(0.85, 0.40, 0.40), axisX * fade * 0.85);
  col = mix(col, vec3<f32>(0.40, 0.85, 0.55), axisZ * fade * 0.85);

  // Distance fog blends to sky color.
  let f = 1.0 - exp(-max(dist - 200.0, 0.0) * 0.0009);
  col = mix(col, FOG_COL, clamp(f, 0.0, 0.9));

  return vec4<f32>(col, 1.0);
}
`;
