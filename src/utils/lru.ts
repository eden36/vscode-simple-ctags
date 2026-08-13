export interface LruOptions<K, V> {
  readonly maxItems: number;
  readonly maxWeight?: number;
  readonly weight?: (value: V, key: K) => number;
  readonly onEvict?: (value: V, key: K) => void | Promise<void>;
}

interface Entry<V> {
  readonly value: V;
  readonly weight: number;
}

export class LruCache<K, V> {
  private readonly entries = new Map<K, Entry<V>>();
  private totalWeight = 0;

  public constructor(private readonly options: LruOptions<K, V>) {}

  public get size(): number {
    return this.entries.size;
  }

  public get weight(): number {
    return this.totalWeight;
  }

  public get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  public peek(key: K): V | undefined {
    return this.entries.get(key)?.value;
  }

  public set(key: K, value: V): void {
    this.delete(key);
    const weight = Math.max(0, this.options.weight?.(value, key) ?? 1);
    this.entries.set(key, { value, weight });
    this.totalWeight += weight;
    this.trim();
  }

  public delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) {
      return false;
    }
    this.entries.delete(key);
    this.totalWeight -= entry.weight;
    void this.options.onEvict?.(entry.value, key);
    return true;
  }

  public deleteWhere(predicate: (value: V, key: K) => boolean): void {
    for (const [key, entry] of [...this.entries]) {
      if (predicate(entry.value, key)) {
        this.delete(key);
      }
    }
  }

  public clear(): void {
    for (const key of [...this.entries.keys()]) {
      this.delete(key);
    }
  }

  private trim(): void {
    while (
      this.entries.size > this.options.maxItems
      || (this.options.maxWeight !== undefined && this.totalWeight > this.options.maxWeight)
    ) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) {
        break;
      }
      this.delete(oldest);
    }
  }
}
