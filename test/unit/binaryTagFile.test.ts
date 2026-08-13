import { strict as assert } from 'node:assert';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { BinaryTagFile, type RandomAccessHandle } from '../../src/tags/tagFile';

const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} })
} as any;

describe('tags 二分查询', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ctags-navigator-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function fixture(lines: string[], ending = '\n'): Promise<BinaryTagFile> {
    const filePath = path.join(directory, 'tags');
    await writeFile(filePath, lines.join(ending), 'utf8');
    const version = await stat(filePath);
    return new BinaryTagFile({ fsPath: filePath } as any, { size: version.size, mtimeMs: version.mtimeMs }, () => undefined);
  }

  it('查询首项、末项和缺失项', async () => {
    const file = await fixture([
      '!_TAG_FILE_SORTED\t1\t/0=unsorted, 1=sorted/',
      'Alpha\ta.ts\t1;"\tf',
      'Middle\tm.ts\t2;"\tf',
      'Zulu\tz.ts\t3;"\tf'
    ]);
    try {
      assert.equal(await file.getSortStatus(token), 'sorted');
      assert.equal((await file.query('Alpha', 10, token))[0]?.file, 'a.ts');
      assert.equal((await file.query('Zulu', 10, token))[0]?.file, 'z.ts');
      assert.deepEqual(await file.query('Missing', 10, token), []);
    } finally {
      await file.close();
    }
  });

  it('支持 UTF-8、CRLF、无末尾换行和同名项限制', async () => {
    const file = await fixture([
      '!_TAG_FILE_SORTED\t1\t/0=unsorted, 1=sorted/',
      'Alpha\ta.ts\t1;"',
      '符号\ta.ts\t2;"',
      '符号\tb.ts\t3;"',
      '终点\tz.ts\t4;"'
    ], '\r\n');
    try {
      const records = await file.query('符号', 1, token);
      assert.equal(records.length, 1);
      assert.equal(records[0].file, 'a.ts');
      assert.equal((await file.query('终点', 10, token))[0]?.address, '4');
    } finally {
      await file.close();
    }
  });

  it('识别缺失、未排序和 foldcase 声明', async () => {
    const unverified = await fixture(['Alpha\ta.ts\t1;"']);
    assert.equal(await unverified.getSortStatus(token), 'unverified');
    await unverified.close();

    const unsorted = await fixture(['!_TAG_FILE_SORTED\t0\t/0=unsorted/', 'Alpha\ta.ts\t1;"']);
    assert.equal(await unsorted.getSortStatus(token), 'unsorted');
    await unsorted.close();

    const foldcase = await fixture(['!_TAG_FILE_SORTED\t2\t/2=foldcase/', 'Alpha\ta.ts\t1;"']);
    assert.equal(await foldcase.getSortStatus(token), 'foldcase');
    await foldcase.close();
  });

  it('跨多个数据块仍能找到每个抽样符号', async () => {
    const rows = ['!_TAG_FILE_SORTED\t1\t/1=sorted/'];
    for (let index = 0; index < 3000; index += 1) {
      const name = `Item${index.toString().padStart(5, '0')}`;
      rows.push(`${name}\tsrc/${index}.ts\t${index + 1};"\tf`);
    }
    const file = await fixture(rows);
    try {
      for (const index of [0, 1, 777, 1555, 2999]) {
        const name = `Item${index.toString().padStart(5, '0')}`;
        assert.equal((await file.query(name, 10, token))[0]?.name, name);
      }
      assert.deepEqual(await file.query('Item03000', 10, token), []);
    } finally {
      await file.close();
    }
  });

  it('虚拟 1 GiB 文件查询读取量小于 1 MiB', async () => {
    const lineLength = 64;
    const lineCount = Math.floor((1024 ** 3) / lineLength);
    const reader = new VirtualTagHandle(lineLength, lineCount);
    const file = new BinaryTagFile(
      { fsPath: 'virtual-tags' } as any,
      { size: lineLength * lineCount, mtimeMs: 1 },
      () => undefined,
      async () => reader
    );
    try {
      assert.equal(await file.getSortStatus(token), 'unverified');
      const name = virtualName(12_345_678);
      assert.equal((await file.query(name, 10, token))[0]?.name, name);
      assert.ok(file.bytesRead < 1024 * 1024, `实际读取 ${file.bytesRead} 字节`);
    } finally {
      await file.close();
    }
  });

  it('跳过超过 1 MiB 的记录并继续查询', async () => {
    const messages: string[] = [];
    const filePath = path.join(directory, 'tags');
    const oversized = `Huge\thuge.ts\t/^${'x'.repeat(1024 * 1024)}$/;"`;
    await writeFile(filePath, [
      '!_TAG_FILE_SORTED\t1\t/1=sorted/',
      'Alpha\ta.ts\t1;"',
      oversized,
      'Zulu\tz.ts\t2;"'
    ].join('\n'), 'utf8');
    const version = await stat(filePath);
    const file = new BinaryTagFile(
      { fsPath: filePath } as any,
      { size: version.size, mtimeMs: version.mtimeMs },
      (message) => messages.push(message)
    );
    try {
      assert.equal((await file.query('Zulu', 10, token))[0]?.name, 'Zulu');
      assert.ok(messages.some((message) => message.includes('超过 1 MiB')));
    } finally {
      await file.close();
    }
  });
});

class VirtualTagHandle implements RandomAccessHandle {
  private readonly lineLength: number;
  private readonly lineCount: number;

  public constructor(lineLength: number, lineCount: number) {
    this.lineLength = lineLength;
    this.lineCount = lineCount;
  }

  public async read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }> {
    const size = this.lineLength * this.lineCount;
    const bytesRead = Math.max(0, Math.min(length, size - position));
    let written = 0;
    while (written < bytesRead) {
      const absolute = position + written;
      const lineIndex = Math.floor(absolute / this.lineLength);
      const lineOffset = absolute % this.lineLength;
      const line = virtualLine(lineIndex, this.lineLength);
      const copied = Math.min(bytesRead - written, this.lineLength - lineOffset);
      line.copy(buffer, offset + written, lineOffset, lineOffset + copied);
      written += copied;
    }
    return { bytesRead };
  }

  public async close(): Promise<void> {}
}

function virtualName(index: number): string {
  return `Symbol${index.toString().padStart(10, '0')}`;
}

function virtualLine(index: number, length: number): Buffer {
  const prefix = `${virtualName(index)}\tf.ts\t1;"\tf`;
  return Buffer.from(`${prefix}${' '.repeat(length - prefix.length - 1)}\n`, 'utf8');
}
