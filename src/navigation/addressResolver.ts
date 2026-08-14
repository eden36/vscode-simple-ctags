import * as path from 'node:path';
import { open } from 'node:fs/promises';
import * as vscode from 'vscode';
import { BLOCK_SIZE, MAX_READ_LINE_BYTES, MAX_TARGET_SCAN_BYTES } from '../constants';
import type { ResolvedTarget, TagRecord } from '../types';
import { throwIfCancelled } from '../tags/tagFile';
import { decodeSearchPattern } from './pattern';

interface ScannedLine {
  readonly text: string;
  readonly truncated: boolean;
}

interface ParsedAddress {
  readonly record: TagRecord;
  readonly line?: number;
  readonly pattern?: string;
}

interface ScanResult {
  readonly lines: Map<number, ScannedLine>;
  readonly patternLines: Map<string, number>;
}

export class AddressResolver {
  public async resolve(
    record: TagRecord,
    targetUri: vscode.Uri,
    symbol: string,
    token: vscode.CancellationToken
  ): Promise<ResolvedTarget | undefined> {
    const resolved = await this.resolveBatch([record], targetUri, symbol, token);
    return resolved.get(record.bytePosition);
  }

  // 同一目标文件的候选合并成一次顺序扫描，避免每个候选各自从文件头重扫一遍。
  public async resolveBatch(
    records: readonly TagRecord[],
    targetUri: vscode.Uri,
    symbol: string,
    token: vscode.CancellationToken
  ): Promise<Map<number, ResolvedTarget | undefined>> {
    const results = new Map<number, ResolvedTarget | undefined>();
    if (records.length === 0) {
      return results;
    }

    const wantedLines = new Set<number>();
    const patterns = new Set<string>();
    const parsed = records.map((record) => {
      const lineNumber = record.line ?? numericAddress(record.address);
      const line = lineNumber === undefined ? undefined : Math.max(0, lineNumber - 1);
      const pattern = decodeSearchPattern(record.address);
      if (line !== undefined) {
        wantedLines.add(line);
      }
      if (pattern) {
        patterns.add(pattern);
      }
      return { record, line, pattern };
    });

    const scan = await scanLines(targetUri, wantedLines, patterns, token);
    for (const item of parsed) {
      results.set(item.record.bytePosition, buildTarget(item, targetUri, symbol, scan));
    }
    return results;
  }
}

export function resolveTargetUri(tagFileUri: vscode.Uri, file: string): vscode.Uri {
  const tagDirectory = vscode.Uri.joinPath(tagFileUri, '..');
  if (path.isAbsolute(file) || /^[A-Za-z]:[\\/]/.test(file)) {
    if (tagFileUri.scheme === 'file') {
      return vscode.Uri.file(path.resolve(file));
    }
    let uriPath = file.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(uriPath)) {
      uriPath = `/${uriPath}`;
    }
    return vscode.Uri.from({
      scheme: tagFileUri.scheme,
      authority: tagFileUri.authority,
      path: uriPath
    });
  }
  return vscode.Uri.joinPath(tagDirectory, ...file.split(/[\\/]+/));
}

function buildTarget(
  parsed: ParsedAddress,
  targetUri: vscode.Uri,
  symbol: string,
  scan: ScanResult
): ResolvedTarget | undefined {
  const { line, pattern } = parsed;
  if (line !== undefined) {
    const actual = scan.lines.get(line);
    // 行内容与搜索地址不一致说明 tags 已过期，改用搜索地址重新定位；
    // 被截断的超长行无法逐字比较，仍按行号定位。
    if (pattern === undefined || actual?.truncated || actual?.text === pattern) {
      const lineText = actual?.text ?? pattern ?? '';
      return target(targetUri, line, Math.max(0, lineText.indexOf(symbol)), symbol.length, lineText);
    }
  }
  if (!pattern) {
    return undefined;
  }
  const foundLine = scan.patternLines.get(pattern);
  if (foundLine === undefined) {
    return undefined;
  }
  return target(targetUri, foundLine, Math.max(0, pattern.indexOf(symbol)), symbol.length, pattern);
}

