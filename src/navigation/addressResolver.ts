import * as path from 'node:path';
import { open } from 'node:fs/promises';
import * as vscode from 'vscode';
import { BLOCK_SIZE, MAX_TARGET_SCAN_BYTES } from '../constants';
import type { ResolvedTarget, TagRecord } from '../types';
import { throwIfCancelled } from '../tags/tagFile';
import { decodeSearchPattern } from './pattern';

export class AddressResolver {
  public async resolve(
    record: TagRecord,
    targetUri: vscode.Uri,
    symbol: string,
    token: vscode.CancellationToken
  ): Promise<ResolvedTarget | undefined> {
    const lineNumber = record.line ?? numericAddress(record.address);
    const pattern = decodeSearchPattern(record.address);
    if (lineNumber !== undefined) {
      const line = Math.max(0, lineNumber - 1);
      const column = pattern ? Math.max(0, pattern.indexOf(symbol)) : 0;
      const lineText = pattern ?? await readLine(targetUri, line, token);
      return target(targetUri, line, column, symbol.length, lineText ?? '');
    }
    if (!pattern) {
      return undefined;
    }
    const foundLine = await findExactLine(targetUri, pattern, token);
    if (foundLine === undefined) {
      return undefined;
    }
    return target(targetUri, foundLine, Math.max(0, pattern.indexOf(symbol)), symbol.length, pattern);
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

async function findExactLine(
  uri: vscode.Uri,
  expected: string,
  token: vscode.CancellationToken
): Promise<number | undefined> {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const handle = await open(uri.fsPath, 'r');
  let position = 0;
  let line = 0;
  let index = 0;
  let matches = true;
  let pendingCarriageReturn = false;
  try {
    while (position < MAX_TARGET_SCAN_BYTES) {
      throwIfCancelled(token);
      const buffer = Buffer.allocUnsafe(BLOCK_SIZE);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(BLOCK_SIZE, MAX_TARGET_SCAN_BYTES - position),
        position
      );
      if (bytesRead === 0) {
        if (pendingCarriageReturn) {
          ({ index, matches } = compareByte(0x0d, expectedBytes, index, matches));
        }
        return matches && index === expectedBytes.length ? line : undefined;
      }
      position += bytesRead;
      for (let offset = 0; offset < bytesRead; offset += 1) {
        const byte = buffer[offset];
        if (byte === 0x0a) {
          if (matches && index === expectedBytes.length) {
            return line;
          }
          line += 1;
          index = 0;
          matches = true;
          pendingCarriageReturn = false;
          continue;
        }
        if (pendingCarriageReturn) {
          ({ index, matches } = compareByte(0x0d, expectedBytes, index, matches));
          pendingCarriageReturn = false;
        }
        if (byte === 0x0d) {
          pendingCarriageReturn = true;
        } else {
          ({ index, matches } = compareByte(byte, expectedBytes, index, matches));
        }
      }
    }
    return undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readLine(
  uri: vscode.Uri,
  targetLine: number,
  token: vscode.CancellationToken
): Promise<string | undefined> {
  const handle = await open(uri.fsPath, 'r');
  const bytes: number[] = [];
  let position = 0;
  let line = 0;
  try {
    while (position < MAX_TARGET_SCAN_BYTES) {
      throwIfCancelled(token);
      const buffer = Buffer.allocUnsafe(BLOCK_SIZE);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(BLOCK_SIZE, MAX_TARGET_SCAN_BYTES - position),
        position
      );
      if (bytesRead === 0) {
        return line === targetLine ? Buffer.from(bytes).toString('utf8').replace(/\r$/, '') : undefined;
      }
      position += bytesRead;
      for (let offset = 0; offset < bytesRead; offset += 1) {
        const byte = buffer[offset];
        if (byte === 0x0a) {
          if (line === targetLine) {
            return Buffer.from(bytes).toString('utf8').replace(/\r$/, '');
          }
          line += 1;
          if (line > targetLine) {
            return undefined;
          }
          continue;
        }
        if (line === targetLine && bytes.length < BLOCK_SIZE) {
          bytes.push(byte);
        }
      }
    }
    return line === targetLine ? Buffer.from(bytes).toString('utf8').replace(/\r$/, '') : undefined;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function compareByte(
  byte: number,
  expected: Buffer,
  index: number,
  matches: boolean
): { index: number; matches: boolean } {
  return {
    index: index + 1,
    matches: matches && index < expected.length && expected[index] === byte
  };
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
