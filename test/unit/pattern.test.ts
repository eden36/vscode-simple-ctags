import { strict as assert } from 'node:assert';
import { decodeSearchPattern } from '../../src/navigation/pattern';

describe('搜索地址解码', () => {
  it('去除首尾锚点并还原转义', () => {
    assert.equal(decodeSearchPattern('/^const value = foo\\/bar;$/'), 'const value = foo/bar;');
  });

  it('支持问号分隔符', () => {
    assert.equal(decodeSearchPattern('?^hello$?'), 'hello');
  });

  it('区分行锚点与转义的美元符号', () => {
    assert.equal(decodeSearchPattern('/^price = 100\\$$/'), 'price = 100$');
    assert.equal(decodeSearchPattern('/^value = foo\\\\$/'), 'value = foo\\');
  });

  it('拒绝非搜索地址', () => {
    assert.equal(decodeSearchPattern('42'), undefined);
    assert.equal(decodeSearchPattern('/missing-end'), undefined);
  });
});
