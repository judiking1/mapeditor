// Top-level renderer. Owns the shared camera UBO and orchestrates pipelines.

import type { Camera } from './camera';
import { tryCreateGpuContext, resizeContext, type GpuContext } from './webgpu/context';
import {
  createGroundPipeline,
  createCameraUbo,
  drawGround,
  ensureDepth,
  writeCameraUbo,
  type GroundPipeline,
} from './webgpu/groundPipeline';
import {
  createRoadPipeline,
  drawRoads,
  uploadCommitted,
  uploadPreview,
  type RoadPipeline,
} from './webgpu/roadPipeline';
import {
  createVehiclePipeline,
  drawVehicles,
  uploadVehicleInstances,
  type VehiclePipeline,
} from './webgpu/vehiclePipeline';
import {
  createBuildingPipeline,
  drawBuildings,
  uploadBuildingInstances,
  type BuildingPipeline,
} from './webgpu/buildingPipeline';
import {
  createZoneOverlayPipeline,
  drawZoneOverlay,
  uploadZoneTextureIfDirty,
  writeOverlayParams,
  type ZoneOverlayPipeline,
} from './webgpu/zoneOverlayPipeline';
import { buildPreviewMesh, buildRoadMesh, DEFAULT_ROAD_OPTS } from '../sim/road/mesh';
import type { RoadGraph } from '../sim/road/graph';
import type { RoadPreviewSpec } from '../tools/types';
import { packInstanceBuffer, type BuildingStore } from '../sim/buildings/store';
import type { ZoneGrid } from '../sim/zoning/grid';

export type RendererStatus =
  | { kind: 'ready'; backend: 'webgpu' }
  | { kind: 'unsupported'; reason: string };

export interface VehicleFrame {
  data: Float32Array;
  count: number;
}

export interface Renderer {
  status: RendererStatus;
  resize: (cssW: number, cssH: number, dpr: number) => void;
  draw: (cam: Camera) => void;
  setRoadState: (graph: RoadGraph | null, preview: RoadPreviewSpec | null) => void;
  setVehicleFrame: (frame: VehicleFrame | null) => void;
  initVehicles: (capacity: number) => void;
  initZoning: (grid: ZoneGrid, store: BuildingStore) => void;
  setZoneOverlayVisibility: (v: number) => void;
  syncBuildings: (store: BuildingStore) => void;
  syncZones: (grid: ZoneGrid) => void;
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
      setRoadState: () => undefined,
      setVehicleFrame: () => undefined,
      initVehicles: () => undefined,
      initZoning: () => undefined,
      setZoneOverlayVisibility: () => undefined,
      syncBuildings: () => undefined,
      syncZones: () => undefined,
      destroy: () => undefined,
    };
  }
  return makeWebGpuRenderer(gpu);
};

const makeWebGpuRenderer = (gpu: GpuContext): Renderer => {
  const cameraUbo = createCameraUbo(gpu.device);
  const ground: GroundPipeline = createGroundPipeline(gpu.device, gpu.format, cameraUbo);
  const road: RoadPipeline = createRoadPipeline(gpu.device, gpu.format, cameraUbo);
  let vehicle: VehiclePipeline | null = null;
  let building: BuildingPipeline | null = null;
  let zoneOverlay: ZoneOverlayPipeline | null = null;

  let lastGraph: RoadGraph | null = null;
  let lastGraphVersion = -1;
  let lastPreviewRef: RoadPreviewSpec | null = null;
  let lastBuildingVersion = -1;

  return {
    status: { kind: 'ready', backend: 'webgpu' },

    resize: (cssW, cssH, dpr) => resizeContext(gpu, cssW, cssH, dpr),

    setRoadState: (graph, preview) => {
      if (graph !== lastGraph || (graph && graph.version !== lastGraphVersion)) {
        lastGraph = graph;
        lastGraphVersion = graph?.version ?? -1;
        if (graph) {
          uploadCommitted(gpu.device, road, buildRoadMesh(graph));
        } else {
          uploadCommitted(gpu.device, road, { positions: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, indexCount: 0 });
        }
      }
      if (preview !== lastPreviewRef) {
        lastPreviewRef = preview;
        if (preview) {
          uploadPreview(gpu.device, road, buildPreviewMesh(preview.p0, preview.c0, preview.c1, preview.p1, DEFAULT_ROAD_OPTS));
        } else {
          uploadPreview(gpu.device, road, null);
        }
      }
    },

    initVehicles: (capacity: number) => {
      if (vehicle) return;
      vehicle = createVehiclePipeline(gpu.device, gpu.format, cameraUbo, capacity);
    },

    setVehicleFrame: (frame) => {
      if (!vehicle) return;
      if (!frame || frame.count === 0) {
        vehicle.aliveCount = 0;
        return;
      }
      uploadVehicleInstances(gpu.device, vehicle, frame.data, frame.count);
    },

    initZoning: (grid, _store) => {
      if (!building) building = createBuildingPipeline(gpu.device, gpu.format, cameraUbo, 16384);
      if (!zoneOverlay) zoneOverlay = createZoneOverlayPipeline(gpu.device, gpu.format, cameraUbo, grid);
      void _store;
    },

    setZoneOverlayVisibility: (v: number) => {
      if (!zoneOverlay) return;
      writeOverlayParams(gpu.device, zoneOverlay, v);
    },

    syncBuildings: (store) => {
      if (!building) return;
      if (store.version === lastBuildingVersion) return;
      lastBuildingVersion = store.version;
      const packed = packInstanceBuffer(store);
      uploadBuildingInstances(gpu.device, building, packed.data, packed.count);
    },

    syncZones: (grid) => {
      if (!zoneOverlay) return;
      uploadZoneTextureIfDirty(gpu.device, zoneOverlay, grid);
    },

    draw: (cam: Camera) => {
      const w = gpu.canvas.width, h = gpu.canvas.height;
      const depthView = ensureDepth(gpu.device, ground, w, h);
      writeCameraUbo(gpu.device, cameraUbo, cam.viewProj, cam.eye);

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
      drawRoads(pass, road);
      if (building) drawBuildings(pass, building);
      if (vehicle) drawVehicles(pass, vehicle);
      if (zoneOverlay) drawZoneOverlay(pass, zoneOverlay);
      pass.end();
      gpu.device.queue.submit([encoder.finish()]);
    },

    destroy: () => {
      cameraUbo.destroy();
      if (ground.depth) ground.depth.destroy();
      ground.vbuf.destroy();
      road.vbuf.destroy();
      road.ibuf.destroy();
      road.previewVbuf.destroy();
      road.previewIbuf.destroy();
      road.committedStyleUbo.destroy();
      road.previewStyleUbo.destroy();
      if (vehicle) {
        vehicle.vbuf.destroy();
        vehicle.ibuf.destroy();
        vehicle.instanceBuf.destroy();
      }
      if (building) {
        building.vbuf.destroy();
        building.ibuf.destroy();
        building.instanceBuf.destroy();
      }
      if (zoneOverlay) {
        zoneOverlay.vbuf.destroy();
        zoneOverlay.paramsUbo.destroy();
        zoneOverlay.texture.destroy();
      }
    },
  };
};
