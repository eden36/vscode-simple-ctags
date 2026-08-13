import * as vscode from 'vscode';
import type { SymbolContext } from '../types';

const SEGMENT = '[\\p{L}\\p{N}_$-]+';
const SEPARATOR = '(?:::|->|[.#/\\\\])';
const QUALIFIED_SUFFIX = new RegExp(`((?:${SEGMENT}${SEPARATOR})+)$`, 'u');
const PARTS = new RegExp(`(${SEGMENT})(${SEPARATOR})`, 'gu');

export function extractSymbolContext(
  document: vscode.TextDocument,
  position: vscode.Position
): SymbolContext | undefined {
  const sourceRange = document.getWordRangeAtPosition(position);
  if (!sourceRange || sourceRange.start.line !== sourceRange.end.line) {
    return undefined;
  }
  const symbol = document.getText(sourceRange);
  if (!symbol) {
    return undefined;
  }

  const line = document.lineAt(position.line).text;
  const prefixStart = Math.max(0, sourceRange.start.character - 256);
  const prefix = line.slice(prefixStart, sourceRange.start.character);
  const match = QUALIFIED_SUFFIX.exec(prefix);
  if (!match) {
    return { symbol, sourceRange, queries: [symbol] };
  }

  const parsed = [...match[1].matchAll(PARTS)].map((item) => ({
    segment: item[1],
    separator: item[2]
  }));
  const retained = parsed.slice(-3);
  if (retained.length === 0) {
    return { symbol, sourceRange, queries: [symbol] };
  }
  const qualifier = retained.map((part) => part.segment).join('::');
  const fullName = retained.map((part) => `${part.segment}${part.separator}`).join('') + symbol;
  const queries = distinct([
    fullName,
    `${qualifier}::${symbol}`,
    `${qualifier}.${symbol}`,
    symbol
  ]);
  return { symbol, sourceRange, qualifier, fullName, queries };
}

function distinct(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, 4);
}
