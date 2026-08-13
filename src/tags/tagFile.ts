import { open } from 'node:fs/promises';
import type * as vscode from 'vscode';
import { BLOCK_SIZE, MAX_TAG_LINE_BYTES } from '../constants';
import type { FileVersion, SortStatus, TagRecord } from '../types';
import { parseTagLine } from './parser';

interface PhysicalLine {
  readonly start: number;
  readonly next: number;
  readonly content: Buffer;
  readonly tooLong: boolean;
}

export interface RandomAccessHandle {
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

export class BinaryTagFile {
  private handle?: RandomAccessHandle;
  private sortStatus?: SortStatus;
  private closed = false;
  public bytesRead = 0;

  public constructor(
    public readonly uri: vscode.Uri,
    public readonly version: FileVersion,
    private readonly report: (message: string) => void,
    private readonly handleFactory: () => Promise<RandomAccessHandle> = () => open(uri.fsPath, 'r')
  ) {}

  public async getSortStatus(token: vscode.CancellationToken): Promise<SortStatus> {
    if (this.sortStatus) {
      return this.sortStatus;
    }
    let position = 0;
    let inspected = 0;
    while (position < this.version.size && inspected <= MAX_TAG_LINE_BYTES) {
      throwIfCancelled(token);
      const line = await this.readLine(position, token);
      if (!line) {
        break;
      }
      inspected += line.content.length;
      const text = line.content.toString('utf8');
      if (!text.startsWith('!_TAG_')) {
        break;
      }
      if (text.startsWith('!_TAG_FILE_SORTED\t')) {
        const value = text.split('\t')[1];
        this.sortStatus = value === '1' ? 'sorted' : value === '2' ? 'foldcase' : 'unsorted';
        return this.sortStatus;
      }
      position = line.next;
    }
    this.sortStatus = 'unverified';
    return this.sortStatus;
  }

  public async query(
    symbol: string,
    maxCandidates: number,
    token: vscode.CancellationToken
  ): Promise<TagRecord[]> {
    const target = Buffer.from(symbol, 'utf8');
    let low = 0;
    let high = this.version.size;

    while (low < high) {
      throwIfCancelled(token);
      const middle = low + Math.floor((high - low) / 2);
      const line = await this.readLineAtOrAfter(middle, token);
      if (!line || line.start >= high) {
        high = middle;
        continue;
      }
      if (line.tooLong) {
        this.report(`已跳过超过 1 MiB 的 tags 记录，字节位置：${line.start}`);
      }
      const name = nameBytes(line.content);
      if (!name || Buffer.compare(name, target) < 0) {
        low = Math.max(line.next, middle + 1);
      } else {
        high = line.start;
      }
    }

    const results: TagRecord[] = [];
    let position = await this.lineStartAtOrAfter(low, token);
    while (position < this.version.size && results.length < maxCandidates) {
      throwIfCancelled(token);
      const line = await this.readLine(position, token);
      if (!line) {
        break;
      }
      position = line.next;
      if (line.tooLong) {
        this.report(`已跳过超过 1 MiB 的 tags 记录，字节位置：${line.start}`);
        continue;
      }
      const name = nameBytes(line.content);
      if (!name) {
        continue;
      }
      const comparison = Buffer.compare(name, target);
      if (comparison > 0) {
        break;
      }
      if (comparison < 0) {
        continue;
      }
      const record = parseTagLine(stripCarriageReturn(line.content).toString('utf8'), line.start);
      if (record) {
        results.push(record);
      }
    }
    return results;
  }

  public async close(): Promise<void> {
    this.closed = true;
    const handle = this.handle;
    this.handle = undefined;
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }

  private async getHandle(): Promise<RandomAccessHandle> {
    if (this.closed) {
      throw new Error('tags 文件句柄已关闭');
    }
    this.handle ??= await this.handleFactory();
    return this.handle;
  }

  private async read(position: number, length: number): Promise<Buffer> {
    const buffer = Buffer.allocUnsafe(length);
    const handle = await this.getHandle();
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    this.bytesRead += bytesRead;
    return buffer.subarray(0, bytesRead);
  }

  private async lineStartAtOrAfter(offset: number, token: vscode.CancellationToken): Promise<number> {
    if (offset <= 0) {
      return 0;
    }
    const previous = await this.read(offset - 1, 1);
    if (previous[0] === 0x0a) {
      return offset;
    }
    let position = offset;
    while (position < this.version.size) {
      throwIfCancelled(token);
      const chunk = await this.read(position, Math.min(BLOCK_SIZE, this.version.size - position));
      const newline = chunk.indexOf(0x0a);
      if (newline >= 0) {
        return position + newline + 1;
      }
      if (chunk.length === 0) {
        break;
      }
      position += chunk.length;
    }
    return this.version.size;
  }

  private async readLineAtOrAfter(offset: number, token: vscode.CancellationToken): Promise<PhysicalLine | undefined> {
    if (offset <= 0) {
      return this.readLine(0, token);
    }
    const readStart = offset - 1;
    const chunk = await this.read(readStart, Math.min(BLOCK_SIZE, this.version.size - readStart));
    if (chunk.length === 0) {
      return undefined;
    }
    const firstNewline = chunk.indexOf(0x0a);
    if (firstNewline < 0) {
      const start = await this.lineStartAtOrAfter(offset, token);
      return this.readLine(start, token);
    }
    const contentStart = firstNewline === 0 ? 1 : firstNewline + 1;
    const start = readStart + contentStart;
    if (start >= this.version.size) {
      return undefined;
    }
    const secondNewline = chunk.indexOf(0x0a, contentStart);
    if (secondNewline < 0) {
      return this.readLine(start, token);
    }
    const content = chunk.subarray(contentStart, secondNewline);
    return {
      start,
      next: readStart + secondNewline + 1,
      content,
      tooLong: content.length > MAX_TAG_LINE_BYTES
    };
  }

  private async readLine(start: number, token: vscode.CancellationToken): Promise<PhysicalLine | undefined> {
    if (start >= this.version.size) {
      return undefined;
    }
    const chunks: Buffer[] = [];
    let collected = 0;
    let position = start;
    let tooLong = false;
    while (position < this.version.size) {
      throwIfCancelled(token);
      const chunk = await this.read(position, Math.min(BLOCK_SIZE, this.version.size - position));
      if (chunk.length === 0) {
        break;
      }
      const newline = chunk.indexOf(0x0a);
      const slice = newline >= 0 ? chunk.subarray(0, newline) : chunk;
      const actualLength = position - start + slice.length;
      tooLong ||= actualLength > MAX_TAG_LINE_BYTES;
      if (collected < MAX_TAG_LINE_BYTES) {
        const remaining = MAX_TAG_LINE_BYTES - collected;
        chunks.push(slice.subarray(0, remaining));
        collected += Math.min(slice.length, remaining);
      }
      position += newline >= 0 ? newline + 1 : chunk.length;
      if (newline >= 0) {
        return { start, next: position, content: Buffer.concat(chunks), tooLong };
      }
    }
    tooLong ||= position - start > MAX_TAG_LINE_BYTES;
    return { start, next: position, content: Buffer.concat(chunks), tooLong };
  }
}

function nameBytes(line: Buffer): Buffer | undefined {
  const tab = line.indexOf(0x09);
  return tab > 0 ? line.subarray(0, tab) : undefined;
}

function stripCarriageReturn(line: Buffer): Buffer {
  return line.at(-1) === 0x0d ? line.subarray(0, -1) : line;
}

export function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    const error = new Error('操作已取消');
    error.name = 'CancellationError';
    throw error;
  }
}
