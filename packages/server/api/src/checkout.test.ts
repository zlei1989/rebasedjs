import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCheckout } from './checkout';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 造一个带初始提交的仓库（a.txt 提交为 init） */
function repoWithCommit(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, 'a.txt'), 'v1');
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  return repo;
}

describe('checkout 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('applyCheckout branch 检出既有分支，返回刷新后的 RepoStatus.branch', async () => {
    const repo = repoWithCommit();
    execFileSync('git', ['-C', repo, 'branch', 'dev']);
    const status = await applyCheckout(repo, { action: 'branch', name: 'dev' });
    expect(status.branch).toBe('dev');
  });

  it('applyCheckout branch 分支不存在 → INVALID_REF', async () => {
    const repo = repoWithCommit();
    await expect(applyCheckout(repo, { action: 'branch', name: 'nope' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: expect.stringContaining('分支不存在'),
    });
  });

  it('applyCheckout newBranch 新建并检出', async () => {
    const repo = repoWithCommit();
    const status = await applyCheckout(repo, { action: 'newBranch', name: 'feat-new' });
    expect(status.branch).toBe('feat-new');
  });

  it('applyCheckout newBranch 重名 → INVALID_QUERY', async () => {
    const repo = repoWithCommit();
    execFileSync('git', ['-C', repo, 'branch', 'dev']);
    await expect(applyCheckout(repo, { action: 'newBranch', name: 'dev' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: expect.stringContaining('分支已存在'),
    });
  });

  it('applyCheckout detach 检出提交哈希后 headHash 不变', async () => {
    const repo = repoWithCommit();
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const status = await applyCheckout(repo, { action: 'detach', ref: head });
    expect(status.headHash).toBe(head);
  });
});
