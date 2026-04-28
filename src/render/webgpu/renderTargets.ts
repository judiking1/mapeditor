// Shared render targets owned by the renderer. Multisample color (4x) +
// matching multisample depth, both resized in lockstep with the swap-chain.
// All pipelines share `SAMPLE_COUNT` so they're ABI-compatible.

export const SAMPLE_COUNT = 4;
export const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export interface RenderTargets {
  msColor: GPUTexture | null;
  msColorView: GPUTextureView | null;
  depth: GPUTexture | null;
  depthView: GPUTextureView | null;
  width: number;
  height: number;
  format: GPUTextureFormat;
}

export const createRenderTargets = (format: GPUTextureFormat): RenderTargets => ({
  msColor: null, msColorView: null, depth: null, depthView: null,
  width: 0, height: 0, format,
});

export const ensureRenderTargets = (
  device: GPUDevice, rt: RenderTargets, w: number, h: number,
): void => {
  if (w === rt.width && h === rt.height && rt.msColor && rt.depth) return;
  if (rt.msColor) rt.msColor.destroy();
  if (rt.depth) rt.depth.destroy();
  rt.msColor = device.createTexture({
    size: { width: w, height: h },
    sampleCount: SAMPLE_COUNT,
    format: rt.format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  rt.msColorView = rt.msColor.createView();
  rt.depth = device.createTexture({
    size: { width: w, height: h },
    sampleCount: SAMPLE_COUNT,
    format: DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  rt.depthView = rt.depth.createView();
  rt.width = w; rt.height = h;
};
