export const zoneOverlayShader = /* wgsl */ `
struct Camera {
  viewProj: mat4x4<f32>,
  eye: vec4<f32>,
};
struct Params {
  // x: cellSize (m), y: originX, z: originZ, w: visibility (0..1)
  config: vec4<f32>,
  // x: width, y: height (zone-cells)
  size: vec4<f32>,
};

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var<uniform> params: Params;
@group(0) @binding(2) var zoneTex: texture_2d<u32>;

struct VSIn { @location(0) pos: vec3<f32>, };
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

fn zoneColor(t: u32) -> vec3<f32> {
  if (t == 1u) { return vec3<f32>(0.40, 0.95, 0.55); }   // res
  if (t == 2u) { return vec3<f32>(0.40, 0.65, 0.95); }   // com
  if (t == 3u) { return vec3<f32>(0.95, 0.85, 0.30); }   // ind
  return vec3<f32>(0.0, 0.0, 0.0);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let cellSize = params.config.x;
  let ox = params.config.y;
  let oz = params.config.z;
  let vis = params.config.w;
  if (vis < 0.001) { discard; }

  let cx = i32(floor((in.world.x - ox) / cellSize));
  let cz = i32(floor((in.world.z - oz) / cellSize));
  let w = i32(params.size.x);
  let h = i32(params.size.y);
  if (cx < 0 || cz < 0 || cx >= w || cz >= h) { discard; }

  let t = textureLoad(zoneTex, vec2<i32>(cx, cz), 0).r;
  if (t == 0u) { discard; }

  let col = zoneColor(t);
  // Cell border tint for clarity.
  let cellPos = vec2<f32>((in.world.x - ox) / cellSize, (in.world.z - oz) / cellSize);
  let f = abs(fract(cellPos) - 0.5);
  let edge = max(f.x, f.y);
  let border = smoothstep(0.42, 0.49, edge);
  let outCol = mix(col * 0.85, col, 1.0 - border);
  return vec4<f32>(outCol, 0.32 * vis);
}
`;
