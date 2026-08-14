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
      'simpleCtags.tagFileNames': ['tags', '../tags', 'sub/tags', 'sub\\tags', '..', '.', '', 42]
    });
    const config = read();
    assert.deepEqual(config.tagFileNames, ['tags']);
    assert.equal(messages.length, 7);
    assert.ok(messages.every((message) => message.includes('无效文件名')));
  });

  it('全部文件名非法时回退默认值', () => {
    setConfigurationValues({ 'simpleCtags.tagFileNames': ['/etc/tags'] });
    const config = read();
    assert.deepEqual(config.tagFileNames, ['.tags', 'tags']);
    assert.ok(messages.some((message) => message.includes('已使用默认值')));
  });

  it('maxResults 超范围或非整数时回退默认值并说明原因', () => {
    setConfigurationValues({ 'simpleCtags.maxResults': 0 });
    assert.equal(read().maxResults, 50);
    assert.ok(messages.some((message) => message.includes('超出 1–200')));

    messages = [];
    setConfigurationValues({ 'simpleCtags.maxResults': 201 });
    assert.equal(read().maxResults, 50);
    assert.ok(messages.some((message) => message.includes('超出 1–200')));

    messages = [];
    setConfigurationValues({ 'simpleCtags.maxResults': 12.5 });
    assert.equal(read().maxResults, 50);
    assert.ok(messages.some((message) => message.includes('不是整数')));

    messages = [];
    setConfigurationValues({ 'simpleCtags.maxResults': '50' });
    assert.equal(read().maxResults, 50);
    assert.ok(messages.some((message) => message.includes('不是整数')));

    messages = [];
    setConfigurationValues({ 'simpleCtags.maxResults': 200 });
    assert.equal(read().maxResults, 200);
    assert.deepEqual(messages, []);
  });

  it('enabled 为 false 时如实返回', () => {
    setConfigurationValues({ 'simpleCtags.enabled': false });
    assert.equal(read().enabled, false);
  });
});
