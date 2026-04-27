// Entry point. Brings up the renderer, the simulation worker, and the UI shell.

import { createCamera, updateCamera } from '../render/camera';
import { attachCameraControls } from '../render/cameraControl';
import { createRenderer } from '../render/renderer';
import { buildToolbar } from '../ui/toolbar';
import { hud } from './hud';
import type { MainToSim, SimToMain } from '../worker/protocol';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const tools = document.getElementById('tools') as HTMLElement;

buildToolbar(tools);

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

const main = async (): Promise<void> => {
  // 1) Renderer
  const renderer = await createRenderer(canvas);
  if (renderer.status.kind === 'unsupported') {
    hud.setRenderer('unsupported', 'err');
    hud.setHint(renderer.status.reason);
  } else {
    hud.setRenderer(renderer.status.backend, 'ok');
    hud.setHint('우클릭 드래그로 시점 회전, 휠로 줌, WASD로 이동, Shift+드래그로 패닝');
  }

  // 2) Simulation worker handshake
  const worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  const post = (m: MainToSim): void => worker.postMessage(m);

  worker.onmessage = (ev: MessageEvent<SimToMain>): void => {
    const msg = ev.data;
    switch (msg.type) {
      case 'ready':
        hud.setWorker(msg.capabilities.sab ? 'ready (sab)' : 'ready', 'ok');
        post({
          type: 'init',
          seed: 1,
          worldWidthCells: 1024,
          worldHeightCells: 1024,
          cellSizeMeters: 8,
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

  // 3) Render loop with smoothed FPS counter.
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
    // Resize-on-the-fly: keep backbuffer in sync with CSS size.
    const r = canvas.getBoundingClientRect();
    renderer.resize(r.width, r.height, Math.min(2, devicePixelRatio || 1));
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
