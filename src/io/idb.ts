// Minimal Promise-based IndexedDB wrapper for save slots. One database, two
// stores: `slots` (named saves) and `kv` (autosave + small settings). We use
// Blobs for save payloads so the browser can spill large saves to disk.

const DB_NAME = 'citysim';
const DB_VERSION = 1;
const STORE_SLOTS = 'slots';
const STORE_KV = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SLOTS)) {
        db.createObjectStore(STORE_SLOTS, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
  });
  return dbPromise;
};

const tx = async <T>(
  store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const req = fn(s);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb request failed'));
    t.onerror = () => reject(t.error ?? new Error('idb tx failed'));
  });
};

export interface SaveSlotMeta {
  id: number;
  name: string;
  ts: number;       // ms since epoch
  byteLength: number;
}

interface StoredSlot extends SaveSlotMeta { data: Blob; }

export const putSlot = async (name: string, bytes: Uint8Array): Promise<number> => {
  const data = new Blob([bytes], { type: 'application/octet-stream' });
  const id = await tx<IDBValidKey>(STORE_SLOTS, 'readwrite', (s) =>
    s.add({ name, ts: Date.now(), byteLength: bytes.byteLength, data } as Omit<StoredSlot, 'id'>),
  );
  return Number(id);
};

export const updateSlot = async (id: number, name: string, bytes: Uint8Array): Promise<void> => {
  const data = new Blob([bytes], { type: 'application/octet-stream' });
  await tx<IDBValidKey>(STORE_SLOTS, 'readwrite', (s) =>
    s.put({ id, name, ts: Date.now(), byteLength: bytes.byteLength, data }),
  );
};

export const listSlots = async (): Promise<SaveSlotMeta[]> => {
  const db = await openDb();
  return new Promise<SaveSlotMeta[]>((resolve, reject) => {
    const t = db.transaction(STORE_SLOTS, 'readonly');
    const s = t.objectStore(STORE_SLOTS);
    const out: SaveSlotMeta[] = [];
    const req = s.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) {
        out.sort((a, b) => b.ts - a.ts);
        resolve(out);
        return;
      }
      const v = cur.value as StoredSlot;
      out.push({ id: v.id, name: v.name, ts: v.ts, byteLength: v.byteLength });
      cur.continue();
    };
    req.onerror = () => reject(req.error ?? new Error('idb list failed'));
  });
};

export const loadSlot = async (id: number): Promise<{ meta: SaveSlotMeta; bytes: Uint8Array }> => {
  const v = await tx<StoredSlot | undefined>(STORE_SLOTS, 'readonly', (s) => s.get(id));
  if (!v) throw new Error(`slot ${id} not found`);
  const buf = await v.data.arrayBuffer();
  return {
    meta: { id: v.id, name: v.name, ts: v.ts, byteLength: v.byteLength },
    bytes: new Uint8Array(buf),
  };
};

export const deleteSlot = async (id: number): Promise<void> => {
  await tx<undefined>(STORE_SLOTS, 'readwrite', (s) => s.delete(id));
};

export const putKv = async (key: string, bytes: Uint8Array): Promise<void> => {
  await tx<IDBValidKey>(STORE_KV, 'readwrite', (s) => s.put(new Blob([bytes]), key));
};

export const getKv = async (key: string): Promise<Uint8Array | null> => {
  const blob = await tx<Blob | undefined>(STORE_KV, 'readonly', (s) => s.get(key));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
};
