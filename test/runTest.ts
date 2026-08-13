import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
    launchArgs: [path.resolve(root, 'test', 'fixtures', 'workspace'), '--disable-extensions']
  });
}

void main().catch((error: unknown) => {
  console.error('集成测试失败：', error);
  process.exitCode = 1;
});
