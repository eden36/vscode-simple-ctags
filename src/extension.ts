import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { readConfig } from './config';
import { CTAGS_MAX_BUFFER_BYTES, CTAGS_TIMEOUT_MS } from './constants';
import { Diagnostics } from './diagnostics';
import type { DefinitionLink } from './types';
import { CtagsDefinitionProvider } from './navigation/provider';

interface DefinitionQuickPickItem extends vscode.QuickPickItem {
  readonly link: DefinitionLink;
}

// 这些目录几乎不含需要跳转的定义，全量索引会显著拖慢生成并污染候选排序。
const CTAGS_EXCLUDES = ['.git', 'node_modules', 'dist', 'out', 'build', 'target', '.vscode-test'] as const;

let activeProvider: CtagsDefinitionProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new Diagnostics();
  const provider = new CtagsDefinitionProvider(diagnostics);
  let isGeneratingTags = false;
  activeProvider = provider;
  context.subscriptions.push(
    diagnostics,
    provider,
    vscode.commands.registerCommand('ctagsNavigator.goToDefinition', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const source = new vscode.CancellationTokenSource();
      try {
        const links = await provider.provideDefinition(editor.document, editor.selection.active, source.token);
        if (!links || links.length === 0) {
          void vscode.window.showInformationMessage('Ctags Navigator Lite：未找到当前符号的定义。');
          return;
        }
        let link = links[0];
        if (links.length > 1) {
          const selected = await vscode.window.showQuickPick<DefinitionQuickPickItem>(
            links.map((candidate) => ({
              label: `${vscode.workspace.asRelativePath(candidate.targetUri, false)}:${
                (candidate.targetSelectionRange ?? candidate.targetRange).start.line + 1
              }`,
              detail: candidate.targetLineText.trim(),
              link: candidate
            })),
            {
              matchOnDetail: true,
              placeHolder: `找到 ${links.length} 个定义，请选择跳转目标。`
            }
          );
          if (!selected) {
            return;
          }
          link = selected.link;
        }
        if (link) {
          await vscode.window.showTextDocument(link.targetUri, {
            selection: link.targetSelectionRange ?? link.targetRange
          });
        }
      } finally {
        source.dispose();
      }
    }),
    vscode.commands.registerCommand('ctagsNavigator.clearCache', () => {
      provider.clear();
      diagnostics.report('缓存已清理，tags 文件句柄已关闭。');
    }),
    vscode.commands.registerCommand('ctagsNavigator.diagnoseCurrentSymbol', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        diagnostics.showSnapshot({ candidateCount: 0, resultCount: 0, elapsedMs: 0 });
        return;
      }
      await provider.diagnose(editor.document, editor.selection.active);
    }),
    vscode.commands.registerCommand('ctagsNavigator.generateTags', async () => {
      if (isGeneratingTags) {
        void vscode.window.showInformationMessage('Ctags Navigator Lite：正在生成 tags 文件，请等待本次生成结束。');
        return;
      }
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('当前工作区未受信任，无法生成 tags 文件。');
        return;
      }

      const folders = vscode.workspace.workspaceFolders;
      let folder = vscode.window.activeTextEditor
        ? vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)
        : undefined;
      if (!folder && folders?.length === 1) {
        folder = folders[0];
      }
      if (!folder && folders && folders.length > 1) {
        const selected = await vscode.window.showQuickPick(
          folders.map((candidate) => ({
            label: candidate.name,
            description: candidate.uri.fsPath,
            folder: candidate
          })),
          { placeHolder: '请选择要生成 tags 文件的工作区目录。' }
        );
        folder = selected?.folder;
      }
      if (!folder) {
        void vscode.window.showWarningMessage('请先打开包含源代码的工作区目录。');
        return;
      }

      // 生成的文件名必须取自配置，否则用户改过 tagFileNames 后跳转会找不到刚生成的文件。
      const tagFileName = readConfig((message) => diagnostics.report(message)).tagFileNames[0];
      isGeneratingTags = true;
      try {
        const outcome = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `正在生成 ${tagFileName} 文件`,
            cancellable: true
          },
          (_progress, token) => runCtags(folder.uri.fsPath, tagFileName, token)
        );
        provider.clear();
        if (outcome === 'cancelled') {
          void vscode.window.showWarningMessage(`已取消生成 ${tagFileName} 文件，工作区中可能残留不完整的内容。`);
          return;
        }
        void vscode.window.showInformationMessage(`已在“${folder.name}”生成 ${tagFileName} 文件。`);
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          void vscode.window.showWarningMessage('未找到 ctags。请安装 Universal Ctags，并确保其已加入 PATH。');
          return;
        }
        if (error && typeof error === 'object' && 'killed' in error && error.killed === true) {
          void vscode.window.showWarningMessage(
            `生成 ${tagFileName} 文件超时（超过 ${CTAGS_TIMEOUT_MS / 60_000} 分钟）已中止，请缩小工作区范围后重试。`
          );
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showWarningMessage(`生成 tags 文件失败：${message}`);
      } finally {
        isGeneratingTags = false;
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ctagsNavigator')) {
        provider.clear();
        diagnostics.report('配置已变化，缓存已清理。');
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.clear();
      diagnostics.report('工作区目录已变化，缓存已清理。');
    })
  );
}

export async function deactivate(): Promise<void> {
  const provider = activeProvider;
  activeProvider = undefined;
  await provider?.shutdown();
}

// 用固定参数而非 shell 命令字符串启动一次 ctags；取消时结束子进程并按已取消返回，不当作失败。
function runCtags(
  cwd: string,
  tagFileName: string,
  token: vscode.CancellationToken
): Promise<'completed' | 'cancelled'> {
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const child = execFile(
      'ctags',
      [
        '--sort=yes',
        '--fields=+n',
        ...CTAGS_EXCLUDES.map((name) => `--exclude=${name}`),
        '-R',
        '-f',
        tagFileName,
        '.'
      ],
      {
        cwd,
        windowsHide: true,
        maxBuffer: CTAGS_MAX_BUFFER_BYTES,
        timeout: CTAGS_TIMEOUT_MS
      },
      (error) => {
        cancellation.dispose();
        if (cancelled) {
          resolve('cancelled');
        } else if (error) {
          reject(error);
        } else {
          resolve('completed');
        }
      }
    );
    const cancellation = token.onCancellationRequested(() => {
      cancelled = true;
      child.kill();
    });
  });
}
