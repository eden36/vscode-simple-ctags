import { strict as assert } from 'node:assert';
import * as vscode from 'vscode';

describe('VS Code 定义导航', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension('local.simple-ctags');
    assert.ok(extension, '扩展未安装到测试宿主');
    await extension.activate();
  });

  it('仅通过插件命令跳转到未知扩展名文档中的定义', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'usage.unknown'));
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 2, 0, 2);
    const definitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      'vscode.executeDefinitionProvider',
      document.uri,
      new vscode.Position(0, 2)
    );
    assert.equal(definitions.length, 0);

    await vscode.commands.executeCommand('ctagsNavigator.goToDefinition');
    assert.equal(vscode.window.activeTextEditor?.document.uri.path.endsWith('/definition.strange'), true);

  });

  it('四个命令都已注册到宿主', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'ctagsNavigator.goToDefinition',
      'ctagsNavigator.clearCache',
      'ctagsNavigator.diagnoseCurrentSymbol',
      'ctagsNavigator.generateTags'
    ]) {
      assert.ok(commands.includes(id), `命令未注册：${id}`);
    }
  });

  it('运行时关闭配置后不跳转', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const configuration = vscode.workspace.getConfiguration('ctagsNavigator');
    await configuration.update('enabled', false, vscode.ConfigurationTarget.Workspace);
    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder.uri, 'usage.unknown'));
      const editor = await vscode.window.showTextDocument(document);
      editor.selection = new vscode.Selection(0, 2, 0, 2);
      await vscode.commands.executeCommand('ctagsNavigator.goToDefinition');
      assert.equal(vscode.window.activeTextEditor?.document.uri.path.endsWith('/usage.unknown'), true);
    } finally {
      await configuration.update('enabled', undefined, vscode.ConfigurationTarget.Workspace);
    }
  });
});
