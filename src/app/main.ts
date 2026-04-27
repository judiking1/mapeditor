// Entry point. Brings up the renderer, the simulation worker, and the UI shell.

import { createCamera, updateCamera } from '../render/camera';
import { attachCameraControls } from '../render/cameraControl';
import { createRenderer } from '../render/renderer';
import { createRoadGraph } from '../sim/road/graph';
import { buildGraphSnapshot, snapshotTransferList } from '../sim/graphSnapshot';
import {
  autoSave,
  decodeBytes,
  encodeBundle,
  loadFromSlot,
  pickFile,
  replaceBuildingsInPlace,
  replaceGraphInPlace,
  replaceZoneInPlace,
  saveToSlot,
  tryLoadAutosave,
  type WorldMeta,
} from '../io/save';
import { openSaveDialog } from '../ui/saveDialog';
import { attachToolHost } from '../tools/toolHost';
import { createCurvedRoadTool, createEraseTool, createStraightRoadTool } from '../tools/roadTool';
import { createZoneTool } from '../tools/zoneTool';
import type { Tool } from '../tools/types';
import { buildToolbar } from '../ui/toolbar';
import { hud } from './hud';
import {
  VEHICLE_HEADER_BYTES,
  VEHICLE_HEADER_I32,
  VEHICLE_RENDER_STRIDE_F32,
  type MainToSim,
  type SimToMain,
} from '../worker/protocol';
import {
  createZoneGrid,
  ZONE_COM,
  ZONE_IND,
  ZONE_RES,
} from '../sim/zoning/grid';
import { createBuildingStore } from '../sim/buildings/store';
import { reconcileZoneRemovals, tickBuildingPlacement } from '../sim/buildings/place';

const VEHICLE_CAPACITY = 4096;
const BUILDING_CAPACITY = 16384;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const tools = document.getElementById('tools') as HTMLElement;

const toolbar = buildToolbar(tools);

const cam = createCamera();
updateCamera(cam);

const fitCanvas = (): void => {
  const r = canvas.getBoundingClientRect();
  cam.aspect = Math.max(1e-3, r.width / Math.max(1, r.height));
  updateCamera(cam);
};
window.addEventListener('resize', fitCanvas);
fitCanvas();

attachCameraControls(canvas, cam);

const worldMeta: WorldMeta = {
  seed: 1,
  worldWidthCells: 1024,
  worldHeightCells: 1024,
  cellSize: 8,
};

const roadGraph = createRoadGraph();
const zoneGrid = createZoneGrid();
const buildings = createBuildingStore(BUILDING_CAPACITY, zoneGrid.cells.length);
const toolHost = attachToolHost({ canvas, camera: cam, groundY: 0 });

const toolRegistry: Record<string, Tool | null> = {
  select: null,
  pan: null,
  'road-straight': createStraightRoadTool(roadGraph),
  'road-curved': createCurvedRoadTool(roadGraph),
  'road-erase': createEraseTool(roadGraph),
  'zone-res': createZoneTool(zoneGrid, ZONE_RES),
  'zone-com': createZoneTool(zoneGrid, ZONE_COM),
  'zone-ind': createZoneTool(zoneGrid, ZONE_IND),
};

