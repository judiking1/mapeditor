// `.citysim` binary format. Versioned chunked layout — unknown chunks are
// silently skipped on load, schema bumps inside known chunks reject mismatched
// data so we can evolve fields without losing forward compatibility for the
// fields we recognize.
//
//   File:
//     magic   "CSIM"     (4 bytes)
//     version u32        (file format = 1)
//     [ chunk ]*
//
//   Chunk:
//     tag     4 ASCII chars
//     size    u32  (payload size in bytes, NOT including tag/size)
//     payload bytes[size]

import { Reader, Writer } from './binary';
import {
  addNode,
  addSegment,
  createRoadGraph,
  type RoadGraph,
} from '../sim/road/graph';

const MAGIC = 'CSIM';
const FILE_VERSION = 1;

export const TAG_META = 'META';
export const TAG_ROAD = 'ROAD';

export interface SaveMeta {
  name: string;
  saveTimeMs: number;
  seed: number;
  worldWidthCells: number;
  worldHeightCells: number;
  cellSize: number;
}

export interface SaveBundle {
  meta: SaveMeta;
  graph: RoadGraph;
}

const writeChunk = (w: Writer, tag: string, body: (w: Writer) => void): void => {
  w.tag(tag);
  const sizeSlot = w.reserveU32();
  const start = w.pos;
  body(w);
  w.patchU32(sizeSlot, w.pos - start);
};

const writeMeta = (w: Writer, m: SaveMeta): void => {
  writeChunk(w, TAG_META, (w) => {
    w.u32(1); // schema
    w.f64(m.saveTimeMs);
    w.u32(m.seed);
    w.u32(m.worldWidthCells);
    w.u32(m.worldHeightCells);
    w.f32(m.cellSize);
    w.string(m.name);
  });
};

const writeRoad = (w: Writer, g: RoadGraph): void => {
  writeChunk(w, TAG_ROAD, (w) => {
    w.u32(1); // schema

    // Walk live nodes, build a remap so loaded files don't carry holes from
    // free-list reuse. The remapped index = the order we write nodes here.
    const nodeRemap = new Int32Array(g.nodeCount);
    nodeRemap.fill(-1);
    let liveNodes = 0;
    for (let i = 0; i < g.nodeCount; i++) {
      if ((g.nodeFlags[i]! & 1) === 0) continue;
      nodeRemap[i] = liveNodes++;
    }

    let liveSegs = 0;
    for (let s = 0; s < g.segCount; s++) {
      if ((g.segFlags[s]! & 1) === 0) continue;
      liveSegs++;
    }

    w.u32(liveNodes);
    for (let i = 0; i < g.nodeCount; i++) {
      if ((g.nodeFlags[i]! & 1) === 0) continue;
      w.f32(g.nodePos[i * 3]!);
      w.f32(g.nodePos[i * 3 + 1]!);
      w.f32(g.nodePos[i * 3 + 2]!);
    }

    w.u32(liveSegs);
    for (let s = 0; s < g.segCount; s++) {
      if ((g.segFlags[s]! & 1) === 0) continue;
      const a = g.segNodes[s * 2]!;
      const b = g.segNodes[s * 2 + 1]!;
      const ra = nodeRemap[a]!;
      const rb = nodeRemap[b]!;
      if (ra < 0 || rb < 0) continue; // shouldn't happen — segment refs dead node
      w.u32(ra);
      w.u32(rb);
      for (let k = 0; k < 6; k++) w.f32(g.segCtrl[s * 6 + k]!);
      w.u32((g.segFlags[s]! >> 4) & 0xf);
    }
  });
};

export const encode = (bundle: SaveBundle): Uint8Array => {
  const w = new Writer(8 * 1024);
  w.tag(MAGIC);
  w.u32(FILE_VERSION);
  writeMeta(w, bundle.meta);
  writeRoad(w, bundle.graph);
  return w.finish();
};

const readMeta = (r: Reader, payloadEnd: number): SaveMeta => {
  const schema = r.u32();
  if (schema !== 1) throw new Error(`META schema ${schema} unsupported`);
  const saveTimeMs = r.f64();
  const seed = r.u32();
  const worldWidthCells = r.u32();
  const worldHeightCells = r.u32();
  const cellSize = r.f32();
  const name = r.string();
  if (r.pos > payloadEnd) throw new Error('META payload overrun');
  return { saveTimeMs, seed, worldWidthCells, worldHeightCells, cellSize, name };
};

const readRoadInto = (r: Reader, payloadEnd: number, g: RoadGraph): void => {
  const schema = r.u32();
  if (schema !== 1) throw new Error(`ROAD schema ${schema} unsupported`);
  const nNodes = r.u32();
  const ids: number[] = new Array(nNodes);
  for (let i = 0; i < nNodes; i++) {
    const x = r.f32(), y = r.f32(), z = r.f32();
    ids[i] = addNode(g, [x, y, z]);
  }
  const nSegs = r.u32();
  for (let s = 0; s < nSegs; s++) {
    const a = r.u32(), b = r.u32();
    const cax = r.f32(), cay = r.f32(), caz = r.f32();
    const cbx = r.f32(), cby = r.f32(), cbz = r.f32();
    const type = r.u32();
    const ai = ids[a], bi = ids[b];
    if (ai === undefined || bi === undefined) throw new Error('ROAD segment refs missing node');
    addSegment(g, ai, bi, [cax, cay, caz], [cbx, cby, cbz], type);
  }
  if (r.pos > payloadEnd) throw new Error('ROAD payload overrun');
};

export const decode = (buf: ArrayBuffer): SaveBundle => {
  const r = new Reader(buf);
  if (r.remaining < 8) throw new Error('file too small');
  const magic = r.tag();
  if (magic !== MAGIC) throw new Error(`bad magic: ${magic}`);
  const fileVersion = r.u32();
  if (fileVersion !== FILE_VERSION) {
    throw new Error(`file version ${fileVersion} unsupported (want ${FILE_VERSION})`);
  }

  let meta: SaveMeta | null = null;
  const graph = createRoadGraph();

  while (!r.atEnd) {
    if (r.remaining < 8) throw new Error('truncated chunk header');
    const tag = r.tag();
    const size = r.u32();
    if (size > r.remaining) throw new Error(`chunk ${tag} size ${size} exceeds remaining ${r.remaining}`);
    const end = r.pos + size;
    switch (tag) {
      case TAG_META: meta = readMeta(r, end); break;
      case TAG_ROAD: readRoadInto(r, end, graph); break;
      default:
        // Unknown chunk — skip forward.
        r.pos = end;
        break;
    }
    if (r.pos !== end) {
      // Schema may have written fewer bytes than declared (forward compat) —
      // jump to the declared end.
      r.pos = end;
    }
  }

  if (!meta) throw new Error('save missing META chunk');
  return { meta, graph };
};
