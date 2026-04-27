// Min-heap keyed by f(node) for A*. Values are node IDs; keys live in a
// parallel Float32Array. Reset and reuse to avoid per-search allocations.

export class NodeHeap {
  private nodes: Int32Array;
  private keys: Float32Array;
  private size = 0;

  constructor(capacity: number) {
    this.nodes = new Int32Array(capacity);
    this.keys = new Float32Array(capacity);
  }

  reset(): void { this.size = 0; }
  get length(): number { return this.size; }

  push(node: number, key: number): void {
    if (this.size >= this.nodes.length) this.grow();
    let i = this.size++;
    this.nodes[i] = node;
    this.keys[i] = key;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  popMin(): { node: number; key: number } | null {
    if (this.size === 0) return null;
    const node = this.nodes[0]!;
    const key = this.keys[0]!;
    this.size--;
    if (this.size > 0) {
      this.nodes[0] = this.nodes[this.size]!;
      this.keys[0] = this.keys[this.size]!;
      let i = 0;
      const n = this.size;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < n && this.keys[l]! < this.keys[s]!) s = l;
        if (r < n && this.keys[r]! < this.keys[s]!) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return { node, key };
  }

  private swap(i: number, j: number): void {
    const tn = this.nodes[i]!; this.nodes[i] = this.nodes[j]!; this.nodes[j] = tn;
    const tk = this.keys[i]!; this.keys[i] = this.keys[j]!; this.keys[j] = tk;
  }

  private grow(): void {
    const cap = this.nodes.length * 2;
    const n = new Int32Array(cap); n.set(this.nodes);
    const k = new Float32Array(cap); k.set(this.keys);
    this.nodes = n; this.keys = k;
  }
}
