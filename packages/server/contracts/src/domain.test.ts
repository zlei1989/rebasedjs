import { describe, expect, it } from 'vitest';
import type { CommittedEntry, CommittedFileStatus } from './domain';

/**
 * CommittedEntry.files.status 联合的编译期正反例（P3-C 审查裁定补正）：
 * 类型联合无运行时校验，反例以类型级 Assert 表达——联合含 'T' 时 'T' 成立、'X' 不成立，
 * 任一断言违反即 tsc 报错（等价于失败用例）；正例附运行时构造断言。
 */
type Assert<T extends true> = T;
type _hasT = Assert<'T' extends CommittedFileStatus ? true : false>;
type _rejectsX = Assert<'X' extends CommittedFileStatus ? false : true>;

describe('CommittedEntry.files.status（git name-status 码）', () => {
  it('正例：status T（typechange——普通文件→符号链接）可构造契约条目', () => {
    const entry: CommittedEntry = {
      hash: 'h',
      shortHash: 'h',
      subject: 's',
      author: 'a',
      dateIso: '2024-01-01T00:00:00Z',
      files: [{ path: 'f.txt', status: 'T' }],
    };
    expect(entry.files[0].status).toBe('T');
  });
});
