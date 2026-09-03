/** operation 服务测试：真实 git CLI + 临时仓库，验证状态映射与无操作时 INVALID_QUERY 语义。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ServiceError } from '@rebased/contracts';
import { abortOperation, getOperation } from './operation';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args]);
}

/** 造真实 merge 冲突：同 Task 2 手法，main 与 side 改同一行后 merge */
function createMergeConflict(repo: string): void {
  const main = execFileSync('git', ['-C', repo, 'symbolic-ref', 'HEAD', '--short']).toString().trim();
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);
  git(repo, ['checkout', '-b', 'side']);
  writeFileSync(join(repo, 'a.txt'), 'side\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'side']);
  git(repo, ['checkout', main]);
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'main']);
  try {
    git(repo, ['merge', 'side']);
  } catch {
    // merge 冲突以非零退出码结束，忽略
  }
}

describe('operation 服务', () => {
  let repo: string;
  beforeEach(() => { repo = createTmpRepo(); });
  afterEach(() => { cleanupTmpRepo(repo); });

  it('干净仓库 getOperation 返回 { kind: none }', async () => {
    expect(await getOperation(repo)).toEqual({ kind: 'none' });
  });

  it('无进行中操作时 abortOperation 抛 ServiceError(INVALID_QUERY)', async () => {
    await expect(abortOperation(repo)).rejects.toBeInstanceOf(ServiceError);
    await expect(abortOperation(repo)).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '当前没有进行中的操作',
    });
  });

  it('merge 冲突时检测为 merge，abort 后返回 { kind: none }', async () => {
    createMergeConflict(repo);
    expect((await getOperation(repo)).kind).toBe('merge');
    expect(await abortOperation(repo)).toEqual({ kind: 'none' });
  });
});
