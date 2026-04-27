// High-level save/load orchestration. Builds the SaveBundle from current
// editor state and replaces the live road graph in-place on load (so any
// other modules that hold a reference to it keep working).

import {
  addNode,
  addSegment,
  isNodeAlive,
  isSegAlive,
  type RoadGraph,
} from '../sim/road/graph';
import { decode, encode, type SaveBundle, type SaveMeta } from './format';
import {
  deleteSlot,
  getKv,
  listSlots,
  loadSlot,
  putKv,
  putSlot,
  updateSlot,
  type SaveSlotMeta,
} from './idb';

export interface WorldMeta {
  seed: number;
  worldWidthCells: number;
  worldHeightCells: number;
  cellSize: number;
}

const buildBundle = (graph: RoadGraph, world: WorldMeta, name: string): SaveBundle => ({
  meta: {
    name,
    saveTimeMs: Date.now(),
    seed: world.seed,
    worldWidthCells: world.worldWidthCells,
    worldHeightCells: world.worldHeightCells,
    cellSize: world.cellSize,
  },
  graph,
});

// In-place replace: clear the live graph, then copy nodes/segments out of the
// loaded bundle. We keep the existing object so other modules' references
// (renderer, tools) stay valid.
export const replaceGraphInPlace = (live: RoadGraph, loaded: RoadGraph): void => {
  live.nodeCount = 0;
  live.segCount = 0;
  live.freeNodes.length = 0;
  live.freeSegs.length = 0;
  live.nodeFlags.fill(0);
  live.segFlags.fill(0);

  const remap: number[] = new Array(loaded.nodeCount);
  for (let i = 0; i < loaded.nodeCount; i++) {
    if (!isNodeAlive(loaded, i)) continue;
    const id = addNode(live, [
      loaded.nodePos[i * 3]!,
      loaded.nodePos[i * 3 + 1]!,
      loaded.nodePos[i * 3 + 2]!,
    ]);
    remap[i] = id;
  }
  for (let s = 0; s < loaded.segCount; s++) {
    if (!isSegAlive(loaded, s)) continue;
    const a = loaded.segNodes[s * 2]!;
    const b = loaded.segNodes[s * 2 + 1]!;
    const ra = remap[a];
    const rb = remap[b];
    if (ra === undefined || rb === undefined) continue;
    addSegment(
      live, ra, rb,
      [loaded.segCtrl[s * 6]!, loaded.segCtrl[s * 6 + 1]!, loaded.segCtrl[s * 6 + 2]!],
      [loaded.segCtrl[s * 6 + 3]!, loaded.segCtrl[s * 6 + 4]!, loaded.segCtrl[s * 6 + 5]!],
      (loaded.segFlags[s]! >> 4) & 0xf,
    );
  }
};

export const encodeBundle = (graph: RoadGraph, world: WorldMeta, name: string): Uint8Array =>
  encode(buildBundle(graph, world, name));

export const saveToSlot = async (
  graph: RoadGraph, world: WorldMeta, name: string,
): Promise<{ id: number; bytes: Uint8Array }> => {
  const bytes = encodeBundle(graph, world, name);
  const id = await putSlot(name, bytes);
  return { id, bytes };
};

export const overwriteSlot = async (
  id: number, graph: RoadGraph, world: WorldMeta, name: string,
): Promise<Uint8Array> => {
  const bytes = encodeBundle(graph, world, name);
  await updateSlot(id, name, bytes);
  return bytes;
};

export const loadFromSlot = async (id: number): Promise<{ meta: SaveMeta; bundle: SaveBundle }> => {
  const { bytes } = await loadSlot(id);
  const bundle = decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  return { meta: bundle.meta, bundle };
};

export const decodeBytes = (bytes: Uint8Array): SaveBundle =>
  decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

export const downloadAsFile = (bytes: Uint8Array, suggestedName: string): void => {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName.endsWith('.citysim') ? suggestedName : `${suggestedName}.citysim`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so Safari finishes the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const pickFile = (): Promise<File | null> => new Promise((resolve) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.citysim,application/octet-stream';
  input.onchange = () => {
    resolve(input.files?.[0] ?? null);
  };
  // If the user cancels, the change event never fires; we resolve(null) on
  // window focus as a fallback.
  const cancel = (): void => { setTimeout(() => resolve(null), 200); };
  window.addEventListener('focus', cancel, { once: true });
  input.click();
});

const AUTOSAVE_KEY = 'autosave-v1';

export const autoSave = async (graph: RoadGraph, world: WorldMeta): Promise<void> => {
  const bytes = encodeBundle(graph, world, '<autosave>');
  await putKv(AUTOSAVE_KEY, bytes);
};

export const tryLoadAutosave = async (): Promise<SaveBundle | null> => {
  const bytes = await getKv(AUTOSAVE_KEY);
  if (!bytes) return null;
  try {
    return decodeBytes(bytes);
  } catch {
    return null;
  }
};

export {
  deleteSlot,
  listSlots,
  type SaveSlotMeta,
};
