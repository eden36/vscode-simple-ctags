import { strict as assert } from 'node:assert';
import { decodeSearchPattern } from '../../src/navigation/pattern';

describe('搜索地址解码', () => {
  it('去除首尾锚点并还原转义', () => {
    assert.equal(decodeSearchPattern('/^const value = foo\\/bar;$/'), 'const value = foo/bar;');
  });

  it('支持问号分隔符', () => {
    assert.equal(decodeSearchPattern('?^hello$?'), 'hello');
  });

  it('拒绝非搜索地址', () => {
    assert.equal(decodeSearchPattern('42'), undefined);
    assert.equal(decodeSearchPattern('/missing-end'), undefined);
  });
});
