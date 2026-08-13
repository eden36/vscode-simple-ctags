import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Uri, cancellationToken as token } from './support/vscodeStub';
import { AddressResolver, resolveTargetUri } from '../../src/navigation/addressResolver';
import type { TagRecord } from '../../src/types';

function record(address: string, line?: number): TagRecord {
  return { name: 'target', file: 'source.ts', address, line, fields: {}, bytePosition: 0 };
}

describe('tag 地址解析', () => {
  let directory: string;
  let resolver: AddressResolver;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ctags-navigator-'));
    resolver = new AddressResolver();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function source(lines: string[], ending = '\n') {
    const filePath = path.join(directory, 'source.ts');
    await writeFile(filePath, lines.join(ending), 'utf8');
    return Uri.file(filePath) as any;
  }

  it('数字地址定位到对应行并读回该行内容', async () => {
    const uri = await source(['first', 'second', 'function target() {}']);
    const resolved = await resolver.resolve(record('3'), uri, 'target', token);
    assert.ok(resolved);
    assert.equal(resolved.selectionRange.start.line, 2);
    assert.equal(resolved.selectionRange.start.character, 'function '.length);
    assert.equal(resolved.lineText, 'function target() {}');
  });

  it('搜索地址在 CRLF 文件中按整行精确匹配', async () => {
    const uri = await source(['first', 'function target() {}', 'last'], '\r\n');
    const resolved = await resolver.resolve(record('/^function target() {}$/'), uri, 'target', token);
    assert.ok(resolved);
    assert.equal(resolved.selectionRange.start.line, 1);
    assert.equal(resolved.lineText, 'function target() {}');
  });

  it('行号与搜索地址一致时直接使用行号', async () => {
    const uri = await source(['first', 'function target() {}']);
    const resolved = await resolver.resolve(record('/^function target() {}$/', 2), uri, 'target', token);
    assert.ok(resolved);
    assert.equal(resolved.selectionRange.start.line, 1);
  });

  it('行号过期时按搜索地址重新定位', async () => {
    const uri = await source(['inserted', 'inserted', 'first', 'function target() {}']);
    const resolved = await resolver.resolve(record('/^function target() {}$/', 2), uri, 'target', token);
    assert.ok(resolved);
    assert.equal(resolved.selectionRange.start.line, 3);
    assert.equal(resolved.lineText, 'function target() {}');
  });

  it('搜索地址在文件中不存在时返回未解析', async () => {
    const uri = await source(['first', 'second']);
    assert.equal(await resolver.resolve(record('/^function target() {}$/'), uri, 'target', token), undefined);
  });

  it('相对与绝对文件字段都能换算为目标 URI', () => {
    const tagUri = Uri.file(path.join(directory, 'tags')) as any;
    const relative = resolveTargetUri(tagUri, 'src/deep/source.ts');
    assert.equal(relative.fsPath, path.join(directory, 'src', 'deep', 'source.ts'));

    const absolute = resolveTargetUri(tagUri, path.join(directory, 'source.ts'));
    assert.equal(absolute.fsPath, path.join(directory, 'source.ts'));
  });
});
