// Road ribbon pipeline. Uses the same camera UBO layout as ground (mat4 + vec4 eye).
// One pipeline serves both committed roads (opaque) and preview (translucent),
// distinguished by a small Style UBO that's swapped per draw.

import type { RoadMesh } from '../../sim/road/mesh';
import { roadShader } from '../shaders/road.wgsl';

export interface RoadPipeline {
  pipeline: GPURenderPipeline;
  cameraUbo: GPUBuffer;
  committedStyleUbo: GPUBuffer;
  previewStyleUbo: GPUBuffer;
  committedBindGroup: GPUBindGroup;
  previewBindGroup: GPUBindGroup;

  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  vbufCap: number; // bytes
  ibufCap: number;
  indexCount: number;

  previewVbuf: GPUBuffer;
  previewIbuf: GPUBuffer;
  previewVCap: number;
  previewICap: number;
  previewIndexCount: number;
}

const MIN_VBUF = 64 * 1024;
const MIN_IBUF = 16 * 1024;

export const createRoadPipeline = (
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraUbo: GPUBuffer,
): RoadPipeline => {
  const module = device.createShaderModule({ code: roadShader });

  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    vertex: {
      module, entryPoint: 'vs',
      buffers: [{
        arrayStride: 16,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32' },
        ],
      }],
    },
    fragment: {
      module, entryPoint: 'fs',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const committedStyleUbo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const previewStyleUbo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(committedStyleUbo, 0, new Float32Array([1.0, 0.0, 0.0, 0.0]));
  device.queue.writeBuffer(previewStyleUbo,   0, new Float32Array([0.55, 0.45, 0.85, 1.0]));

  const committedBindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [
      { binding: 0, resource: { buffer: cameraUbo } },
      { binding: 1, resource: { buffer: committedStyleUbo } },
    ],
  });
  const previewBindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [
      { binding: 0, resource: { buffer: cameraUbo } },
      { binding: 1, resource: { buffer: previewStyleUbo } },
    ],
  });

  const vbuf = device.createBuffer({ size: MIN_VBUF, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const ibuf = device.createBuffer({ size: MIN_IBUF, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  const previewVbuf = device.createBuffer({ size: MIN_VBUF, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  const previewIbuf = device.createBuffer({ size: MIN_IBUF, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });

  return {
    pipeline,
    cameraUbo,
    committedStyleUbo,
    previewStyleUbo,
    committedBindGroup,
    previewBindGroup,
    vbuf,
    ibuf,
    vbufCap: MIN_VBUF,
    ibufCap: MIN_IBUF,
    indexCount: 0,
    previewVbuf,
    previewIbuf,
    previewVCap: MIN_VBUF,
    previewICap: MIN_IBUF,
    previewIndexCount: 0,
  };
};

const ensureBuffer = (
  device: GPUDevice,
  current: GPUBuffer,
  capBytes: number,
  needBytes: number,
  usage: GPUBufferUsageFlags,
): { buf: GPUBuffer; cap: number } => {
  if (needBytes <= capBytes) return { buf: current, cap: capBytes };
  current.destroy();
  let cap = capBytes;
  while (cap < needBytes) cap *= 2;
  return { buf: device.createBuffer({ size: cap, usage: usage | GPUBufferUsage.COPY_DST }), cap };
};

export const uploadCommitted = (device: GPUDevice, rp: RoadPipeline, mesh: RoadMesh): void => {
  rp.indexCount = mesh.indexCount;
  if (mesh.indexCount === 0) return;
  const v = ensureBuffer(device, rp.vbuf, rp.vbufCap, mesh.positions.byteLength, GPUBufferUsage.VERTEX);
  rp.vbuf = v.buf; rp.vbufCap = v.cap;
  const i = ensureBuffer(device, rp.ibuf, rp.ibufCap, mesh.indices.byteLength, GPUBufferUsage.INDEX);
  rp.ibuf = i.buf; rp.ibufCap = i.cap;
  device.queue.writeBuffer(rp.vbuf, 0, mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  device.queue.writeBuffer(rp.ibuf, 0, mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
};

export const uploadPreview = (device: GPUDevice, rp: RoadPipeline, mesh: RoadMesh | null): void => {
  if (!mesh || mesh.indexCount === 0) {
    rp.previewIndexCount = 0;
    return;
  }
  rp.previewIndexCount = mesh.indexCount;
  const v = ensureBuffer(device, rp.previewVbuf, rp.previewVCap, mesh.positions.byteLength, GPUBufferUsage.VERTEX);
  rp.previewVbuf = v.buf; rp.previewVCap = v.cap;
  const i = ensureBuffer(device, rp.previewIbuf, rp.previewICap, mesh.indices.byteLength, GPUBufferUsage.INDEX);
  rp.previewIbuf = i.buf; rp.previewICap = i.cap;
  device.queue.writeBuffer(rp.previewVbuf, 0, mesh.positions.buffer, mesh.positions.byteOffset, mesh.positions.byteLength);
  device.queue.writeBuffer(rp.previewIbuf, 0, mesh.indices.buffer, mesh.indices.byteOffset, mesh.indices.byteLength);
};

export const drawRoads = (pass: GPURenderPassEncoder, rp: RoadPipeline): void => {
  if (rp.indexCount === 0 && rp.previewIndexCount === 0) return;
  pass.setPipeline(rp.pipeline);
  if (rp.indexCount > 0) {
    pass.setBindGroup(0, rp.committedBindGroup);
    pass.setVertexBuffer(0, rp.vbuf);
    pass.setIndexBuffer(rp.ibuf, 'uint32');
    pass.drawIndexed(rp.indexCount);
  }
  if (rp.previewIndexCount > 0) {
    pass.setBindGroup(0, rp.previewBindGroup);
    pass.setVertexBuffer(0, rp.previewVbuf);
    pass.setIndexBuffer(rp.previewIbuf, 'uint32');
    pass.drawIndexed(rp.previewIndexCount);
  }
};
