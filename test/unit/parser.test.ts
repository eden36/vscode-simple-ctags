import { strict as assert } from 'node:assert';
import { parseTagLine, unescapeField } from '../../src/tags/parser';

describe('tags 记录解析', () => {
  it('解析数字地址、kind、line 和 scope', () => {
    const record = parseTagLine('Widget\tsrc/widget.ts\t42;"\tc\tline:42\tclass:ui::Panel', 128);
    assert.ok(record);
    assert.equal(record.name, 'Widget');
    assert.equal(record.address, '42');
    assert.equal(record.kind, 'c');
    assert.equal(record.line, 42);
    assert.equal(record.scope, 'ui::Panel');
    assert.equal(record.bytePosition, 128);
  });

  it('解析搜索地址和扩展 kind', () => {
    const record = parseTagLine('run\tsrc/main.c\t/^void run(void)$/;"\tkind:function\tnamespace:app', 0);
    assert.ok(record);
    assert.equal(record.address, '/^void run(void)$/');
    assert.equal(record.kind, 'function');
    assert.equal(record.scope, 'app');
  });

  it('跳过伪标签和损坏记录', () => {
    assert.equal(parseTagLine('!_TAG_FILE_SORTED\t1\t/0=unsorted, 1=sorted/', 0), undefined);
    assert.equal(parseTagLine('broken', 0), undefined);
  });

  it('还原字段转义', () => {
    assert.equal(unescapeField('dir\\\\name\\tpart\\nend'), 'dir\\name\tpart\nend');
  });
});
