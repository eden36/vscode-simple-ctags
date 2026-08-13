import { strict as assert } from 'node:assert';
import { LruCache } from '../../src/utils/lru';

describe('LRU 缓存', () => {
  it('按最近使用顺序淘汰', () => {
    const evicted: string[] = [];
    const cache = new LruCache<string, string>({
      maxItems: 2,
      onEvict: (_value, key) => {
        evicted.push(key);
      }
    });
    cache.set('a', 'A');
    cache.set('b', 'B');
    assert.equal(cache.get('a'), 'A');
    cache.set('c', 'C');
    assert.equal(cache.get('b'), undefined);
    assert.deepEqual(evicted, ['b']);
  });

  it('遵守总权重限制', () => {
    const cache = new LruCache<string, string>({
      maxItems: 10,
      maxWeight: 4,
      weight: (value) => value.length
    });
    cache.set('a', '123');
    cache.set('b', '45');
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.get('b'), '45');
    assert.ok(cache.weight <= 4);
  });
});
