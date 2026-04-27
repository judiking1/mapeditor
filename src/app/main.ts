// Entry point. Brings up the renderer, the simulation worker, and the UI shell.

import { createCamera, updateCamera } from '../render/camera';
import { attachCameraControls } from '../render/cameraControl';
import { createRenderer } from '../render/renderer';
import { createRoadGraph } from '../sim/road/graph';
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

// Editor state
const roadGraph = createRoadGraph();
const toolHost = attachToolHost({ canvas, camera: cam, groundY: 0 });

const toolRegistry: Record<string, Tool | null> = {
  select: null,
  pan: null,
  'road-straight': createStraightRoadTool(roadGraph),
  'road-curved': createCurvedRoadTool(roadGraph),
  'road-erase': createEraseTool(roadGraph),
};

toolbar.on((id) => {
  const t = toolRegistry[id] ?? null;
  toolHost.setActive(t);
  if (id === 'road-straight') hud.setHint('도로(직선): 좌클릭으로 시작점/끝점. ESC로 초기화. Shift+드래그/우클릭은 카메라.');
  else if (id === 'road-curved') hud.setHint('도로(곡선): 좌클릭으로 시작점→꺾는점→끝점 순서. ESC로 초기화.');
  else if (id === 'road-erase') hud.setHint('도로(철거): 도로 위 좌클릭으로 해당 세그먼트 삭제.');
  else hud.setHint('툴 선택 — 도로 그룹에서 도구를 골라보세요.');
});

const main = async (): Promise<void> => {
  const renderer = await createRenderer(canvas);
  if (renderer.status.kind === 'unsupported') {
    hud.setRenderer('unsupported', 'err');
    hud.setHint(renderer.status.reason);
  } else {
    hud.setRenderer(renderer.status.backend, 'ok');
    hud.setHint('우클릭=회전, 휠=줌, WASD=이동, Shift+드래그=패닝. 좌측에서 도구를 선택하세요.');
  }

  const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  const post = (m: MainToSim): void => worker.postMessage(m);
  worker.onmessage = (ev: MessageEvent<SimToMain>): void => {
    const msg = ev.data;
    switch (msg.type) {
      case 'ready':
        hud.setWorker(msg.capabilities.sab ? 'ready (sab)' : 'ready', 'ok');
        post({ type: 'init', seed: 1, worldWidthCells: 1024, worldHeightCells: 1024, cellSizeMeters: 8 });
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

    // Feed the renderer the latest road state. preview() returns a fresh object
    // when present, so identity comparison inside the renderer is enough to
    // detect changes.
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
