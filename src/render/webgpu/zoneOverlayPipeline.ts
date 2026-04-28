// Translucent zone overlay. Re-uses a large flat quad and samples a u8
// zone texture in the fragment shader. Visibility is uniform-controlled so
// we don't add/remove the pass — just turn alpha to zero when inactive.

import { zoneOverlayShader } from '../shaders/zoneOverlay.wgsl';
import type { ZoneGrid } from '../../sim/zoning/grid';
import { DEPTH_FORMAT, SAMPLE_COUNT } from './renderTargets';

const QUAD_HALF = 4096;

export interface ZoneOverlayPipeline {
  pipeline: GPURenderPipeline;
  vbuf: GPUBuffer;
  paramsUbo: GPUBuffer;
  texture: GPUTexture;
  view: GPUTextureView;
  bindGroup: GPUBindGroup;
  visibility: number;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  // Bumped when the texture is current; compared against grid.version on
  // upload to avoid redundant copies.
  uploadedVersion: number;
}

export const createZoneOverlayPipeline = (
  device: GPUDevice, format: GPUTextureFormat, cameraUbo: GPUBuffer, grid: ZoneGrid,
): ZoneOverlayPipeline => {
  const module = device.createShaderModule({ code: zoneOverlayShader });

  const vertices = new Float32Array([
    -QUAD_HALF, 0, -QUAD_HALF,
     QUAD_HALF, 0, -QUAD_HALF,
     QUAD_HALF, 0,  QUAD_HALF,
    -QUAD_HALF, 0, -QUAD_HALF,
     QUAD_HALF, 0,  QUAD_HALF,
    -QUAD_HALF, 0,  QUAD_HALF,
  ]);

  const vbuf = device.createBuffer({ size: vertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, vertices);

  const texture = device.createTexture({
    size: { width: grid.width, height: grid.height },
    format: 'r8uint',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const view = texture.createView();

  const paramsUbo = device.createBuffer({
    size: 32, // vec4 config + vec4 size
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const bindLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
    ],
  });

  const pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    vertex: {
      module, entryPoint: 'vs',
      buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }],
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
    // No depth write so the overlay sits on top of the ground without
    // occluding roads/buildings.
    depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less-equal' },
    multisample: { count: SAMPLE_COUNT },
  });

  const bindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [
      { binding: 0, resource: { buffer: cameraUbo } },
      { binding: 1, resource: { buffer: paramsUbo } },
      { binding: 2, resource: view },
    ],
  });

  return {
    pipeline, vbuf, paramsUbo, texture, view, bindGroup,
    visibility: 0,
    width: grid.width, height: grid.height, cellSize: grid.cellSize,
    originX: grid.originX, originZ: grid.originZ,
    uploadedVersion: -1,
  };
};

const paramsStaging = new Float32Array(8);

export const writeOverlayParams = (
  device: GPUDevice, op: ZoneOverlayPipeline, visibility: number,
): void => {
  op.visibility = visibility;
  paramsStaging[0] = op.cellSize;
  paramsStaging[1] = op.originX;
  paramsStaging[2] = op.originZ;
  paramsStaging[3] = visibility;
  paramsStaging[4] = op.width;
  paramsStaging[5] = op.height;
  paramsStaging[6] = 0;
  paramsStaging[7] = 0;
  device.queue.writeBuffer(op.paramsUbo, 0, paramsStaging.buffer, paramsStaging.byteOffset, paramsStaging.byteLength);
};

export const uploadZoneTextureIfDirty = (
  device: GPUDevice, op: ZoneOverlayPipeline, grid: ZoneGrid,
): void => {
  if (grid.version === op.uploadedVersion) return;
  device.queue.writeTexture(
    { texture: op.texture },
    grid.cells.buffer,
    { offset: grid.cells.byteOffset, bytesPerRow: grid.width, rowsPerImage: grid.height },
    { width: grid.width, height: grid.height, depthOrArrayLayers: 1 },
  );
  op.uploadedVersion = grid.version;
};

export const drawZoneOverlay = (pass: GPURenderPassEncoder, op: ZoneOverlayPipeline): void => {
  if (op.visibility < 0.001) return;
  pass.setPipeline(op.pipeline);
  pass.setBindGroup(0, op.bindGroup);
  pass.setVertexBuffer(0, op.vbuf);
  pass.draw(6);
};
