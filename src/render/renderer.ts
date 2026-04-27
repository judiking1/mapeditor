// Top-level renderer. M0 only wires WebGPU + a ground/grid pipeline.
// WebGL2 fallback is reserved for a later milestone — for now we surface a
// clear status to the user instead of pretending to render.

import type { Camera } from './camera';
import { tryCreateGpuContext, resizeContext, type GpuContext } from './webgpu/context';
import {
  createGroundPipeline,
  drawGround,
  ensureDepth,
  updateGroundCamera,
  type GroundPipeline,
} from './webgpu/groundPipeline';

export type RendererStatus =
  | { kind: 'ready'; backend: 'webgpu' }
  | { kind: 'unsupported'; reason: string };

export interface Renderer {
  status: RendererStatus;
  resize: (cssW: number, cssH: number, dpr: number) => void;
  draw: (cam: Camera) => void;
  destroy: () => void;
}

export const createRenderer = async (canvas: HTMLCanvasElement): Promise<Renderer> => {
  const gpu = await tryCreateGpuContext(canvas);
  if (!gpu) {
    return {
      status: {
        kind: 'unsupported',
        reason: 'WebGPU 사용 불가 — 최신 Chrome/Edge/Arc 또는 Safari Tech Preview에서 열어주세요.',
      },
      resize: () => undefined,
      draw: () => undefined,
      destroy: () => undefined,
    };
  }
  return makeWebGpuRenderer(gpu);
};

const makeWebGpuRenderer = (gpu: GpuContext): Renderer => {
  const ground: GroundPipeline = createGroundPipeline(gpu.device, gpu.format);

  return {
    status: { kind: 'ready', backend: 'webgpu' },
    resize: (cssW, cssH, dpr) => resizeContext(gpu, cssW, cssH, dpr),
    draw: (cam: Camera) => {
      const w = gpu.canvas.width, h = gpu.canvas.height;
      const depthView = ensureDepth(gpu.device, ground, w, h);
      updateGroundCamera(gpu.device, ground, cam.viewProj, cam.eye);

      const encoder = gpu.device.createCommandEncoder();
      const view = gpu.context.getCurrentTexture().createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view,
          clearValue: { r: 0.04, g: 0.05, b: 0.07, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        }],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      drawGround(pass, ground);
      pass.end();
      gpu.device.queue.submit([encoder.finish()]);
    },
    destroy: () => {
      if (ground.depth) ground.depth.destroy();
      ground.vbuf.destroy();
      ground.cameraUbo.destroy();
    },
  };
};
