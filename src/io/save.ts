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
import {
  createZoneGrid,
  type ZoneGrid,
} from '../sim/zoning/grid';
import {
  addBuilding,
  createBuildingStore,
  type BuildingStore,
} from '../sim/buildings/store';
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

const buildBundle = (
  graph: RoadGraph,
  zone: ZoneGrid,
  buildings: BuildingStore,
  world: WorldMeta,
  name: string,
): SaveBundle => ({
  meta: {
    name,
    saveTimeMs: Date.now(),
    seed: world.seed,
    worldWidthCells: world.worldWidthCells,
    worldHeightCells: world.worldHeightCells,
    cellSize: world.cellSize,
  },
  graph,
  zone,
  buildings,
});

// In-place replace zone grid contents. Copies the loaded grid's cells into
// the live grid; if dimensions differ, the live grid is rebuilt to match.
export const replaceZoneInPlace = (live: ZoneGrid, loaded: ZoneGrid): void => {
  if (live.width !== loaded.width || live.height !== loaded.height) {
    const fresh = createZoneGrid(loaded.width, loaded.height, loaded.cellSize);
    live.width = fresh.width;
    live.height = fresh.height;
    live.cellSize = fresh.cellSize;
    live.originX = fresh.originX;
    live.originZ = fresh.originZ;
    live.cells = fresh.cells;
  }
  live.cellSize = loaded.cellSize;
  live.originX = loaded.originX;
  live.originZ = loaded.originZ;
  live.cells.set(loaded.cells);
  live.version++;
};

// Replace buildings store; bytes-equivalent by re-adding each live entry.
export const replaceBuildingsInPlace = (live: BuildingStore, loaded: BuildingStore): void => {
  live.count = 0;
  live.alive.fill(0);
  live.cellToBldg.fill(-1);
  live.free.length = 0;
  // Reverse-lookup loaded.cellToBldg → cell index per loaded slot.
  const idToCell = new Int32Array(loaded.count);
  idToCell.fill(-1);
  for (let c = 0; c < loaded.cellToBldg.length; c++) {
    const id = loaded.cellToBldg[c]!;
    if (id >= 0) idToCell[id] = c;
  }
  for (let i = 0; i < loaded.count; i++) {
    if (!loaded.alive[i]) continue;
    const cell = idToCell[i]!;
    if (cell < 0 || cell >= live.cellToBldg.length) continue;
    addBuilding(live, cell,
      loaded.posX[i]!, loaded.posZ[i]!,
      loaded.height[i]!,
      loaded.typeAndSeed[i]! & 0xf,
      (loaded.typeAndSeed[i]! >>> 4) & 0x0fffffff,
    );
  }
  live.version++;
};

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

export const encodeBundle = (
  graph: RoadGraph, zone: ZoneGrid, buildings: BuildingStore,
  world: WorldMeta, name: string,
): Uint8Array =>
  encode(buildBundle(graph, zone, buildings, world, name));

export const saveToSlot = async (
  graph: RoadGraph, zone: ZoneGrid, buildings: BuildingStore,
  world: WorldMeta, name: string,
): Promise<{ id: number; bytes: Uint8Array }> => {
  const bytes = encodeBundle(graph, zone, buildings, world, name);
  const id = await putSlot(name, bytes);
  return { id, bytes };
};

export const overwriteSlot = async (
  id: number, graph: RoadGraph, zone: ZoneGrid, buildings: BuildingStore,
  world: WorldMeta, name: string,
): Promise<Uint8Array> => {
  const bytes = encodeBundle(graph, zone, buildings, world, name);
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

export const autoSave = async (
  graph: RoadGraph, zone: ZoneGrid, buildings: BuildingStore, world: WorldMeta,
): Promise<void> => {
  const bytes = encodeBundle(graph, zone, buildings, world, '<autosave>');
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
