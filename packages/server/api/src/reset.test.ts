import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyReset, undoCommit } from './reset';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 造两提交仓库（base → second），返回 base 哈希 */
function repoWithTwoCommits(): { repo: string; base: string } {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, 'a.txt'), 'base');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'a.txt'), 'second');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'second']);
  return { repo, base };
}

describe('reset 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('applyReset mixed 到 HEAD~1：返回状态的 headHash 回到 base', async () => {
    const { repo, base } = repoWithTwoCommits();

    const status = await applyReset(repo, { ref: 'HEAD~1', mode: 'mixed' });

    expect(status.headHash).toBe(base);
  });

  it('applyReset 无效 ref → INVALID_REF', async () => {
    const { repo } = repoWithTwoCommits();

    await expect(applyReset(repo, { ref: 'nope', mode: 'soft' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: expect.stringContaining('引用不存在或不是提交'),
    });
  });

  it('undoCommit 回退最近提交且改动保留在暂存区；根提交上再撤销 → INVALID_QUERY', async () => {
    const { repo, base } = repoWithTwoCommits();

    // 撤销 second：HEAD 回到 base，改动保留在暂存区（entries 非空）
    const status = await undoCommit(repo);
    expect(status.headHash).toBe(base);
    expect(status.entries.length).toBeGreaterThan(0);

    // 再撤销一次：base 是根提交，无父提交 → INVALID_QUERY
    await expect(undoCommit(repo)).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: expect.stringContaining('没有可撤销的提交'),
    });
  });
});
