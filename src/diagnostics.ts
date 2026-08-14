import * as vscode from 'vscode';
import { MAX_PENDING_MESSAGES } from './constants';
import type { DiagnosticSnapshot } from './types';

export class Diagnostics implements vscode.Disposable {
  private channel?: vscode.OutputChannel;
  private readonly pending: string[] = [];

  public report(message: string): void {
    const formatted = `[${new Date().toISOString()}] ${message}`;
    if (this.channel) {
      this.channel.appendLine(formatted);
      return;
    }
    this.pending.push(formatted);
    if (this.pending.length > MAX_PENDING_MESSAGES) {
      this.pending.shift();
    }
  }

  public showSnapshot(snapshot: DiagnosticSnapshot): void {
    const channel = this.getChannel();
    channel.appendLine('');
    channel.appendLine('=== 当前符号诊断 ===');
    channel.appendLine(`启用状态：${snapshot.enabled === false ? '已禁用' : '已启用'}`);
    channel.appendLine(`符号：${snapshot.symbol ?? '无'}`);
    channel.appendLine(`限定上下文：${snapshot.qualifier ?? '无'}`);
    channel.appendLine(`tags 文件：${snapshot.tagFile ?? '未找到'}`);
    channel.appendLine(`排序状态：${snapshot.sortStatus ?? '未知'}`);
    channel.appendLine(`候选数量：${snapshot.candidateCount}`);
    channel.appendLine(`结果数量：${snapshot.resultCount}`);
    if (snapshot.cacheNote) {
      channel.appendLine(`缓存/淘汰：${snapshot.cacheNote}`);
    }
    channel.appendLine(`耗时：${snapshot.elapsedMs.toFixed(2)} ms`);
    channel.show(true);
  }

  public dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
    this.pending.length = 0;
  }

  private getChannel(): vscode.OutputChannel {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel('Ctags Navigator Lite');
      for (const message of this.pending) {
        this.channel.appendLine(message);
      }
      this.pending.length = 0;
    }
    return this.channel;
  }
}
