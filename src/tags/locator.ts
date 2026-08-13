import * as path from 'node:path';
import { stat } from 'node:fs/promises';
import * as vscode from 'vscode';
import { MAX_LOCATOR_CACHE_ITEMS, NEGATIVE_CACHE_TTL_MS } from '../constants';
import type { FileVersion, LocatedTagFile } from '../types';
import { LruCache } from '../utils/lru';

interface LocatorEntry {
  readonly expiresAt?: number;
  readonly uri?: vscode.Uri;
}

export class TagFileLocator {
  private readonly cache = new LruCache<string, LocatorEntry>({
    maxItems: MAX_LOCATOR_CACHE_ITEMS
  });

  public async locate(
    documentUri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
    names: readonly string[]
  ): Promise<LocatedTagFile | undefined> {
    const directory = vscode.Uri.joinPath(documentUri, '..');
    const key = `${folder.uri.toString()}\0${directory.toString()}\0${names.join('\0')}`;
    const cached = this.cache.get(key);
    if (cached?.uri) {
      const version = await fileVersion(cached.uri);
      if (version) {
        return { uri: cached.uri, version };
      }
      this.cache.delete(key);
    } else if (cached?.expiresAt && cached.expiresAt > Date.now()) {
      return undefined;
    }

    let current = directory;
    while (isWithinFolder(current, folder.uri)) {
      for (const name of names) {
        const candidate = vscode.Uri.joinPath(current, name);
        const version = await fileVersion(candidate);
        if (version) {
          this.cache.set(key, { uri: candidate });
          return { uri: candidate, version };
        }
      }
      if (sameUriPath(current, folder.uri)) {
        break;
      }
      const parent = vscode.Uri.joinPath(current, '..');
      if (sameUriPath(parent, current)) {
        break;
      }
      current = parent;
    }

    this.cache.set(key, { expiresAt: Date.now() + NEGATIVE_CACHE_TTL_MS });
    return undefined;
  }

  public clear(): void {
    this.cache.clear();
  }
}

export async function fileVersion(uri: vscode.Uri): Promise<FileVersion | undefined> {
  try {
    const result = await stat(uri.fsPath);
    return result.isFile() ? { size: result.size, mtimeMs: result.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

function sameUriPath(left: vscode.Uri, right: vscode.Uri): boolean {
  if (left.scheme !== right.scheme || left.authority !== right.authority) {
    return false;
  }
  const normalize = process.platform === 'win32'
    ? (value: string) => path.normalize(value).toLowerCase()
    : path.normalize;
  return normalize(left.fsPath) === normalize(right.fsPath);
}

function isWithinFolder(candidate: vscode.Uri, folder: vscode.Uri): boolean {
  if (candidate.scheme !== folder.scheme || candidate.authority !== folder.authority) {
    return false;
  }
  const relative = path.relative(folder.fsPath, candidate.fsPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
