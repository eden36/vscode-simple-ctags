import * as vscode from 'vscode';
import {
  MAX_CACHE_BYTES,
  MAX_CACHE_ITEMS,
  MAX_CONCURRENT_QUERIES,
  MAX_OPEN_TAG_FILES
} from '../constants';
import { AddressResolver } from '../navigation/addressResolver';
import type { LocatedTagFile, ResolvedTarget, SortStatus, TagRecord } from '../types';
import { LruCache } from '../utils/lru';
import { Semaphore } from '../utils/semaphore';
import { fileVersion } from './locator';
import { BinaryTagFile } from './tagFile';

type CachedValue =
  | { readonly type: 'query'; readonly tagUri: string; readonly value: readonly TagRecord[] }
  | { readonly type: 'address'; readonly tagUri: string; readonly value?: ResolvedTarget };

export class UnsupportedSortError extends Error {
  public constructor(public readonly status: SortStatus) {
    super(status === 'foldcase' ? 'tags 使用 foldcase 排序，无法执行区分大小写的二分查询。' : 'tags 未排序，无法执行二分查询。');
  }
}

export class VersionChangedError extends Error {
  public constructor() {
    super('tags 文件在查询过程中发生变化，本次结果已作废。');
  }
}

export class TagService implements vscode.Disposable {
  private readonly closing = new Set<Promise<void>>();
  private readonly files = new LruCache<string, BinaryTagFile>({
    maxItems: MAX_OPEN_TAG_FILES,
    onEvict: (file) => {
      const closing = file.close();
      this.closing.add(closing);
      void closing.finally(() => this.closing.delete(closing));
    }
  });
  private readonly cache = new LruCache<string, CachedValue>({
    maxItems: MAX_CACHE_ITEMS,
    maxWeight: MAX_CACHE_BYTES,
    weight: (entry) => estimateWeight(entry)
  });
  private readonly semaphore = new Semaphore(MAX_CONCURRENT_QUERIES);
  private readonly resolver = new AddressResolver();

  public constructor(private readonly report: (message: string) => void) {}

  public async withPermit<T>(token: vscode.CancellationToken, action: () => Promise<T>): Promise<T> {
    const release = await this.semaphore.acquire(token);
    try {
      return await action();
    } finally {
      release();
    }
  }

  public async sortStatus(located: LocatedTagFile, token: vscode.CancellationToken): Promise<SortStatus> {
    return this.getFile(located).getSortStatus(token);
  }

  public async query(
    located: LocatedTagFile,
    symbol: string,
    maxCandidates: number,
    token: vscode.CancellationToken
  ): Promise<readonly TagRecord[]> {
    const status = await this.sortStatus(located, token);
    if (status === 'unsorted' || status === 'foldcase') {
      throw new UnsupportedSortError(status);
    }
    const tagUri = located.uri.toString();
    const version = versionKey(located);
    const key = `q\0${tagUri}\0${version}\0${symbol}\0${maxCandidates}`;
    const cached = this.cache.get(key);
    if (cached?.type === 'query') {
      return cached.value;
    }
    const file = this.getFile(located);
    const records = await file.query(symbol, maxCandidates, token);
    await this.ensureUnchanged(located);
    this.cache.set(key, { type: 'query', tagUri, value: records });
    return records;
  }

  // 同一目标文件的候选一起解析，未命中缓存的部分只触发一次文件扫描。
  public async resolveGroup(
    located: LocatedTagFile,
    targetUri: vscode.Uri,
    records: readonly TagRecord[],
    symbol: string,
    token: vscode.CancellationToken
  ): Promise<Map<number, ResolvedTarget | undefined>> {
    const results = new Map<number, ResolvedTarget | undefined>();
    const targetVersion = await fileVersion(targetUri);
    if (!targetVersion) {
      return results;
    }
    const tagUri = located.uri.toString();
    const pending: Array<{ readonly record: TagRecord; readonly key: string }> = [];
    for (const record of records) {
      const key = [
        'a', tagUri, versionKey(located), targetUri.toString(),
        targetVersion.size, targetVersion.mtimeMs, record.bytePosition, symbol
      ].join('\0');
      const cached = this.cache.get(key);
      if (cached?.type === 'address') {
        results.set(record.bytePosition, cached.value);
      } else {
        pending.push({ record, key });
      }
    }
    if (pending.length === 0) {
      return results;
    }
    const resolved = await this.resolver.resolveBatch(
      pending.map((item) => item.record),
      targetUri,
      symbol,
      token
    );
    for (const { record, key } of pending) {
      const value = resolved.get(record.bytePosition);
      results.set(record.bytePosition, value);
      this.cache.set(key, { type: 'address', tagUri, value });
    }
    return results;
  }

  public clear(): void {
    this.cache.clear();
    this.files.clear();
  }

  public invalidateTagUri(uri: vscode.Uri): void {
    const key = uri.toString();
    this.files.delete(key);
    this.cache.deleteWhere((entry) => entry.tagUri === key);
  }

  public dispose(): void {
    this.clear();
  }

  public async shutdown(): Promise<void> {
    this.clear();
    await Promise.allSettled([...this.closing]);
  }

  private getFile(located: LocatedTagFile): BinaryTagFile {
    const key = located.uri.toString();
    const existing = this.files.get(key);
    if (existing && sameVersion(existing.version, located.version)) {
      return existing;
    }
    if (existing) {
      this.invalidateTagUri(located.uri);
    }
    const file = new BinaryTagFile(located.uri, located.version, this.report);
    this.files.set(key, file);
    return file;
  }

  private async ensureUnchanged(located: LocatedTagFile): Promise<void> {
    const current = await fileVersion(located.uri);
    if (!current || !sameVersion(current, located.version)) {
      this.invalidateTagUri(located.uri);
      throw new VersionChangedError();
    }
  }
}

// 估算缓存条目字节数，避免为计重反复序列化整个结果集。
function estimateWeight(entry: CachedValue): number {
  if (entry.type === 'address') {
    return 256 + textWeight(entry.value?.lineText) + textWeight(entry.value?.uri.toString());
  }
  let total = 128;
  for (const record of entry.value) {
    total += 128 + textWeight(record.name) + textWeight(record.file) + textWeight(record.address);
    for (const [key, value] of Object.entries(record.fields)) {
      total += 16 + textWeight(key) + textWeight(value);
    }
  }
  return total;
}

function textWeight(value: string | undefined): number {
  return value === undefined ? 0 : value.length * 2;
}

function versionKey(file: LocatedTagFile): string {
  return `${file.version.size}:${file.version.mtimeMs}`;
}

function sameVersion(left: { size: number; mtimeMs: number }, right: { size: number; mtimeMs: number }): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}
