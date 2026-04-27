// WebGPU device + canvas context bring-up. Returns null if the platform doesn't
// expose `navigator.gpu` or the adapter request fails — caller decides whether
// to surface a fallback or an error.

export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  canvas: HTMLCanvasElement;
}

export const tryCreateGpuContext = async (canvas: HTMLCanvasElement): Promise<GpuContext | null> => {
  if (!('gpu' in navigator) || !navigator.gpu) return null;
  let adapter: GPUAdapter | null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!adapter) return null;

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch {
    return null;
  }

  const context = canvas.getContext('webgpu');
  if (!context) return null;

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  return { device, context, format, canvas };
};

export const resizeContext = (gpu: GpuContext, cssWidth: number, cssHeight: number, dpr: number): void => {
  const w = Math.max(1, Math.floor(cssWidth * dpr));
  const h = Math.max(1, Math.floor(cssHeight * dpr));
  if (gpu.canvas.width !== w || gpu.canvas.height !== h) {
    gpu.canvas.width = w;
    gpu.canvas.height = h;
  }
};
