/** Export-local LRU; PNG buffers are the only retained frame data. */
export class FrameCache {
  private entries = new Map<string, Buffer>();
  bytes = 0;
  peakBytes = 0;
  hits = 0;
  misses = 0;
  evictions = 0;
  constructor(readonly limit: number) {}
  get(key: string): Buffer | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, value);
    } else this.misses++;
    return value;
  }
  set(key: string, value: Buffer) {
    if (value.length > this.limit) return;
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.length;
      this.entries.delete(key);
    }
    while (this.bytes + value.length > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.length;
      this.entries.delete(oldest);
      this.evictions++;
    }
    this.entries.set(key, value);
    this.bytes += value.length;
    this.peakBytes = Math.max(this.peakBytes, this.bytes);
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
