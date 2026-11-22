/** Weak lookup with a diagnostic index that can enumerate live keys. */
export class WeakKeyMap<V> {
  private readonly entriesByKey = new WeakMap<object, { value: V; ref: WeakRef<object> }>();
  private readonly refs = new Set<WeakRef<object>>();
  private readonly finalizer = new FinalizationRegistry<WeakRef<object>>(ref => {
    this.refs.delete(ref);
  });

  get(key: object): V | undefined { return this.entriesByKey.get(key)?.value; }
  has(key: object): boolean { return this.entriesByKey.has(key); }

  set(key: object, value: V): void {
    const existing = this.entriesByKey.get(key);
    if (existing) {
      existing.value = value;
      return;
    }
    const ref = new WeakRef(key);
    this.entriesByKey.set(key, { value, ref });
    this.refs.add(ref);
    this.finalizer.register(key, ref, ref);
  }

  delete(key: object): void {
    const entry = this.entriesByKey.get(key);
    if (!entry) return;
    this.finalizer.unregister(entry.ref);
    this.refs.delete(entry.ref);
    this.entriesByKey.delete(key);
  }

  *keys(): IterableIterator<object> {
    for (const ref of this.refs) {
      const key = ref.deref();
      if (key) yield key;
      else this.refs.delete(ref);
    }
  }

  *entries(): IterableIterator<[object, V]> {
    for (const key of this.keys()) yield [key, this.entriesByKey.get(key)!.value];
  }

  get size(): number { return this.refs.size; }
}
