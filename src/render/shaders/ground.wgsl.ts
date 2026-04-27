// WGSL inlined as a string literal so Vite can tree-shake and so we don't need
// .wgsl loader plugins. The ground pipeline draws an enormous flat quad and
// derives a Cities-Skylines-style anti-aliased grid in the fragment shader.

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

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let xz = in.world.xz;
  let minor = gridStrength(xz, 8.0, 1.0);
  let major = gridStrength(xz, 64.0, 1.0);

  let dist = length(in.world - cam.eye.xyz);
  let fade = 1.0 - smoothstep(450.0, 1400.0, dist);

  let bg = vec3<f32>(0.085, 0.105, 0.135);
  var col = bg;
  col = mix(col, vec3<f32>(0.16, 0.22, 0.30), minor * 0.55 * fade);
  col = mix(col, vec3<f32>(0.34, 0.50, 0.70), major * 0.85 * fade);

  // Center cross — north/east axes — to orient the player.
  let axisX = 1.0 - smoothstep(0.0, fwidth(xz.y) * 1.5, abs(xz.y));
  let axisZ = 1.0 - smoothstep(0.0, fwidth(xz.x) * 1.5, abs(xz.x));
  col = mix(col, vec3<f32>(0.85, 0.40, 0.40), axisX * fade);
  col = mix(col, vec3<f32>(0.40, 0.85, 0.55), axisZ * fade);

  return vec4<f32>(col, 1.0);
}
`;
