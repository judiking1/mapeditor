// RTS-style mouse + keyboard controls for the orbital camera.
// Middle drag or WASD: pan target along ground.
// Right drag: orbit (yaw + pitch).
// Wheel: zoom.

import { screenToGround, updateCamera, type Camera } from './camera';

interface KeyState {
  w: boolean; a: boolean; s: boolean; d: boolean;
  q: boolean; e: boolean;
}

export const attachCameraControls = (canvas: HTMLCanvasElement, cam: Camera): () => void => {
  const keys: KeyState = { w: false, a: false, s: false, d: false, q: false, e: false };
  let dragging: 'pan' | 'orbit' | null = null;
  let lastX = 0;
  let lastY = 0;
  let panAnchor: [number, number, number] | null = null;

  const ndc = (clientX: number, clientY: number): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [
      ((clientX - r.left) / r.width) * 2 - 1,
      1 - ((clientY - r.top) / r.height) * 2,
    ];
  };

  const onPointerDown = (e: PointerEvent): void => {
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX; lastY = e.clientY;
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      dragging = 'pan';
      const [nx, ny] = ndc(e.clientX, e.clientY);
      panAnchor = screenToGround(cam, nx, ny, cam.target[1]);
    } else if (e.button === 2) {
      dragging = 'orbit';
    }
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragging === 'pan' && panAnchor) {
      // Re-anchor: drag should stick the world point originally under cursor to the cursor.
      const [nx, ny] = ndc(e.clientX, e.clientY);
      const cur = screenToGround(cam, nx, ny, cam.target[1]);
      if (cur) {
        cam.target[0] += panAnchor[0] - cur[0];
        cam.target[2] += panAnchor[2] - cur[2];
        updateCamera(cam);
      }
    } else if (dragging === 'orbit') {
      cam.yaw -= dx * 0.005;
      cam.pitch += dy * 0.005;
      const minPitch = 0.15;
      const maxPitch = Math.PI / 2 - 0.05;
      if (cam.pitch < minPitch) cam.pitch = minPitch;
      if (cam.pitch > maxPitch) cam.pitch = maxPitch;
      updateCamera(cam);
    }
  };

  const onPointerUp = (e: PointerEvent): void => {
    canvas.releasePointerCapture(e.pointerId);
    dragging = null;
    panAnchor = null;
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0015);
    const oldDist = cam.distance;
    const newDist = Math.max(15, Math.min(2000, oldDist * factor));
    if (newDist === oldDist) return;
    // Zoom-toward-cursor: shift the focus target toward the world point
    // currently under the cursor, scaled by how much the distance changed.
    const [nx, ny] = ndc(e.clientX, e.clientY);
    const ground = screenToGround(cam, nx, ny, cam.target[1]);
    cam.distance = newDist;
    if (ground) {
      const k = 1 - newDist / oldDist;
      cam.target[0] += (ground[0] - cam.target[0]) * k;
      cam.target[2] += (ground[2] - cam.target[2]) * k;
    }
    updateCamera(cam);
  };

  const onContextMenu = (e: Event): void => e.preventDefault();

  const onKey = (e: KeyboardEvent, down: boolean): void => {
    const k = e.key.toLowerCase();
    if (k in keys) (keys as unknown as Record<string, boolean>)[k] = down;
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', (e) => onKey(e, true));
  window.addEventListener('keyup', (e) => onKey(e, false));

  // Per-frame keyboard pan
  let raf = 0;
  let last = performance.now();
  const tick = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const speed = cam.distance * 0.8 * dt;
    let dx = 0, dz = 0;
    if (keys.w) dz -= 1;
    if (keys.s) dz += 1;
    if (keys.a) dx -= 1;
    if (keys.d) dx += 1;
    if (dx !== 0 || dz !== 0) {
      const len = Math.hypot(dx, dz);
      dx /= len; dz /= len;
      // Pan in camera-yaw frame.
      const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const wx = dx * cy + dz * sy;
      const wz = -dx * sy + dz * cy;
      cam.target[0] += wx * speed;
      cam.target[2] += wz * speed;
      updateCamera(cam);
    }
    if (keys.q) { cam.yaw += dt * 1.4; updateCamera(cam); }
    if (keys.e) { cam.yaw -= dt * 1.4; updateCamera(cam); }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
};
