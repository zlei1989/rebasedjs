import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitExitError } from './exec';
import { getStatus } from './status';
import { applyStash, dropStash, listStashes, popStash, saveStash, stashToBranch } from './stash';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 夹具无初始提交：stash 需要 HEAD，先造 base 提交 */
function makeBaseCommit(repo: string): void {
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
}

describe('stash 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('空仓库贮藏列表为 []', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    expect(await listStashes(repo)).toEqual([]);
  });

  it('saveStash 带 message 后列表 1 条且工作区干净', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    writeFileSync(join(repo, 'a.txt'), 'changed');

    await saveStash(repo, { message: '暂存一' });

    const list = await listStashes(repo);
    expect(list).toHaveLength(1);
    expect(list[0].index).toBe(0);
    expect(list[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(list[0].message).toContain('暂存一');
    expect(list[0].dateIso).toBeTruthy();
    // 贮藏后工作区干净
    expect((await getStatus(repo)).entries).toEqual([]);
  });

  it('includeUntracked 把未跟踪文件一并贮藏', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    writeFileSync(join(repo, 'a.txt'), 'changed');
    writeFileSync(join(repo, 'new.txt'), 'untracked');

    await saveStash(repo, { includeUntracked: true });

    expect((await getStatus(repo)).entries).toEqual([]);
    const list = await listStashes(repo);
    expect(list).toHaveLength(1);

    // 应用回来：已跟踪修改与未跟踪文件都回归
    await applyStash(repo, 0);
    const entries = (await getStatus(repo)).entries;
    expect(entries.map((e) => e.path).sort()).toEqual(['a.txt', 'new.txt']);
  });

  it('applyStash 后改动回归且贮藏仍在；dropStash 后列表空', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    writeFileSync(join(repo, 'a.txt'), 'changed');
    await saveStash(repo, { message: 'keep-me' });

    await applyStash(repo, 0);
    expect((await getStatus(repo)).entries).toHaveLength(1);
    expect(await listStashes(repo)).toHaveLength(1);

    await dropStash(repo, 0);
    expect(await listStashes(repo)).toEqual([]);
  });

  it('popStash 后改动回归且贮藏消失', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    writeFileSync(join(repo, 'a.txt'), 'changed');
    await saveStash(repo, { message: 'pop-me' });
    expect(await listStashes(repo)).toHaveLength(1);

    await popStash(repo, 0);
    expect((await getStatus(repo)).entries).toHaveLength(1);
    expect(await listStashes(repo)).toEqual([]);
  });

  it('stashToBranch 切到新分支且贮藏消失', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);
    writeFileSync(join(repo, 'a.txt'), 'changed');
    await saveStash(repo, { message: 'to-branch' });

    await stashToBranch(repo, 0, 'stash-branch');
    expect(git(repo, ['symbolic-ref', '--short', 'HEAD'])).toBe('stash-branch');
    expect(await listStashes(repo)).toEqual([]);
  });

  it('无效索引 applyStash rejects GitExitError', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeBaseCommit(repo);

    await expect(applyStash(repo, 9)).rejects.toBeInstanceOf(GitExitError);
  });
});