// 一次顺序读取回答两类问题：指定行号的行内容，以及每个搜索地址首次出现的行号。
async function scanLines(
  uri: vscode.Uri,
  wantedLines: ReadonlySet<number>,
  patterns: ReadonlySet<string>,
  token: vscode.CancellationToken
): Promise<ScanResult> {
  const lines = new Map<number, ScannedLine>();
  const patternLines = new Map<string, number>();
  if (wantedLines.size === 0 && patterns.size === 0) {
    return { lines, patternLines };
  }

  const pendingPatterns = new Set(patterns);
  let maxPatternBytes = 0;
  for (const pattern of patterns) {
    maxPatternBytes = Math.max(maxPatternBytes, Buffer.byteLength(pattern, 'utf8'));
  }
  const maxWantedLine = wantedLines.size > 0 ? Math.max(...wantedLines) : -1;

  const handle = await open(uri.fsPath, 'r');
  const buffer = Buffer.allocUnsafe(BLOCK_SIZE);
  const chunks: Buffer[] = [];
  let collected = 0;
  let lineBytes = 0;
  let line = 0;
  let position = 0;
  let pendingWanted = wantedLines.size;

  const finishLine = (): boolean => {
    const isWanted = wantedLines.has(line);
    const truncated = lineBytes > collected;
    // 比最长搜索地址还长的行不可能匹配，跳过解码；+1 是给 CRLF 行尾可能残留的 \r 留位。
    const canMatch = !truncated && pendingPatterns.size > 0 && lineBytes <= maxPatternBytes + 1;
    if (isWanted || canMatch) {
      const text = stripCarriageReturn(Buffer.concat(chunks, collected)).toString('utf8');
      if (isWanted) {
        lines.set(line, { text, truncated });
        pendingWanted -= 1;
      }
      if (canMatch && pendingPatterns.has(text)) {
        patternLines.set(text, line);
        pendingPatterns.delete(text);
      }
    }
    line += 1;
    chunks.length = 0;
    collected = 0;
    lineBytes = 0;
    return pendingWanted <= 0 && pendingPatterns.size === 0 && line > maxWantedLine;
  };

  // slice 是读缓冲区的视图，下一次 read 会覆写它；只有跨块残留的片段需要复制留存。
  const append = (slice: Buffer, copy: boolean): void => {
    lineBytes += slice.length;
    if (collected < MAX_READ_LINE_BYTES) {
      const remaining = MAX_READ_LINE_BYTES - collected;
      const kept = slice.length <= remaining ? slice : slice.subarray(0, remaining);
      chunks.push(copy ? Buffer.from(kept) : kept);
      collected += kept.length;
    }
  };

  let reachedEof = false;
  try {
    while (position < MAX_TARGET_SCAN_BYTES) {
      throwIfCancelled(token);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(BLOCK_SIZE, MAX_TARGET_SCAN_BYTES - position),
        position
      );
      if (bytesRead === 0) {
        reachedEof = true;
        break;
      }
      position += bytesRead;
      const view = buffer.subarray(0, bytesRead);
      let start = 0;
      while (start < bytesRead) {
        const newline = view.indexOf(0x0a, start);
        if (newline < 0) {
          append(view.subarray(start), true);
          break;
        }
        append(view.subarray(start, newline), false);
        if (finishLine()) {
          return { lines, patternLines };
        }
        start = newline + 1;
      }
    }
    // 只有确实读到文件末尾，残留片段才是完整的最后一行；
    // 因扫描上限中止时它只是半行，当成整行会得出错误的行内容与匹配结果。
    if (reachedEof && lineBytes > 0) {
      finishLine();
    }
    return { lines, patternLines };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function stripCarriageReturn(line: Buffer): Buffer {
  return line.at(-1) === 0x0d ? line.subarray(0, -1) : line;
}

function numericAddress(address: string): number | undefined {
  if (!/^\d+$/.test(address)) {
    return undefined;
  }
  const value = Number.parseInt(address, 10);
  return value > 0 ? value : undefined;
}

function target(
  uri: vscode.Uri,
  line: number,
  column: number,
  symbolLength: number,
  lineText: string
): ResolvedTarget {
  const start = new vscode.Position(line, column);
  return {
    uri,
    range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, Number.MAX_SAFE_INTEGER)),
    selectionRange: new vscode.Range(start, start.translate(0, symbolLength)),
    lineText
  };
}
