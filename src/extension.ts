import { execFile } from 'node:child_process';
import type { Readable } from 'node:stream';
import * as vscode from 'vscode';
import { readConfig } from './config';
import {
  CTAGS_LOG_MAX_LINES,
  CTAGS_MAX_BUFFER_BYTES,
  CTAGS_PROGRESS_INTERVAL_MS,
  CTAGS_PROGRESS_MAX_LINES,
  CTAGS_PROGRESS_MESSAGE_MAX_CHARS,
  CTAGS_TIMEOUT_MS
} from './constants';
import { Diagnostics } from './diagnostics';
import type { DefinitionLink } from './types';
import { CtagsDefinitionProvider } from './navigation/provider';

interface DefinitionQuickPickItem extends vscode.QuickPickItem {
  readonly link: DefinitionLink;
}

// 这些目录几乎不含需要跳转的定义，全量索引会显著拖慢生成并污染候选排序；
// 其中打包压缩过的文件还会让 ctags 逐行输出通知，单个目录就可能产生数 MB 标准错误。
const CTAGS_EXCLUDES = [
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  'vendor',
  'Pods',
  'Carthage',
  '.yarn',
  '.pnpm-store',
  '.bundle',
  '.cargo',
  '.gradle',
  '.m2',
  'site-packages',
  '.venv',
  'venv',
  '.tox',
  '.dart_tool',
  '.pub-cache',
  'dist',
  'out',
  'build',
  'target',
  'obj',
  'coverage',
  '.output',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.cache',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.terraform',
  'DerivedData',
  '.idea',
  '.vscode-test'
] as const;
const PROGRESS_PLACEHOLDER = '\u2800';

