import * as vscode from 'vscode';
import { readConfig } from '../config';
import type { DefinitionLink, DiagnosticSnapshot, LocatedTagFile, ScoredTag, SymbolContext, TagRecord } from '../types';
import { Diagnostics } from '../diagnostics';
import { TagFileLocator } from '../tags/locator';
import { TagService, UnsupportedSortError, VersionChangedError } from '../tags/service';
import { resolveTargetUri } from './addressResolver';
import { extractSymbolContext } from './context';
import { scoreCandidate } from './scoring';

interface MergedRecord {
  readonly record: TagRecord;
  readonly queries: Set<string>;
}

export class CtagsDefinitionProvider implements vscode.DefinitionProvider, vscode.Disposable {
  private readonly locator = new TagFileLocator();
  private readonly service: TagService;
  private readonly warnedVersions = new Set<string>();

  public constructor(private readonly diagnostics: Diagnostics) {
    this.service = new TagService((message) => diagnostics.report(message));
  }

  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<DefinitionLink[] | undefined> {
    const result = await this.run(document, position, token, false);
    return result.links.length > 0 ? result.links : undefined;
  }

  public async diagnose(document: vscode.TextDocument, position: vscode.Position): Promise<void> {
    const started = performance.now();
    const source = new vscode.CancellationTokenSource();
    try {
      const result = await this.run(document, position, source.token, true);
      this.diagnostics.showSnapshot({
        ...result.snapshot,
        elapsedMs: performance.now() - started
      });
    } finally {
      source.dispose();
    }
  }

  public clear(): void {
    this.locator.clear();
    this.service.clear();
    this.warnedVersions.clear();
  }

  public dispose(): void {
    this.clear();
    this.service.dispose();
  }

  public async shutdown(): Promise<void> {
    this.locator.clear();
    this.warnedVersions.clear();
    await this.service.shutdown();
  }

  private async run(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    diagnostic: boolean
  ): Promise<{ links: DefinitionLink[]; snapshot: DiagnosticSnapshot }> {
    const snapshot: DiagnosticSnapshot = { candidateCount: 0, resultCount: 0, elapsedMs: 0 };
    const config = readConfig((message) => this.diagnostics.report(message));
    if (!config.enabled || (document.uri.scheme !== 'file' && document.uri.scheme !== 'vscode-remote')) {
      return { links: [], snapshot };
    }
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const context = extractSymbolContext(document, position);
    if (!folder || !context) {
      return { links: [], snapshot };
    }
    snapshot.symbol = context.symbol;
    snapshot.qualifier = context.qualifier;

    try {
      return await this.service.withPermit(token, async () => {
        const located = await this.locator.locate(document.uri, folder, config.tagFileNames);
        if (!located) {
          return { links: [], snapshot };
        }
        snapshot.tagFile = located.uri.toString();
        snapshot.sortStatus = await this.service.sortStatus(located, token);
        if (snapshot.sortStatus === 'unsorted' || snapshot.sortStatus === 'foldcase') {
          const message = snapshot.sortStatus === 'foldcase'
            ? 'tags 使用 foldcase 排序，无法执行区分大小写的二分查询。'
            : 'tags 未排序，无法执行二分查询。';
          this.warnOnce(
            `${located.uri.toString()}:${located.version.size}:${located.version.mtimeMs}`,
            message
          );
          return { links: [], snapshot };
        }
        if (snapshot.sortStatus === 'unverified') {
          this.diagnostics.report(`tags 未声明排序状态，按区分大小写排序处理：${located.uri.toString()}`);
        }
        const merged = await this.queryAll(located, context, config.maxResults, token);
        snapshot.candidateCount = merged.length;
        const scored = this.scoreAndSort(merged, located, document.uri, context);
        const links = await this.resolveLinks(scored, located, context, config.maxResults, token);
        snapshot.resultCount = links.length;
        return { links, snapshot };
      });
    } catch (error) {
      if (token.isCancellationRequested || (error instanceof Error && error.name === 'CancellationError')) {
        return { links: [], snapshot };
      }
      if (error instanceof UnsupportedSortError) {
        snapshot.sortStatus = error.status;
        this.warnOnce(snapshot.tagFile, error.message);
      } else if (error instanceof VersionChangedError) {
        this.diagnostics.report(error.message);
      } else {
        this.diagnostics.report(`定义查询失败：${error instanceof Error ? error.message : String(error)}`);
      }
      if (diagnostic) {
        snapshot.cacheNote = error instanceof Error ? error.message : String(error);
      }
      return { links: [], snapshot };
    }
  }

  private async queryAll(
    located: LocatedTagFile,
    context: SymbolContext,
    maxResults: number,
    token: vscode.CancellationToken
  ): Promise<MergedRecord[]> {
    const merged = new Map<string, MergedRecord>();
    for (const query of context.queries) {
      const records = await this.service.query(located, query, maxResults * 4, token);
      for (const record of records) {
        const key = `${record.file}\0${record.address}\0${record.line ?? ''}\0${record.bytePosition}`;
        const existing = merged.get(key);
        if (existing) {
          existing.queries.add(query);
        } else {
          merged.set(key, { record, queries: new Set([query]) });
        }
      }
    }
    return [...merged.values()];
  }

  private scoreAndSort(
    merged: readonly MergedRecord[],
    located: LocatedTagFile,
    sourceUri: vscode.Uri,
    context: SymbolContext
  ): ScoredTag[] {
    return merged.map(({ record, queries }) => {
      const targetUri = resolveTargetUri(located.uri, record.file);
      return {
        record,
        targetUri,
        score: scoreCandidate(record, targetUri, sourceUri, context, queries)
      };
    }).sort((left, right) => right.score - left.score || left.record.bytePosition - right.record.bytePosition);
  }

  private async resolveLinks(
    candidates: readonly ScoredTag[],
    located: LocatedTagFile,
    context: SymbolContext,
    maxResults: number,
    token: vscode.CancellationToken
  ): Promise<DefinitionLink[]> {
    const links: DefinitionLink[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (links.length >= maxResults || token.isCancellationRequested) {
        break;
      }
      const resolved = await this.service.resolve(located, candidate.record, context.symbol, token);
      if (!resolved) {
        continue;
      }
      const key = `${resolved.uri.toString()}\0${resolved.selectionRange.start.line}\0${resolved.selectionRange.start.character}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      links.push({
        originSelectionRange: context.sourceRange,
        targetUri: resolved.uri,
        targetRange: resolved.range,
        targetSelectionRange: resolved.selectionRange,
        targetLineText: resolved.lineText
      });
    }
    return links;
  }

  private warnOnce(versionKey: string | undefined, message: string): void {
    const key = `${versionKey ?? 'unknown'}\0${message}`;
    if (this.warnedVersions.has(key)) {
      return;
    }
    this.warnedVersions.add(key);
    this.diagnostics.report(message);
    void vscode.window.showWarningMessage(`Ctags Navigator Lite：${message}`);
  }
}
