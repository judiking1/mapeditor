// Tiny growable binary writer/reader. All multi-byte values are little-endian
// — we set them via DataView with explicit `true` so this stays portable across
// architectures regardless of host endianness.

const enc = new TextEncoder();
const dec = new TextDecoder();

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  pos = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength;
    while (cap < this.pos + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): void { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  u16(v: number): void { this.ensure(2); this.view.setUint16(this.pos, v, true); this.pos += 2; }
  u32(v: number): void { this.ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  i32(v: number): void { this.ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; }
  f32(v: number): void { this.ensure(4); this.view.setFloat32(this.pos, v, true); this.pos += 4; }
  f64(v: number): void { this.ensure(8); this.view.setFloat64(this.pos, v, true); this.pos += 8; }

  bytes(b: Uint8Array): void {
    this.ensure(b.byteLength);
    this.buf.set(b, this.pos);
    this.pos += b.byteLength;
  }

  // 4-character ASCII tag
  tag(t: string): void {
    if (t.length !== 4) throw new Error(`tag must be 4 chars: ${t}`);
    this.u8(t.charCodeAt(0));
    this.u8(t.charCodeAt(1));
    this.u8(t.charCodeAt(2));
    this.u8(t.charCodeAt(3));
  }

  // Length-prefixed UTF-8 string (u16 length)
  string(s: string): void {
    const b = enc.encode(s);
    this.u16(b.byteLength);
    this.bytes(b);
  }

  // Reserve a u32 slot to backfill later (used for chunk size).
  reserveU32(): number {
    this.ensure(4);
    const slot = this.pos;
    this.pos += 4;
    return slot;
  }

  patchU32(slot: number, v: number): void {
    this.view.setUint32(slot, v >>> 0, true);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export class Reader {
  private view: DataView;
  pos = 0;

  constructor(public buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }

  get remaining(): number { return this.view.byteLength - this.pos; }
  get atEnd(): boolean { return this.pos >= this.view.byteLength; }

  u8(): number { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  u16(): number { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  f32(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64(): number { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }

  bytes(n: number): Uint8Array {
    const b = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n).slice();
    this.pos += n;
    return b;
  }

  tag(): string {
    const a = this.u8(), b = this.u8(), c = this.u8(), d = this.u8();
    return String.fromCharCode(a, b, c, d);
  }

  string(): string {
    const n = this.u16();
    const slice = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return dec.decode(slice);
  }

  // Read a typed-array view of `count` Float32s, then advance.
  f32s(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) arr[i] = this.f32();
    return arr;
  }

  i32s(count: number): Int32Array {
    const arr = new Int32Array(count);
    for (let i = 0; i < count; i++) arr[i] = this.i32();
    return arr;
  }
}
