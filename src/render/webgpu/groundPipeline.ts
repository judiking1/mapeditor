// One large flat quad, world-space coordinates baked in. Shaded by ground.wgsl
// to draw an anti-aliased grid that fades with distance.

import { groundShader } from '../shaders/ground.wgsl';

const QUAD_HALF = 4096;

export interface GroundPipeline {
  pipeline: GPURenderPipeline;
  vbuf: GPUBuffer;
  cameraUbo: GPUBuffer;
  bindGroup: GPUBindGroup;
  depth: GPUTexture | null;
  depthView: GPUTextureView | null;
  depthW: number;
  depthH: number;
  format: GPUTextureFormat;
}

export const createGroundPipeline = (device: GPUDevice, format: GPUTextureFormat): GroundPipeline => {
  const module = device.createShaderModule({ code: groundShader });

  const vertices = new Float32Array([
    -QUAD_HALF, 0, -QUAD_HALF,
     QUAD_HALF, 0, -QUAD_HALF,
     QUAD_HALF, 0,  QUAD_HALF,
    -QUAD_HALF, 0, -QUAD_HALF,
     QUAD_HALF, 0,  QUAD_HALF,
    -QUAD_HALF, 0,  QUAD_HALF,
  ]);

  const vbuf = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vbuf, 0, vertices);

  // Uniform: mat4x4 viewProj (64) + vec4 eye (16) = 80 bytes
  const cameraUbo = device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindLayout] });

  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: 12,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        },
      ],
    },
    fragment: {
      module,
      entryPoint: 'fs',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const bindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [{ binding: 0, resource: { buffer: cameraUbo } }],
  });

  return { pipeline, vbuf, cameraUbo, bindGroup, depth: null, depthView: null, depthW: 0, depthH: 0, format };
};

export const ensureDepth = (device: GPUDevice, gp: GroundPipeline, w: number, h: number): GPUTextureView => {
  if (gp.depth && gp.depthW === w && gp.depthH === h && gp.depthView) return gp.depthView;
  if (gp.depth) gp.depth.destroy();
  gp.depth = device.createTexture({
    size: { width: w, height: h },
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  gp.depthView = gp.depth.createView();
  gp.depthW = w; gp.depthH = h;
  return gp.depthView;
};

const camStaging = new Float32Array(20); // 16 (mat) + 4 (eye+pad)

export const updateGroundCamera = (
  device: GPUDevice,
  gp: GroundPipeline,
  viewProj: Float32Array,
  eye: [number, number, number],
): void => {
  camStaging.set(viewProj, 0);
  camStaging[16] = eye[0]; camStaging[17] = eye[1]; camStaging[18] = eye[2]; camStaging[19] = 0;
  device.queue.writeBuffer(gp.cameraUbo, 0, camStaging.buffer, camStaging.byteOffset, camStaging.byteLength);
};

export const drawGround = (
  pass: GPURenderPassEncoder,
  gp: GroundPipeline,
): void => {
  pass.setPipeline(gp.pipeline);
  pass.setBindGroup(0, gp.bindGroup);
  pass.setVertexBuffer(0, gp.vbuf);
  pass.draw(6, 1, 0, 0);
};
