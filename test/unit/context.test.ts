import { strict as assert } from 'node:assert';
import { extractSymbolContext } from '../../src/navigation/context';

interface PositionLike { line: number; character: number }

function documentFor(text: string, start: number, end: number): any {
  const range = {
    start: { line: 0, character: start },
    end: { line: 0, character: end }
  };
  return {
    getWordRangeAtPosition: () => range,
    getText: () => text.slice(start, end),
    lineAt: () => ({ text })
  };
}

describe('符号上下文提取', () => {
  for (const expression of ['a.b.item', 'a::b::item', 'a->b->item', 'a#b#item', 'a/b/item', 'a\\b\\item']) {
    it(`支持限定符：${expression}`, () => {
      const start = expression.lastIndexOf('item');
      const result = extractSymbolContext(documentFor(expression, start, expression.length), { line: 0, character: start } as PositionLike as any);
      assert.ok(result);
      assert.equal(result.symbol, 'item');
      assert.equal(result.qualifier, 'a::b');
      assert.equal(result.fullName, expression);
      assert.equal(result.queries.at(-1), 'item');
    });
  }

  it('最多保留左侧三个限定段', () => {
    const expression = 'a.b.c.d.item';
    const start = expression.lastIndexOf('item');
    const result = extractSymbolContext(documentFor(expression, start, expression.length), { line: 0, character: start } as PositionLike as any);
    assert.ok(result);
    assert.equal(result.qualifier, 'b::c::d');
    assert.equal(result.fullName, 'b.c.d.item');
  });

  it('无单词时静默退出', () => {
    const document = { getWordRangeAtPosition: () => undefined } as any;
    assert.equal(extractSymbolContext(document, { line: 0, character: 0 } as any), undefined);
  });
});
