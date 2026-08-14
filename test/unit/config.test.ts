import { strict as assert } from 'node:assert';
import { setConfigurationValues } from './support/vscodeStub';
import { readConfig } from '../../src/config';

describe('配置读取', () => {
  let messages: string[];

  beforeEach(() => {
    messages = [];
    setConfigurationValues({});
  });

  function read() {
    return readConfig((message) => messages.push(message));
  }

  it('缺省时使用默认值', () => {
    const config = read();
    assert.equal(config.enabled, true);
    assert.deepEqual(config.tagFileNames, ['.tags', 'tags']);
    assert.equal(config.maxResults, 50);
    assert.deepEqual(messages, []);
  });

  it('忽略含路径分隔符或相对目录的文件名', () => {
    setConfigurationValues({
      'ctagsNavigator.tagFileNames': ['tags', '../tags', 'sub/tags', 'sub\\tags', '..', '.', '', 42]
    });
    const config = read();
    assert.deepEqual(config.tagFileNames, ['tags']);
    assert.equal(messages.length, 7);
    assert.ok(messages.every((message) => message.includes('无效文件名')));
  });

  it('全部文件名非法时回退默认值', () => {
    setConfigurationValues({ 'ctagsNavigator.tagFileNames': ['/etc/tags'] });
    const config = read();
    assert.deepEqual(config.tagFileNames, ['.tags', 'tags']);
    assert.ok(messages.some((message) => message.includes('已使用默认值')));
  });

  it('maxResults 超范围或非整数时回退默认值', () => {
    setConfigurationValues({ 'ctagsNavigator.maxResults': 0 });
    assert.equal(read().maxResults, 50);
    setConfigurationValues({ 'ctagsNavigator.maxResults': 201 });
    assert.equal(read().maxResults, 50);
    setConfigurationValues({ 'ctagsNavigator.maxResults': 12.5 });
    assert.equal(read().maxResults, 50);
    setConfigurationValues({ 'ctagsNavigator.maxResults': 200 });
    assert.equal(read().maxResults, 200);
  });

  it('enabled 为 false 时如实返回', () => {
    setConfigurationValues({ 'ctagsNavigator.enabled': false });
    assert.equal(read().enabled, false);
  });
});
