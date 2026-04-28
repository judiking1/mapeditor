// Ground pipeline + the shared camera UBO. Depth + multisample resources are
// owned by the renderer (see renderTargets.ts) so other pipelines can share
// the same MSAA configuration.

import { groundShader } from '../shaders/ground.wgsl';
import { DEPTH_FORMAT, SAMPLE_COUNT } from './renderTargets';

const QUAD_HALF = 4096;

export interface GroundPipeline {
  pipeline: GPURenderPipeline;
  vbuf: GPUBuffer;
  bindGroup: GPUBindGroup;
}

export const createGroundPipeline = (
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraUbo: GPUBuffer,
): GroundPipeline => {
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

  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    vertex: {
      module, entryPoint: 'vs',
      buffers: [{
        arrayStride: 12,
        attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
      }],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    multisample: { count: SAMPLE_COUNT },
  });

  const bindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [{ binding: 0, resource: { buffer: cameraUbo } }],
  });

  return { pipeline, vbuf, bindGroup };
};

export const createCameraUbo = (device: GPUDevice): GPUBuffer =>
  device.createBuffer({
    size: 80,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

const camStaging = new Float32Array(20);

export const writeCameraUbo = (
  device: GPUDevice,
  ubo: GPUBuffer,
  viewProj: Float32Array,
  eye: [number, number, number],
): void => {
  camStaging.set(viewProj, 0);
  camStaging[16] = eye[0]; camStaging[17] = eye[1]; camStaging[18] = eye[2]; camStaging[19] = 0;
  device.queue.writeBuffer(ubo, 0, camStaging.buffer, camStaging.byteOffset, camStaging.byteLength);
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
