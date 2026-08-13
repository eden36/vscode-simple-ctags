import type * as vscode from 'vscode';

export interface NavigatorConfig {
  readonly enabled: boolean;
  readonly tagFileNames: readonly string[];
  readonly maxResults: number;
}

export interface FileVersion {
  readonly size: number;
  readonly mtimeMs: number;
}

export interface LocatedTagFile {
  readonly uri: vscode.Uri;
  readonly version: FileVersion;
}

export type SortStatus = 'sorted' | 'unverified' | 'unsorted' | 'foldcase';

export interface TagRecord {
  readonly name: string;
  readonly file: string;
  readonly address: string;
  readonly kind?: string;
  readonly line?: number;
  readonly scope?: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly bytePosition: number;
}

export interface SymbolContext {
  readonly symbol: string;
  readonly sourceRange: vscode.Range;
  readonly qualifier?: string;
  readonly fullName?: string;
  readonly queries: readonly string[];
}

export interface ScoredTag {
  readonly record: TagRecord;
  readonly targetUri: vscode.Uri;
  readonly score: number;
}

export interface ResolvedTarget {
  readonly uri: vscode.Uri;
  readonly range: vscode.Range;
  readonly selectionRange: vscode.Range;
  readonly lineText: string;
}

export interface DefinitionLink extends vscode.LocationLink {
  readonly targetLineText: string;
}

export interface DiagnosticSnapshot {
  symbol?: string;
  qualifier?: string;
  tagFile?: string;
  sortStatus?: SortStatus;
  candidateCount: number;
  resultCount: number;
  cacheNote?: string;
  elapsedMs: number;
}
