// Marshal the SoA into the render-side per-instance buffer (Float32Array of
// stride 4: x, y, z, heading). Compacts to live entries so the renderer can
// just use the first `aliveCount` instances.

import { VEHICLE_HEADER_I32, VEHICLE_RENDER_STRIDE_F32 } from '../../worker/protocol';
import type { VehicleArrays } from './soa';

export interface RenderTarget {
  header: Int32Array;   // length VEHICLE_HEADER_I32
  data: Float32Array;   // length capacity * VEHICLE_RENDER_STRIDE_F32
}

export const writeRenderSnapshot = (v: VehicleArrays, t: RenderTarget, frame: number): number => {
  const data = t.data;
  let out = 0;
  for (let i = 0; i < v.count; i++) {
    if (!v.alive[i]) continue;
    const o = out * VEHICLE_RENDER_STRIDE_F32;
    data[o] = v.posX[i]!;
    data[o + 1] = v.posY[i]!;
    data[o + 2] = v.posZ[i]!;
    data[o + 3] = v.heading[i]!;
    out++;
  }
  // Header: aliveCount, frame, capacity, reserved.
  // Atomics keeps us honest if/when we move to SAB with concurrent readers.
  if (typeof Atomics !== 'undefined') {
    Atomics.store(t.header, 0, out);
    Atomics.store(t.header, 1, frame | 0);
  } else {
    t.header[0] = out;
    t.header[1] = frame | 0;
  }
  void VEHICLE_HEADER_I32;
  return out;
};
