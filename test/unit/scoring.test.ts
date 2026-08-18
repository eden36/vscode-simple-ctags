import { strict as assert } from 'node:assert';
import { scoreCandidate } from '../../src/navigation/scoring';

const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } as any;

describe('候选评分', () => {
  it('累加完整名称、scope、同文件和路径奖励', () => {
    const record = {
      name: 'run', file: 'src/a.ts', address: '1', scope: 'app::Worker', fields: {}, bytePosition: 10
    };
    const uri = { scheme: 'file', authority: '', fsPath: pathFor('project/src/a.ts') } as any;
    const context = {
      symbol: 'run', sourceRange: range, qualifier: 'app::Worker', fullName: 'app::Worker::run', queries: []
    };
    const score = scoreCandidate(record, uri, uri, context, new Set(['app::Worker::run']));
    assert.equal(score, 1510);
  });

  it('同分以外不按 kind 添加权重', () => {
    const base = { name: 'run', file: 'a.ts', address: '1', fields: {}, bytePosition: 1 };
    const source = { scheme: 'file', authority: '', fsPath: pathFor('project/source.ts') } as any;
    const target = { scheme: 'file', authority: '', fsPath: pathFor('project/lib/a.ts') } as any;
    const context = { symbol: 'run', sourceRange: range, queries: ['run'] };
    assert.equal(
      scoreCandidate({ ...base, kind: 'function' }, target, source, context, new Set(['run'])),
      scoreCandidate({ ...base, kind: 'class' }, target, source, context, new Set(['run']))
    );
  });

  it('文件名与符号同名时优先级更高', () => {
    const base = { name: 'DaoType', file: 'a.php', address: '1', fields: {}, bytePosition: 1 };
    const source = { scheme: 'file', authority: '', fsPath: pathFor('project/system/services/modules/common/shop/imps/TcShop.php') } as any;
    const sameNameTarget = { scheme: 'file', authority: '', fsPath: pathFor('project/system/datalevels/DaoType.php') } as any;
    const nearTarget = { scheme: 'file', authority: '', fsPath: pathFor('project/system/services/modules/common/shop/DaoTypeAlias.php') } as any;
    const context = { symbol: 'DaoType', sourceRange: range, queries: ['DaoType'] };
    assert.ok(
      scoreCandidate(base, sameNameTarget, source, context, new Set(['DaoType']))
      > scoreCandidate(base, nearTarget, source, context, new Set(['DaoType'])),
      '同名文件应优先于仅路径更近的候选'
    );
  });
});

function pathFor(value: string): string {
  return process.platform === 'win32' ? `C:\\${value.replace(/\//g, '\\')}` : `/${value}`;
}