let activeProvider: CtagsDefinitionProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new Diagnostics();
  const provider = new CtagsDefinitionProvider(diagnostics);
  let isGeneratingTags = false;
  let pendingDefinition: vscode.CancellationTokenSource | undefined;
  activeProvider = provider;
  context.subscriptions.push(
    diagnostics,
    provider,
    vscode.commands.registerCommand('simpleCtags.goToDefinition', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('simple ctags：当前没有可跳转的编辑器。');
        return;
      }
      // 连续触发时取消上一次请求：既中止仍在扫描的查询，也关掉它可能已经弹出的选择列表。
      pendingDefinition?.cancel();
      pendingDefinition?.dispose();
      const source = new vscode.CancellationTokenSource();
      pendingDefinition = source;
      try {
        const result = await provider.provideDefinition(editor.document, editor.selection.active, source.token);
        if (source.token.isCancellationRequested) {
          return;
        }
        const links = result.links;
        if (!links || links.length === 0) {
          void vscode.window.showWarningMessage(`simple ctags：${result.notice ?? '未找到当前符号的定义。'}`);
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
            },
            source.token
          );
          if (!selected) {
            return;
          }
          link = selected.link;
        }
        if (link && !source.token.isCancellationRequested) {
          await vscode.window.showTextDocument(link.targetUri, {
            selection: link.targetSelectionRange ?? link.targetRange
          });
        }
      } catch (error) {
        if (source.token.isCancellationRequested) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showWarningMessage(`simple ctags：跳转失败：${message}`);
      } finally {
        if (pendingDefinition === source) {
          pendingDefinition = undefined;
        }
        source.dispose();
      }
    }),
    vscode.commands.registerCommand('simpleCtags.clearCache', () => {
      provider.clear();
      diagnostics.report('缓存已清理，tags 文件句柄已关闭。');
    }),
    vscode.commands.registerCommand('simpleCtags.diagnoseCurrentSymbol', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        diagnostics.showSnapshot({ candidateCount: 0, resultCount: 0, elapsedMs: 0 });
        return;
      }
      await provider.diagnose(editor.document, editor.selection.active);
    }),
    vscode.commands.registerCommand('simpleCtags.generateTags', async () => {
      if (isGeneratingTags) {
        void vscode.window.showInformationMessage('simple ctags：正在生成 tags 文件，请等待本次生成结束。');
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
      const report = (message: string): void => diagnostics.report(message);
      const tagFileName = readConfig(report).tagFileNames[0];
      isGeneratingTags = true;
      try {
        const outcome = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `正在生成 ${tagFileName} 文件`,
            cancellable: true
          },
          (progress, token) => runCtags(folder.uri.fsPath, tagFileName, report, progress, token)
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
      if (event.affectsConfiguration('simpleCtags')) {
        provider.clear();
        diagnostics.report('配置已变化，缓存已清理。');
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      provider.clear();
      diagnostics.report('工作区目录已变化，缓存已清理。');
    }),
    {
      dispose: () => {
        pendingDefinition?.cancel();
        pendingDefinition?.dispose();
        pendingDefinition = undefined;
      }
    }
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
  report: (message: string) => void,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<'completed' | 'cancelled'> {
  const args = [
    '--sort=yes',
    '--fields=+n',
    ...CTAGS_EXCLUDES.map((name) => `--exclude=${name}`),
    '-R',
    '-f',
    tagFileName,
    '.'
  ];
  report('=== 生成 tags ===');
  report(`工作目录：${cwd}`);
  report(`执行命令：ctags ${args.join(' ')}`);
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let cancelled = false;
    const progressOutputLines: string[] = [];
    const appendProgressOutput = (line: string): void => {
      progressOutputLines.push(line);
      if (progressOutputLines.length > CTAGS_PROGRESS_MAX_LINES) {
        progressOutputLines.shift();
      }
    };
    const reportProgress = (): void => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const visibleLines = [...progressOutputLines];
      while (visibleLines.length < CTAGS_PROGRESS_MAX_LINES) {
        visibleLines.push(PROGRESS_PLACEHOLDER);
      }
      progress.report({ message: [`已执行 ${elapsedSeconds} 秒。`, ...visibleLines].join('\n') });
    };
    reportProgress();
    const progressTimer = setInterval(() => {
      reportProgress();
    }, CTAGS_PROGRESS_INTERVAL_MS);
    const child = execFile(
      'ctags',
      args,
      {
        cwd,
        windowsHide: true,
        maxBuffer: CTAGS_MAX_BUFFER_BYTES,
        timeout: CTAGS_TIMEOUT_MS
      },
      (error) => {
        clearInterval(progressTimer);
        cancellation.dispose();
        finishStdout();
        finishStderr();
        report(`ctags 结束，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒。`);
        if (cancelled) {
          report('本次生成已被用户取消。');
          resolve('cancelled');
        } else if (error) {
          report(`ctags 执行失败：${error.message}`);
          reject(error);
        } else {
          resolve('completed');
        }
      }
    );
    const showProgressOutput = (label: string, line: string): void => {
      const normalized = line.replace(/\p{Cc}/gu, '').trim();
      if (!normalized) {
        return;
      }
      const output = `${label}：${normalized}`;
      appendProgressOutput(
        output.length > CTAGS_PROGRESS_MESSAGE_MAX_CHARS
          ? `${output.slice(0, CTAGS_PROGRESS_MESSAGE_MAX_CHARS - 1)}…`
          : output
      );
      reportProgress();
    };
    const finishStdout = reportOutput(child.stdout, report, '标准输出', showProgressOutput);
    const finishStderr = reportOutput(child.stderr, report, '标准错误', showProgressOutput);
    const cancellation = token.onCancellationRequested(() => {
      cancelled = true;
      child.kill();
    });
  });
}

// ctags 会对压缩过的文件逐行输出通知，总量可达数 MB；实时显示开头若干行，避免撑爆输出通道。
function reportOutput(
  stream: Readable | null,
  report: (message: string) => void,
  label: string,
  showProgressOutput: (label: string, line: string) => void
): () => void {
  let pending = '';
  let reportedLines = 0;
  let omittedLines = 0;
  let headingReported = false;
  const reportLine = (line: string): void => {
    showProgressOutput(label, line);
    if (!headingReported) {
      report(`${label}：`);
      headingReported = true;
    }
    if (reportedLines < CTAGS_LOG_MAX_LINES) {
      report(`  ${line}`);
      reportedLines += 1;
    } else {
      omittedLines += 1;
    }
  };
  const onData = (chunk: Buffer | string): void => {
    const lines = `${pending}${chunk.toString()}`.split(/\r?\n/);
    pending = lines.pop() ?? '';
    for (const line of lines) {
      reportLine(line);
    }
  };
  stream?.on('data', onData);
  return () => {
    stream?.off('data', onData);
    if (pending) {
      reportLine(pending);
    }
    if (omittedLines > 0) {
      report(`  …… 其余 ${omittedLines} 行已省略。`);
    }
  };
}