const main = async (): Promise<void> => {
  const renderer = await createRenderer(canvas);
  if (renderer.status.kind === 'unsupported') {
    hud.setRenderer('unsupported', 'err');
    hud.setHint(renderer.status.reason);
  } else {
    hud.setRenderer(renderer.status.backend, 'ok');
    hud.setHint('우클릭=회전, 휠=줌, WASD=이동. 좌측에서 도구를 골라 도로/존을 그려보세요.');
  }
  renderer.initVehicles(VEHICLE_CAPACITY);
  renderer.initZoning(zoneGrid, buildings);
  renderer.setZoneOverlayVisibility(0);

  // Try restoring the last autosave so reloads don't lose work.
  try {
    const restored = await tryLoadAutosave();
    if (restored) {
      replaceGraphInPlace(roadGraph, restored.graph);
      replaceZoneInPlace(zoneGrid, restored.zone);
      replaceBuildingsInPlace(buildings, restored.buildings);
      if (roadGraph.nodeCount > 0 || roadGraph.segCount > 0 || buildings.count > 0) {
        hud.setHint('자동저장 복원됨');
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('autosave restore failed', e);
  }

  let lastSavedRoadVersion = roadGraph.version;
  let lastSavedZoneVersion = zoneGrid.version;
  let lastSavedBldgVersion = buildings.version;
  setInterval(() => {
    if (roadGraph.version === lastSavedRoadVersion
      && zoneGrid.version === lastSavedZoneVersion
      && buildings.version === lastSavedBldgVersion) return;
    lastSavedRoadVersion = roadGraph.version;
    lastSavedZoneVersion = zoneGrid.version;
    lastSavedBldgVersion = buildings.version;
    autoSave(roadGraph, zoneGrid, buildings, worldMeta).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('autosave failed', e);
    });
  }, 8000);

  // --- Simulation worker bring-up ----------------------------------------
  const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  const post = (m: MainToSim, transfer: Transferable[] = []): void => worker.postMessage(m, transfer);

  post({
    type: 'init',
    seed: worldMeta.seed,
    worldWidthCells: worldMeta.worldWidthCells,
    worldHeightCells: worldMeta.worldHeightCells,
    cellSizeMeters: worldMeta.cellSize,
    vehicleCapacity: VEHICLE_CAPACITY,
  });

  let vehicleHeader: Int32Array | null = null;
  let vehicleData: Float32Array | null = null;
  let fallbackData: Float32Array | null = null;
  let fallbackCount = 0;

  worker.onmessage = (ev: MessageEvent<SimToMain>): void => {
    const msg = ev.data;
    switch (msg.type) {
      case 'ready':
        hud.setWorker(msg.capabilities.sab ? 'ready (sab)' : 'ready (xfer)', 'ok');
        if (msg.vehicleSab) {
          vehicleHeader = new Int32Array(msg.vehicleSab, 0, VEHICLE_HEADER_I32);
          vehicleData = new Float32Array(msg.vehicleSab, VEHICLE_HEADER_BYTES, msg.vehicleCapacity * VEHICLE_RENDER_STRIDE_F32);
        }
        sendGraphSnapshot();
        break;
      case 'tick':
        hud.setTick(msg.simTick);
        break;
      case 'vehiclesFallback': {
        fallbackData = new Float32Array(msg.buffer, VEHICLE_HEADER_BYTES, VEHICLE_CAPACITY * VEHICLE_RENDER_STRIDE_F32);
        fallbackCount = msg.aliveCount;
        break;
      }
      case 'log':
        // eslint-disable-next-line no-console
        console[msg.level === 'error' ? 'error' : msg.level === 'warn' ? 'warn' : 'log'](msg.msg);
        break;
    }
  };
  worker.onerror = (e) => {
    hud.setWorker('error', 'err');
    // eslint-disable-next-line no-console
    console.error('sim worker error', e);
  };

  const sendGraphSnapshot = (): void => {
    const snap = buildGraphSnapshot(roadGraph);
    post(
      {
        type: 'graphSnapshot',
        snapshot: {
          version: snap.version,
          nodeCount: snap.nodeCount,
          segCount: snap.segCount,
          nodePos: snap.nodePos.buffer,
          segNodes: snap.segNodes.buffer,
          segCtrl: snap.segCtrl.buffer,
          segLen: snap.segLen.buffer,
          segType: snap.segType.buffer,
        },
      },
      snapshotTransferList(snap),
    );
  };

  let lastSentVersion = -1;

  // --- Save / Load dialog plumbing ---------------------------------------
  const openDialog = (): void => {
    openSaveDialog({
      defaultName: `city-${new Date().toISOString().slice(0, 16).replace(':', '')}`,
      onSave: async (name) => {
        await saveToSlot(roadGraph, zoneGrid, buildings, worldMeta, name);
        hud.setHint(`"${name}" 저장 완료`);
      },
      onLoad: async (id) => {
        const { meta, bundle } = await loadFromSlot(id);
        replaceGraphInPlace(roadGraph, bundle.graph);
        replaceZoneInPlace(zoneGrid, bundle.zone);
        replaceBuildingsInPlace(buildings, bundle.buildings);
        hud.setHint(`"${meta.name}" 불러옴`);
      },
      onExport: async () => {
        const name = `city-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
        const bytes = encodeBundle(roadGraph, zoneGrid, buildings, worldMeta, name);
        return { bytes, suggestedName: name };
      },
      onImport: async () => {
        const file = await pickFile();
        if (!file) return;
        const buf = await file.arrayBuffer();
        const bundle = decodeBytes(new Uint8Array(buf));
        replaceGraphInPlace(roadGraph, bundle.graph);
        replaceZoneInPlace(zoneGrid, bundle.zone);
        replaceBuildingsInPlace(buildings, bundle.buildings);
        hud.setHint(`"${bundle.meta.name}" 파일에서 불러옴`);
      },
    });
  };

  toolbar.on((id) => {
    if (id === 'save' || id === 'load') {
      openDialog();
      toolbar.setActive('select');
      return;
    }
    if (id === 'spawn-50')   { post({ type: 'spawnVehicles', count: 50 });  toolbar.setActive('select'); hud.setHint('차량 50대 스폰 요청');  return; }
    if (id === 'spawn-500')  { post({ type: 'spawnVehicles', count: 500 }); toolbar.setActive('select'); hud.setHint('차량 500대 스폰 요청'); return; }
    if (id === 'spawn-clear'){ post({ type: 'clearVehicles' });              toolbar.setActive('select'); hud.setHint('차량 모두 제거');     return; }
    if (id === 'time-pause') { post({ type: 'setTimeScale', scale: 0 }); toolbar.setActive('select'); hud.setHint('일시정지'); return; }
    if (id === 'time-1x')    { post({ type: 'setTimeScale', scale: 1 }); toolbar.setActive('select'); hud.setHint('1배속'); return; }
    if (id === 'time-3x')    { post({ type: 'setTimeScale', scale: 3 }); toolbar.setActive('select'); hud.setHint('3배속'); return; }
    if (id === 'time-9x')    { post({ type: 'setTimeScale', scale: 9 }); toolbar.setActive('select'); hud.setHint('9배속'); return; }

    const t = toolRegistry[id] ?? null;
    toolHost.setActive(t);
    const isZoneTool = id.startsWith('zone-');
    renderer.setZoneOverlayVisibility(isZoneTool ? 1 : 0);
    if (id === 'road-straight') hud.setHint('도로(직선): 좌클릭 시작점/끝점, 연속 클릭으로 체인. ESC 초기화.');
    else if (id === 'road-curved') hud.setHint('도로(곡선): 좌클릭 시작점→꺾는점→끝점.');
    else if (id === 'road-erase') hud.setHint('도로(철거): 도로 위 좌클릭으로 해당 세그먼트 삭제.');
    else if (id === 'zone-res') hud.setHint('주거 존 페인트: 좌클릭 드래그로 칠하기, Shift+드래그로 지우기.');
    else if (id === 'zone-com') hud.setHint('상업 존 페인트: 좌클릭 드래그. 도로에 인접한 셀에 자동으로 건물이 들어섭니다.');
    else if (id === 'zone-ind') hud.setHint('산업 존 페인트: 좌클릭 드래그.');
    else hud.setHint('툴 선택 — 좌측에서 도구를 골라보세요.');
  });

  // --- Render loop -------------------------------------------------------
  let last = performance.now();
  let smoothed = 0;
  let lastZoneVersion = zoneGrid.version;
  const loop = (now: number): void => {
    const dt = now - last;
    last = now;
    if (dt > 0) {
      const inst = 1000 / dt;
      smoothed = smoothed === 0 ? inst : smoothed * 0.92 + inst * 0.08;
      hud.setFps(smoothed);
    }
    const r = canvas.getBoundingClientRect();
    renderer.resize(r.width, r.height, Math.min(2, devicePixelRatio || 1));

    if (roadGraph.version !== lastSentVersion) {
      lastSentVersion = roadGraph.version;
      sendGraphSnapshot();
    }

    // If the user erased zone cells, prune buildings that no longer have a zone.
    if (zoneGrid.version !== lastZoneVersion) {
      reconcileZoneRemovals(zoneGrid, buildings);
      lastZoneVersion = zoneGrid.version;
    }

    // Auto-place a few buildings each frame on roads-adjacent zoned cells.
    if (roadGraph.segCount > 0) {
      // Use the same snapshot the worker last saw — ok to rebuild here
      // (cheap relative to the graph size at our scale).
      const snap = buildGraphSnapshot(roadGraph);
      tickBuildingPlacement(zoneGrid, buildings, snap, 32);
    }

    const preview = toolHost.active()?.preview().road ?? null;
    renderer.setRoadState(roadGraph, preview);
    renderer.syncBuildings(buildings);
    renderer.syncZones(zoneGrid);

    if (vehicleHeader && vehicleData) {
      const aliveCount = Atomics.load(vehicleHeader, 0);
      renderer.setVehicleFrame({ data: vehicleData, count: aliveCount });
    } else if (fallbackData) {
      renderer.setVehicleFrame({ data: fallbackData, count: fallbackCount });
    }

    if (renderer.status.kind === 'ready') renderer.draw(cam);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

main().catch((e: unknown) => {
  hud.setHint(`초기화 실패: ${String(e)}`);
  // eslint-disable-next-line no-console
  console.error(e);
});
