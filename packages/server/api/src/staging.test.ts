import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyHunkStaging, applyStaging } from './staging';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 造一个带初始提交的仓库：file 以 content 提交为 init */
function repoWithCommit(file: string, content: string): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  return repo;
}

describe('staging 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('applyStaging stage 已跟踪修改，返回状态含 M. 条目', async () => {
    const repo = repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const status = await applyStaging(repo, { action: 'stage', paths: ['a.txt'] });
    const entry = status.entries.find((e) => e.path === 'a.txt');
    expect(entry?.code.startsWith('M.')).toBe(true);
  });

  it('applyStaging discard 混合路径：未跟踪删除、已跟踪还原', async () => {
    const repo = repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    writeFileSync(join(repo, 'b.txt'), 'new');
    const status = await applyStaging(repo, { action: 'discard', paths: ['a.txt', 'b.txt'] });
    expect(status.entries).toEqual([]);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('v1');
    expect(existsSync(join(repo, 'b.txt'))).toBe(false);
  });

  it('applyHunkStaging stage/unstage/discard 指定 hunk', async () => {
    // 20 行文件，改第 2 行与第 18 行（间距 > 2×上下文 3 行，保证切成两个 hunk）
    const base = Array.from({ length: 20 }, (_, i) => `line-${String(i + 1).padStart(2, '0')}`).join('\n') + '\n';
    const repo = repoWithCommit('a.txt', base);
    const modified = base.replace('line-02', 'first-change').replace('line-18', 'second-change');
    writeFileSync(join(repo, 'a.txt'), modified);

    // stage 第二处（工作区 diff 的 hunk 索引 1）
    await applyHunkStaging(repo, { action: 'stage', file: 'a.txt', hunks: [1] });
    const cached = execFileSync('git', ['-C', repo, 'diff', '--cached', '--', 'a.txt'], { encoding: 'utf8' });
    expect(cached).toContain('+second-change');
    expect(cached).not.toContain('+first-change');

    // unstage 回退：暂存 diff 此刻只含这一个 hunk，索引为 0
    await applyHunkStaging(repo, { action: 'unstage', file: 'a.txt', hunks: [0] });
    const cached2 = execFileSync('git', ['-C', repo, 'diff', '--cached', '--', 'a.txt'], { encoding: 'utf8' });
    expect(cached2).toBe('');

    // discard 工作区第一处：该 hunk 还原，第二处保留
    await applyHunkStaging(repo, { action: 'discard', file: 'a.txt', hunks: [0] });
    const content = readFileSync(join(repo, 'a.txt'), 'utf8');
    expect(content).not.toContain('first-change');
    expect(content).toContain('second-change');

    // 索引越界 → INVALID_QUERY
    await expect(applyHunkStaging(repo, { action: 'stage', file: 'a.txt', hunks: [99] }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
});
