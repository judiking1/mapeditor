// Entry point. Brings up the renderer, the simulation worker, and the UI shell.

import { createCamera, updateCamera } from '../render/camera';
import { attachCameraControls } from '../render/cameraControl';
import { createRenderer } from '../render/renderer';
import { createRoadGraph } from '../sim/road/graph';
import {
  autoSave,
  decodeBytes,
  encodeBundle,
  loadFromSlot,
  pickFile,
  replaceGraphInPlace,
  saveToSlot,
  tryLoadAutosave,
  type WorldMeta,
} from '../io/save';
import { openSaveDialog } from '../ui/saveDialog';
import { attachToolHost } from '../tools/toolHost';
import { createCurvedRoadTool, createEraseTool, createStraightRoadTool } from '../tools/roadTool';
import type { Tool } from '../tools/types';
import { buildToolbar } from '../ui/toolbar';
import { hud } from './hud';
import type { MainToSim, SimToMain } from '../worker/protocol';

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
const toolHost = attachToolHost({ canvas, camera: cam, groundY: 0 });

const toolRegistry: Record<string, Tool | null> = {
  select: null,
  pan: null,
  'road-straight': createStraightRoadTool(roadGraph),
  'road-curved': createCurvedRoadTool(roadGraph),
  'road-erase': createEraseTool(roadGraph),
};

const openDialog = (): void => {
  openSaveDialog({
    defaultName: `city-${new Date().toISOString().slice(0, 16).replace(':', '')}`,
    onSave: async (name) => {
      await saveToSlot(roadGraph, worldMeta, name);
      hud.setHint(`"${name}" 저장 완료`);
    },
    onLoad: async (id) => {
      const { meta, bundle } = await loadFromSlot(id);
      replaceGraphInPlace(roadGraph, bundle.graph);
      hud.setHint(`"${meta.name}" 불러옴`);
    },
    onExport: async () => {
      const name = `city-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;
      const bytes = encodeBundle(roadGraph, worldMeta, name);
      return { bytes, suggestedName: name };
    },
    onImport: async () => {
      const file = await pickFile();
      if (!file) return;
      const buf = await file.arrayBuffer();
      const bundle = decodeBytes(new Uint8Array(buf));
      replaceGraphInPlace(roadGraph, bundle.graph);
      hud.setHint(`"${bundle.meta.name}" 파일에서 불러옴`);
    },
  });
};

toolbar.on((id) => {
  if (id === 'save' || id === 'load') {
    openDialog();
    // Reset to a safe selection so clicking Save/Load again re-opens.
    toolbar.setActive('select');
    return;
  }
  const t = toolRegistry[id] ?? null;
  toolHost.setActive(t);
  if (id === 'road-straight') hud.setHint('도로(직선): 좌클릭 시작점/끝점, 연속 클릭으로 체인. ESC 초기화. Shift+드래그=카메라.');
  else if (id === 'road-curved') hud.setHint('도로(곡선): 좌클릭 시작점→꺾는점→끝점. ESC 초기화.');
  else if (id === 'road-erase') hud.setHint('도로(철거): 도로 위 좌클릭으로 해당 세그먼트 삭제.');
  else hud.setHint('툴 선택 — 좌측에서 도구를 골라보세요.');
});

const main = async (): Promise<void> => {
  const renderer = await createRenderer(canvas);
  if (renderer.status.kind === 'unsupported') {
    hud.setRenderer('unsupported', 'err');
    hud.setHint(renderer.status.reason);
  } else {
    hud.setRenderer(renderer.status.backend, 'ok');
    hud.setHint('우클릭=회전, 휠=줌, WASD=이동, Shift+드래그=패닝.');
  }

  // Try restoring the last autosave so reloads don't lose work.
  try {
    const restored = await tryLoadAutosave();
    if (restored && (restored.graph.nodeCount > 0 || restored.graph.segCount > 0)) {
      replaceGraphInPlace(roadGraph, restored.graph);
      hud.setHint('자동저장 복원됨');
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('autosave restore failed', e);
  }

  // Periodic autosave: only when the graph version has changed since last write.
  let lastSavedVersion = roadGraph.version;
  setInterval(() => {
    if (roadGraph.version === lastSavedVersion) return;
    lastSavedVersion = roadGraph.version;
    autoSave(roadGraph, worldMeta).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('autosave failed', e);
    });
  }, 8000);

  const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  const post = (m: MainToSim): void => worker.postMessage(m);
  worker.onmessage = (ev: MessageEvent<SimToMain>): void => {
    const msg = ev.data;
    switch (msg.type) {
      case 'ready':
        hud.setWorker(msg.capabilities.sab ? 'ready (sab)' : 'ready', 'ok');
        post({
          type: 'init',
          seed: worldMeta.seed,
          worldWidthCells: worldMeta.worldWidthCells,
          worldHeightCells: worldMeta.worldHeightCells,
          cellSizeMeters: worldMeta.cellSize,
        });
        break;
      case 'tick':
        hud.setTick(msg.simTick);
        break;
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

  let last = performance.now();
  let smoothed = 0;
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

    const preview = toolHost.active()?.preview().road ?? null;
    renderer.setRoadState(roadGraph, preview);

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
