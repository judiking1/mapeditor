// Routes left-button pointer events on the canvas to the active tool.
// Camera control already owns middle-drag/right-drag/wheel/shift+drag, so we
// only listen for plain left-button events here — no contention.

import { screenToGround, type Camera } from '../render/camera';
import type { Tool, ToolContext } from './types';

export interface ToolHost {
  setActive: (tool: Tool | null) => void;
  active: () => Tool | null;
  context: () => ToolContext;
  detach: () => void;
}

export interface ToolHostOpts {
  canvas: HTMLCanvasElement;
  camera: Camera;
  groundY: number;
}

export const attachToolHost = ({ canvas, camera, groundY }: ToolHostOpts): ToolHost => {
  let active: Tool | null = null;
  const ctx: ToolContext = { groundPos: null, shift: false, snapRadius: 12 };

  const updateGround = (clientX: number, clientY: number, shift: boolean): void => {
    const r = canvas.getBoundingClientRect();
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = 1 - ((clientY - r.top) / r.height) * 2;
    ctx.groundPos = screenToGround(camera, ndcX, ndcY, groundY);
    ctx.shift = shift;
    // Snap radius scales with camera distance — closer in, tighter snaps.
    ctx.snapRadius = Math.max(4, Math.min(40, camera.distance * 0.04));
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (e.shiftKey) return; // shift+left is camera pan
    if (!active) return;
    updateGround(e.clientX, e.clientY, e.shiftKey);
    active.onPointerDown?.(ctx, e.button);
  };

  const onPointerMove = (e: PointerEvent): void => {
    updateGround(e.clientX, e.clientY, e.shiftKey);
    if (!active) return;
    active.onPointerMove?.(ctx);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!active) return;
    updateGround(e.clientX, e.clientY, e.shiftKey);
    active.onPointerUp?.(ctx, e.button);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active) return;
    active.onKey?.(e.key, true);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (!active) return;
    active.onKey?.(e.key, false);
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  return {
    setActive: (t) => {
      if (active && active !== t) active.onDeactivate?.();
      active = t;
    },
    active: () => active,
    context: () => ctx,
    detach: () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
};
