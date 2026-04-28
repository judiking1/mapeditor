// Junction caps: a flat asphalt disk drawn at every road node so the
// perpendicular ribbon ends merge into a real-looking intersection. One
// static unit-disk mesh, instanced once per node.

import { junctionCapShader } from '../shaders/junctionCap.wgsl';
import { DEPTH_FORMAT, SAMPLE_COUNT } from './renderTargets';
import type { JunctionList } from '../../sim/road/junctions';

const RING_SEGMENTS = 24;

export interface JunctionCapPipeline {
  pipeline: GPURenderPipeline;
  vbuf: GPUBuffer;        // unit disk, vec2 per vertex
  ibuf: GPUBuffer;
  indexCount: number;
  instanceBuf: GPUBuffer;
  instanceCap: number;
  bindGroup: GPUBindGroup;
  count: number;
  uploadedVersion: number; // bumped whenever instances are re-uploaded
}

const buildUnitDisk = (segs: number): { positions: Float32Array; indices: Uint16Array } => {
  // 1 center + segs ring vertices.
  const verts = 1 + segs;
  const positions = new Float32Array(verts * 2);
  // center
  positions[0] = 0; positions[1] = 0;
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    positions[(1 + i) * 2 + 0] = Math.cos(a);
    positions[(1 + i) * 2 + 1] = Math.sin(a);
  }
  const indices = new Uint16Array(segs * 3);
  for (let i = 0; i < segs; i++) {
    const a = 1 + i;
    const b = 1 + ((i + 1) % segs);
    indices[i * 3 + 0] = 0;
    indices[i * 3 + 1] = a;
    indices[i * 3 + 2] = b;
  }
  return { positions, indices };
};

export const createJunctionCapPipeline = (
  device: GPUDevice, format: GPUTextureFormat, cameraUbo: GPUBuffer, capacity: number,
): JunctionCapPipeline => {
  const module = device.createShaderModule({ code: junctionCapShader });

  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    vertex: {
      module, entryPoint: 'vs',
      buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        {
          arrayStride: 16, stepMode: 'instance',
          attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: SAMPLE_COUNT },
  });

  const mesh = buildUnitDisk(RING_SEGMENTS);
  const vbuf = device.createBuffer({ size: mesh.positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, mesh.positions);
  const ibuf = device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, mesh.indices);

  const instanceBuf = device.createBuffer({
    size: capacity * 16,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [{ binding: 0, resource: { buffer: cameraUbo } }],
  });

  return {
    pipeline, vbuf, ibuf, indexCount: mesh.indices.length,
    instanceBuf, instanceCap: capacity, bindGroup, count: 0, uploadedVersion: -1,
  };
};

export const ensureJunctionCapacity = (
  device: GPUDevice, jp: JunctionCapPipeline, needed: number,
): void => {
  if (needed <= jp.instanceCap) return;
  jp.instanceBuf.destroy();
  let cap = jp.instanceCap;
  while (cap < needed) cap *= 2;
  jp.instanceBuf = device.createBuffer({
    size: cap * 16,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  jp.instanceCap = cap;
};

export const uploadJunctions = (
  device: GPUDevice, jp: JunctionCapPipeline, list: JunctionList,
): void => {
  ensureJunctionCapacity(device, jp, list.count);
  jp.count = list.count;
  if (list.count === 0) return;
  device.queue.writeBuffer(jp.instanceBuf, 0, list.data.buffer, list.data.byteOffset, list.count * 16);
};

export const drawJunctions = (pass: GPURenderPassEncoder, jp: JunctionCapPipeline): void => {
  if (jp.count === 0) return;
  pass.setPipeline(jp.pipeline);
  pass.setBindGroup(0, jp.bindGroup);
  pass.setVertexBuffer(0, jp.vbuf);
  pass.setVertexBuffer(1, jp.instanceBuf);
  pass.setIndexBuffer(jp.ibuf, 'uint16');
  pass.drawIndexed(jp.indexCount, jp.count);
};
