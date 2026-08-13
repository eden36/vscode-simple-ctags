import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Uri } from './support/vscodeStub';
import { TagFileLocator } from '../../src/tags/locator';

const NAMES = ['tags', '.tags'];

describe('tags 文件定位', () => {
  let directory: string;
  let locator: TagFileLocator;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ctags-navigator-'));
    locator = new TagFileLocator();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function folderAt(...segments: string[]) {
    return { uri: Uri.file(path.join(directory, ...segments)) } as any;
  }

  function documentAt(...segments: string[]) {
    return Uri.file(path.join(directory, ...segments)) as any;
  }

  it('从子目录向上找到最近的 tags', async () => {
    await mkdir(path.join(directory, 'src', 'deep'), { recursive: true });
    await writeFile(path.join(directory, 'tags'), 'Alpha\ta.ts\t1;"\n', 'utf8');
    await writeFile(path.join(directory, 'src', '.tags'), 'Alpha\tb.ts\t1;"\n', 'utf8');

    const located = await locator.locate(documentAt('src', 'deep', 'x.ts'), folderAt(), NAMES);
    assert.ok(located);
    assert.equal(path.basename(located.uri.fsPath), '.tags');
    assert.equal(path.dirname(located.uri.fsPath), path.join(directory, 'src'));
  });

  it('按配置顺序优先选择同目录下的第一个文件名', async () => {
    await writeFile(path.join(directory, 'tags'), 'Alpha\ta.ts\t1;"\n', 'utf8');
    await writeFile(path.join(directory, '.tags'), 'Alpha\tb.ts\t1;"\n', 'utf8');

    const located = await locator.locate(documentAt('x.ts'), folderAt(), NAMES);
    assert.equal(path.basename(located!.uri.fsPath), 'tags');
  });

  it('不越过工作区根目录向上查找', async () => {
    await mkdir(path.join(directory, 'project', 'src'), { recursive: true });
    await writeFile(path.join(directory, 'tags'), 'Alpha\ta.ts\t1;"\n', 'utf8');

    const located = await locator.locate(
      documentAt('project', 'src', 'x.ts'),
      folderAt('project'),
      NAMES
    );
    assert.equal(located, undefined);
  });

  it('重复定位复用缓存并返回最新的文件版本', async () => {
    const tagsPath = path.join(directory, 'tags');
    await writeFile(tagsPath, 'Alpha\ta.ts\t1;"\n', 'utf8');

    const first = await locator.locate(documentAt('x.ts'), folderAt(), NAMES);
    assert.ok(first);

    await writeFile(tagsPath, 'Alpha\ta.ts\t1;"\nBeta\tb.ts\t2;"\n', 'utf8');
    const second = await locator.locate(documentAt('x.ts'), folderAt(), NAMES);
    assert.ok(second);
    assert.equal(second.uri.toString(), first.uri.toString());
    assert.ok(second.version.size > first.version.size, '缓存命中后应重新读取文件版本');
  });

  it('缓存的 tags 被删除后返回未找到', async () => {
    const tagsPath = path.join(directory, 'tags');
    await writeFile(tagsPath, 'Alpha\ta.ts\t1;"\n', 'utf8');
    assert.ok(await locator.locate(documentAt('x.ts'), folderAt(), NAMES));

    await rm(tagsPath);
    assert.equal(await locator.locate(documentAt('x.ts'), folderAt(), NAMES), undefined);
  });
});
