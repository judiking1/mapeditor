// Instanced car pipeline. One static mesh (a small box), one dynamic instance
// buffer of [x,y,z,heading] per vehicle. Up to `capacity` instances; we draw
// only `aliveCount` per frame.

import { vehicleShader } from '../shaders/vehicle.wgsl';

const CAR_LEN = 4.4;   // along +Z
const CAR_WID = 1.85;  // along +X
const CAR_HGT = 1.45;  // along +Y, base at y=0

export interface VehiclePipeline {
  pipeline: GPURenderPipeline;
  vbuf: GPUBuffer;        // box mesh, position + normal interleaved
  ibuf: GPUBuffer;
  indexCount: number;
  instanceBuf: GPUBuffer;  // capacity * 16 bytes
  capacity: number;
  bindGroup: GPUBindGroup;
  aliveCount: number;
}

const buildBoxMesh = (): { positions: Float32Array; indices: Uint16Array } => {
  // 6 faces × 4 verts = 24 verts; per-vertex: pos (3) + normal (3).
  const hl = CAR_LEN / 2, hw = CAR_WID / 2, hh = CAR_HGT / 2;
  const v: number[] = [];
  const n: [number, number, number][] = [
    [0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  ];
  // For each face: 4 corner positions, in CCW order.
  const faces: [number, number, number][][] = [
    [[ hw,  hh, -hl], [-hw,  hh, -hl], [-hw,  hh,  hl], [ hw,  hh,  hl]], // +Y
    [[ hw, -hh,  hl], [-hw, -hh,  hl], [-hw, -hh, -hl], [ hw, -hh, -hl]], // -Y
    [[ hw, -hh,  hl], [ hw, -hh, -hl], [ hw,  hh, -hl], [ hw,  hh,  hl]], // +X
    [[-hw, -hh, -hl], [-hw, -hh,  hl], [-hw,  hh,  hl], [-hw,  hh, -hl]], // -X
    [[-hw, -hh,  hl], [ hw, -hh,  hl], [ hw,  hh,  hl], [-hw,  hh,  hl]], // +Z
    [[ hw, -hh, -hl], [-hw, -hh, -hl], [-hw,  hh, -hl], [ hw,  hh, -hl]], // -Z
  ];
  for (let f = 0; f < 6; f++) {
    const face = faces[f]!;
    const nm = n[f]!;
    for (let k = 0; k < 4; k++) {
      const c = face[k]!;
      v.push(c[0], c[1] + hh, c[2], nm[0], nm[1], nm[2]); // shift so base sits at y=0
    }
  }
  const positions = new Float32Array(v);
  const indices = new Uint16Array(36);
  let idx = 0;
  for (let f = 0; f < 6; f++) {
    const base = f * 4;
    indices[idx++] = base;     indices[idx++] = base + 1; indices[idx++] = base + 2;
    indices[idx++] = base;     indices[idx++] = base + 2; indices[idx++] = base + 3;
  }
  return { positions, indices };
};

export const createVehiclePipeline = (
  device: GPUDevice,
  format: GPUTextureFormat,
  cameraUbo: GPUBuffer,
  capacity: number,
): VehiclePipeline => {
  const module = device.createShaderModule({ code: vehicleShader });

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
          arrayStride: 16,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 2, offset: 0, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'back' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });

  const mesh = buildBoxMesh();
  const vbuf = device.createBuffer({ size: mesh.positions.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, mesh.positions);
  const ibuf = device.createBuffer({ size: mesh.indices.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, mesh.indices);

  const instanceBytes = capacity * 16;
  const instanceBuf = device.createBuffer({
    size: instanceBytes,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const bindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [{ binding: 0, resource: { buffer: cameraUbo } }],
  });

  return {
    pipeline, vbuf, ibuf, indexCount: mesh.indices.length,
    instanceBuf, capacity, bindGroup, aliveCount: 0,
  };
};

export const uploadVehicleInstances = (
  device: GPUDevice, vp: VehiclePipeline, instanceData: Float32Array, count: number,
): void => {
  vp.aliveCount = Math.min(count, vp.capacity);
  if (vp.aliveCount === 0) return;
  const bytes = vp.aliveCount * 16;
  device.queue.writeBuffer(vp.instanceBuf, 0, instanceData.buffer, instanceData.byteOffset, bytes);
};

export const drawVehicles = (pass: GPURenderPassEncoder, vp: VehiclePipeline): void => {
  if (vp.aliveCount === 0) return;
  pass.setPipeline(vp.pipeline);
  pass.setBindGroup(0, vp.bindGroup);
  pass.setVertexBuffer(0, vp.vbuf);
  pass.setVertexBuffer(1, vp.instanceBuf);
  pass.setIndexBuffer(vp.ibuf, 'uint16');
  pass.drawIndexed(vp.indexCount, vp.aliveCount);
};
