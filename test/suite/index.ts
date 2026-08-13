import * as path from 'node:path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true });
  mocha.addFile(path.resolve(__dirname, 'navigation.test.js'));
  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => failures > 0 ? reject(new Error(`${failures} 个集成测试失败`)) : resolve());
  });
}
