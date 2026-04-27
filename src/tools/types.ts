// Common interface every editor tool implements. The tool host calls these in
// response to mouse/keyboard events that aren't claimed by the camera.

import type { Vec3 } from '../math/vec';

export interface ToolContext {
  // Cursor projected onto the ground plane (y = world height); null if the
  // ray missed (e.g., looking past the horizon).
  groundPos: Vec3 | null;
  // Was Shift held during this event? Tools use it to disable snapping.
  shift: boolean;
  // Current snap radius in world meters — varies with camera distance.
  snapRadius: number;
}

export interface RoadPreviewSpec {
  p0: Vec3;
  c0: Vec3;
  c1: Vec3;
  p1: Vec3;
}

export interface ToolPreview {
  road?: RoadPreviewSpec;
  // future: building footprint, zone paint, terrain brush, ...
}

export interface Tool {
  id: string;
  onPointerDown?: (ctx: ToolContext, button: number) => void;
  onPointerMove?: (ctx: ToolContext) => void;
  onPointerUp?:   (ctx: ToolContext, button: number) => void;
  onKey?:         (key: string, down: boolean) => void;
  // Called when the user switches away from this tool — clean up partial state.
  onDeactivate?:  () => void;
  preview: () => ToolPreview;
}
