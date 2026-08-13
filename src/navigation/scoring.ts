import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { SymbolContext, TagRecord } from '../types';

export function normalizeScope(value: string): string {
  return value
    .split(/::|->|[.#/\\]/)
    .filter(Boolean)
    .join('::');
}

export function scoreCandidate(
  record: TagRecord,
  targetUri: vscode.Uri,
  sourceUri: vscode.Uri,
  context: SymbolContext,
  matchedQueries: ReadonlySet<string>
): number {
  let score = context.fullName && matchedQueries.has(context.fullName) ? 1000 : 0;
  if (context.qualifier && record.scope) {
    const scope = normalizeScope(record.scope);
    const qualifier = normalizeScope(context.qualifier);
    if (scope === qualifier) {
      score += 400;
    } else if (scope.endsWith(`::${qualifier}`) || qualifier.endsWith(`::${scope}`)) {
      score += 250;
    }
  }

  if (sameUri(targetUri, sourceUri)) {
    score += 80;
  } else if (sameUriDirectory(targetUri, sourceUri)) {
    score += 40;
  }
  score += Math.max(0, 30 - pathDistance(path.dirname(sourceUri.fsPath), path.dirname(targetUri.fsPath)) * 5);
  return score;
}

export function pathDistance(leftDirectory: string, rightDirectory: string): number {
  const left = path.resolve(leftDirectory).split(path.sep).filter(Boolean);
  const right = path.resolve(rightDirectory).split(path.sep).filter(Boolean);
  let shared = 0;
  while (shared < left.length && shared < right.length) {
    const a = process.platform === 'win32' ? left[shared].toLowerCase() : left[shared];
    const b = process.platform === 'win32' ? right[shared].toLowerCase() : right[shared];
    if (a !== b) {
      break;
    }
    shared += 1;
  }
  return left.length - shared + right.length - shared;
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.scheme === right.scheme
    && left.authority === right.authority
    && normalizePath(left.fsPath) === normalizePath(right.fsPath);
}

function sameUriDirectory(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.scheme === right.scheme
    && left.authority === right.authority
    && normalizePath(path.dirname(left.fsPath)) === normalizePath(path.dirname(right.fsPath));
}

function normalizePath(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
