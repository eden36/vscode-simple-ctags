import * as vscode from 'vscode';
import { Diagnostics } from './diagnostics';
import type { DefinitionLink } from './types';
import { CtagsDefinitionProvider } from './navigation/provider';

interface DefinitionQuickPickItem extends vscode.QuickPickItem {
  readonly link: DefinitionLink;
}

let activeProvider: CtagsDefinitionProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new Diagnostics();
  const provider = new CtagsDefinitionProvider(diagnostics);
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
              label: `${vscode.workspace.asRelativePath(candidate.targetUri, false).replace(/\//g, '\\')}:${
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
