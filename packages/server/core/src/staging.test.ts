import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFileDiff } from './diff';
import { runGit } from './exec';
import { getStatus } from './status';
import { applyPatch, checkApplyPatch, cleanUntracked, discardPaths, stagePaths, unstagePaths } from './staging';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 建带一次初始提交的仓库并写入指定文件内容，返回仓库路径 */
function repoWithCommit(file: string, content: string): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  return repo;
}

async function codeOf(repo: string, path: string): Promise<string | undefined> {
  const s = await getStatus(repo);
  return s.entries.find((e) => e.path === path)?.code;
}

describe('staging 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('stagePaths 暂存修改（.M → M.），unstagePaths 撤回（M. → .M）', async () => {
    const repo = repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    expect(await codeOf(repo, 'a.txt')).toBe('.M');

    await stagePaths(repo, ['a.txt']);
    expect((await codeOf(repo, 'a.txt'))?.startsWith('M.')).toBe(true);

    await unstagePaths(repo, ['a.txt']);
    expect(await codeOf(repo, 'a.txt')).toBe('.M');
  });

  it('discardPaths 放弃工作区修改（回到 index 版本）', async () => {
    const repo = repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    expect(await codeOf(repo, 'a.txt')).toBe('.M');

    await discardPaths(repo, ['a.txt']);
    expect(await codeOf(repo, 'a.txt')).toBeUndefined();
  });

  it('cleanUntracked 删除 ?? 未跟踪文件', async () => {
    const repo = repoWithCommit('a.txt', 'v1');
    writeFileSync(join(repo, 'new.txt'), 'n');
    expect(await codeOf(repo, 'new.txt')).toBe('??');

    await cleanUntracked(repo, ['new.txt']);
    expect(existsSync(join(repo, 'new.txt'))).toBe(false);
    expect(await codeOf(repo, 'new.txt')).toBeUndefined();
  });

  it('cleanUntracked 删除未跟踪子目录（porcelain 折叠为 ?? dir/ 条目）', async () => {
    const repo = repoWithCommit('a.txt', 'v1');
    mkdirSync(join(repo, 'sub'));
    writeFileSync(join(repo, 'sub', 'inner.txt'), 'n');
    expect(await codeOf(repo, 'sub/')).toBe('??');

    await cleanUntracked(repo, ['sub/']);
    expect(existsSync(join(repo, 'sub'))).toBe(false);
    expect(await codeOf(repo, 'sub/')).toBeUndefined();
  });

  it('applyPatch --cached 只把指定 hunk 应用到暂存区', async () => {
    // 30 行文件，改第 2 行与第 29 行：默认 3 行上下文下产生两个独立 hunk
    const lines = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`);
    const repo = repoWithCommit('f.txt', `${lines.join('\n')}\n`);
    const modified = [...lines];
    modified[1] = 'top-change';
    modified[28] = 'bottom-change';
    writeFileSync(join(repo, 'f.txt'), `${modified.join('\n')}\n`);

    const full = await collectFileDiff(repo, { file: 'f.txt' });
    const diffLines = full.split('\n');
    const hunkStarts = diffLines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter((i) => i >= 0);
    expect(hunkStarts.length).toBe(2);
    // 手工拼「文件头 + 第二个 hunk」的 patch 文本
    const patch = [...diffLines.slice(0, hunkStarts[0]), ...diffLines.slice(hunkStarts[1])].join('\n');

    await applyPatch(repo, patch, { cached: true });
    const { stdout } = await runGit(['diff', '--cached'], { cwd: repo });
    expect(stdout).toContain('+bottom-change');
    expect(stdout).not.toContain('+top-change');
  });

  it('checkApplyPatch 坏补丁：check 失败即抛，工作区零变更（status 前后一致）', async () => {
    // 夹具：临时 git 仓库，无首提交（apply 只作用于工作区文件，无需 HEAD/身份）
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'f.txt'), 'v1\n');
    const before = await getStatus(repo);
    const badPatch = ['diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt', '@@ -1 +1 @@', '-v9', '+v2'].join('\n') + '\n';

    await expect(checkApplyPatch(repo, badPatch, {})).rejects.toMatchObject({ name: 'GitExitError', exitCode: 1 });
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('v1\n');
    expect(await getStatus(repo)).toEqual(before);
  });

  it('checkApplyPatch 好补丁：check 通过后 apply，文件更新', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'f.txt'), 'v1\n');
    const goodPatch = ['diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt', '@@ -1 +1 @@', '-v1', '+v2'].join('\n') + '\n';

    await checkApplyPatch(repo, goodPatch, {});
    expect(readFileSync(join(repo, 'f.txt'), 'utf8')).toBe('v2\n');
  });
});
