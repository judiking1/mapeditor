// Instanced building pipeline. Local mesh is a unit box with X/Z spanning
// [-0.5..0.5] and Y spanning [0..1]; the shader scales by footprint width and
// per-instance height, so we never rebuild the geometry.

import { buildingShader } from '../shaders/building.wgsl';

export interface BuildingPipeline {
  pipeline: GPURenderPipeline;
  vbuf: GPUBuffer;
  ibuf: GPUBuffer;
  indexCount: number;
  instanceBuf: GPUBuffer;
  instanceCap: number;
  bindGroup: GPUBindGroup;
  count: number;
}

const buildUnitBox = (): { positions: Float32Array; indices: Uint16Array } => {
  // 6 faces × 4 verts; per vert: pos (3) + normal (3).
  const v: number[] = [];
  // Each face: 4 corners CCW with explicit normal.
  const f = (corners: [number, number, number][], nx: number, ny: number, nz: number): void => {
    for (const c of corners) v.push(c[0], c[1], c[2], nx, ny, nz);
  };
  // +Y top
  f([[0.5, 1, -0.5], [-0.5, 1, -0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5]], 0, 1, 0);
  // -Y bottom
  f([[0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 0, -0.5], [0.5, 0, -0.5]], 0, -1, 0);
  // +X right
  f([[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]], 1, 0, 0);
  // -X left
  f([[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]], -1, 0, 0);
  // +Z front
  f([[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]], 0, 0, 1);
  // -Z back
  f([[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]], 0, 0, -1);
  const positions = new Float32Array(v);
  const indices = new Uint16Array(36);
  let o = 0;
  for (let face = 0; face < 6; face++) {
    const base = face * 4;
    indices[o++] = base; indices[o++] = base + 1; indices[o++] = base + 2;
    indices[o++] = base; indices[o++] = base + 2; indices[o++] = base + 3;
  }
  return { positions, indices };
};

export const createBuildingPipeline = (
  device: GPUDevice, format: GPUTextureFormat, cameraUbo: GPUBuffer, capacity: number,
): BuildingPipeline => {
  const module = device.createShaderModule({ code: buildingShader });

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
        {
          arrayStride: 24,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
        {
          arrayStride: 16, stepMode: 'instance',
          attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const mesh = buildUnitBox();
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
    instanceBuf, instanceCap: capacity, bindGroup, count: 0,
  };
};

export const uploadBuildingInstances = (
  device: GPUDevice, bp: BuildingPipeline, data: Float32Array, count: number,
): void => {
  bp.count = Math.min(count, bp.instanceCap);
  if (bp.count === 0) return;
  device.queue.writeBuffer(bp.instanceBuf, 0, data.buffer, data.byteOffset, bp.count * 16);
};

export const drawBuildings = (pass: GPURenderPassEncoder, bp: BuildingPipeline): void => {
  if (bp.count === 0) return;
  pass.setPipeline(bp.pipeline);
  pass.setBindGroup(0, bp.bindGroup);
  pass.setVertexBuffer(0, bp.vbuf);
  pass.setVertexBuffer(1, bp.instanceBuf);
  pass.setIndexBuffer(bp.ibuf, 'uint16');
  pass.drawIndexed(bp.indexCount, bp.count);
};
