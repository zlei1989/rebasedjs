// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CommittedEntry, FileHistoryEntry } from '@rebased/contracts';
import { changesHints, isEntryReady, resolveBlameHash } from './blame-state';

/** 历史条目工厂 */
function makeHistory(hash: string): FileHistoryEntry {
  return { hash, shortHash: hash.slice(0, 7), subject: `s ${hash}`, author: 'Sam', dateIso: '2026-01-01T00:00:00+00:00', parents: [] };
}

/** 变更集条目工厂 */
function makeEntry(partial: Partial<CommittedEntry> & { hash: string }): CommittedEntry {
  return {
    shortHash: partial.hash.slice(0, 7),
    subject: 's',
    author: 'Sam',
    dateIso: '2026-01-01T00:00:00+00:00',
    parents: ['p1'],
    files: [{ path: 'src/app.ts', status: 'M' }],
    ...partial,
  };
}

describe('resolveBlameHash（选中提交解析）', () => {
  it('URL 有 hash：以 URL 为准（陈旧深链也要能看）', () => {
    expect(resolveBlameHash('abc', [makeHistory('def')])).toBe('abc');
  });

  it('URL 无 hash：回落清单首条（最新一条），带 ?file= 深链进来右栏立刻有内容', () => {
    expect(resolveBlameHash(null, [makeHistory('first'), makeHistory('second')])).toBe('first');
  });

  it('URL 无 hash 且清单为空：空串（右栏空态、不发请求）', () => {
    expect(resolveBlameHash(null, [])).toBe('');
    expect(resolveBlameHash(null, undefined)).toBe('');
  });

  it('URL 空串与缺省同义', () => {
    expect(resolveBlameHash('', [makeHistory('first')])).toBe('first');
  });
});

describe('isEntryReady（变更集是否属于当前选中提交）', () => {
  it('hash 命中才算就绪：SWR 换键那一拍可能还挂着上一提交的数据', () => {
    expect(isEntryReady(makeEntry({ hash: 'aaa' }), 'aaa')).toBe(true);
    expect(isEntryReady(makeEntry({ hash: 'bbb' }), 'aaa')).toBe(false);
    expect(isEntryReady(null, 'aaa')).toBe(false);
    expect(isEntryReady(undefined, 'aaa')).toBe(false);
    expect(isEntryReady(makeEntry({ hash: 'aaa' }), '')).toBe(false);
  });
});

describe('changesHints（标签1/标签2 的三种降级判据）', () => {
  it('未就绪：三种标记全不置位（数据还没到，不能凭旧数据下结论）', () => {
    expect(changesHints(makeEntry({ hash: 'bbb' }), 'aaa', 'src/app.ts')).toEqual({
      ready: false, rootCommit: false, renameFrom: undefined, missingPath: false,
    });
  });

  it('根提交：parents 为空 → rootCommit', () => {
    const hints = changesHints(makeEntry({ hash: 'aaa', parents: [] }), 'aaa', 'src/app.ts');
    expect(hints).toMatchObject({ ready: true, rootCommit: true, missingPath: false });
  });

  it('重命名：该提交变更集里当前路径带 renameFrom', () => {
    const entry = makeEntry({ hash: 'aaa', files: [{ path: 'src/new.ts', status: 'R', renameFrom: 'src/old.ts' }] });
    const hints = changesHints(entry, 'aaa', 'src/new.ts');
    expect(hints).toMatchObject({ ready: true, rootCommit: false, renameFrom: 'src/old.ts', missingPath: false });
  });

  it('该提交没动过这个路径：files 非空但没有当前路径 → missingPath（改名之前 / 尚未创建）', () => {
    const hints = changesHints(makeEntry({ hash: 'aaa', files: [{ path: 'other.ts', status: 'M' }] }), 'aaa', 'src/app.ts');
    expect(hints).toMatchObject({ ready: true, missingPath: true, renameFrom: undefined });
  });

  it('合并提交（files 为空且多父）：不判 missingPath——git 对合并提交默认不列文件', () => {
    const hints = changesHints(makeEntry({ hash: 'aaa', parents: ['p1', 'p2'], files: [] }), 'aaa', 'src/app.ts');
    expect(hints).toMatchObject({ ready: true, missingPath: false, rootCommit: false });
  });
});
