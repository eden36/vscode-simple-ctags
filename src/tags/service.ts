import * as vscode from 'vscode';
import {
  MAX_CACHE_BYTES,
  MAX_CACHE_ITEMS,
  MAX_CONCURRENT_QUERIES,
  MAX_OPEN_TAG_FILES
} from '../constants';
import { AddressResolver, resolveTargetUri } from '../navigation/addressResolver';
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
    weight: (entry) => Buffer.byteLength(JSON.stringify(entry.value), 'utf8') + 128
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
    return (await this.getFile(located)).getSortStatus(token);
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
    const file = await this.getFile(located);
    const records = await file.query(symbol, maxCandidates, token);
    await this.ensureUnchanged(located);
    this.cache.set(key, { type: 'query', tagUri, value: records });
    return records;
  }

  public async resolve(
    located: LocatedTagFile,
    record: TagRecord,
    symbol: string,
    token: vscode.CancellationToken
  ): Promise<ResolvedTarget | undefined> {
    const targetUri = resolveTargetUri(located.uri, record.file);
    const targetVersion = await fileVersion(targetUri);
    if (!targetVersion) {
      return undefined;
    }
    const tagUri = located.uri.toString();
    const key = [
      'a', tagUri, versionKey(located), targetUri.toString(),
      targetVersion.size, targetVersion.mtimeMs, record.bytePosition, symbol
    ].join('\0');
    const cached = this.cache.get(key);
    if (cached?.type === 'address') {
      return cached.value;
    }
    const resolved = await this.resolver.resolve(record, targetUri, symbol, token);
    this.cache.set(key, { type: 'address', tagUri, value: resolved });
    return resolved;
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

  private async getFile(located: LocatedTagFile): Promise<BinaryTagFile> {
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

function versionKey(file: LocatedTagFile): string {
  return `${file.version.size}:${file.version.mtimeMs}`;
}

function sameVersion(left: { size: number; mtimeMs: number }, right: { size: number; mtimeMs: number }): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}
