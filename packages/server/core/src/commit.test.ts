import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { amendSpecificCommit, commitStaged, listAmendTargets } from './commit';
import { runGit } from './exec';
import { stagePaths } from './staging';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 写文件 + 提交，返回提交哈希 */
function commitFile(repo: string, file: string, content: string, msg: string): string {
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
  return git(repo, 'rev-parse', 'HEAD');
}

describe('commitStaged', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('提交暂存区并返回 40 位十六进制哈希，提交标题等于 message', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    await stagePaths(repo, ['a.txt']);
    const hash = await commitStaged(repo, { message: 'feat: 初始提交' });
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const { stdout } = await runGit(['log', '-1', '--format=%s'], { cwd: repo });
    expect(stdout.trim()).toBe('feat: 初始提交');
  });

  it('amend 修订上一提交：提交数不变', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'init' });
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'init（修订）', amend: true });
    const { stdout } = await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo });
    expect(stdout.trim()).toBe('1');
    const { stdout: subject } = await runGit(['log', '-1', '--format=%s'], { cwd: repo });
    expect(subject.trim()).toBe('init（修订）');
  });

  it('signOff 追加 Signed-off-by 尾注', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'signed', signOff: true });
    const { stdout } = await runGit(['log', '-1', '--format=%B'], { cwd: repo });
    expect(stdout).toContain('Signed-off-by: Test User <test@example.com>');
  });
});

describe('listAmendTargets（amend 目标候选）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('无远程：排除 HEAD，新→旧列出其余非合并提交（上限 20）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'a1', 'c1');
    const h2 = commitFile(repo, 'b.txt', 'b1', 'c2');
    const h3 = commitFile(repo, 'c.txt', 'c1', 'c3');
    commitFile(repo, 'd.txt', 'd1', 'c4');

    const targets = await listAmendTargets(repo);

    expect(targets.map((t) => t.subject)).toEqual(['c3', 'c2', 'c1']);
    expect(targets.map((t) => t.hash)).toEqual([h3, h2, h1]);
  });

  it('发布过滤：远程可达的提交不出现（push 后 origin/main 祖先被排除）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'a1', 'c1');
    const h2 = commitFile(repo, 'b.txt', 'b1', 'c2');
    commitFile(repo, 'c.txt', 'c1', 'c3');
    commitFile(repo, 'd.txt', 'd1', 'c4');
    // 发布 c1..c2：push 到裸仓库 → 远程跟踪引用 origin/main
    const bare = mkdtempSync(join(tmpdir(), 'rebased-remote-'));
    dirs.push(bare);
    execFileSync('git', ['init', '-q', '--bare', bare]);
    git(repo, 'remote', 'add', 'origin', bare);
    execFileSync('git', ['-C', repo, 'push', '-q', 'origin', `${h2}:refs/heads/main`]);

    const targets = await listAmendTargets(repo);

    // origin/main（c2 及祖先）已发布 → 只剩 c3（c4=HEAD 排除）
    expect(targets.map((t) => t.subject)).toEqual(['c3']);
  });

  it('HEAD/首个合并提交处停止：HEAD=合并 → 空；合并之后的非 HEAD 提交仍可作目标', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'a1', 'c1');
    const main = git(repo, 'symbolic-ref', '--short', 'HEAD');
    git(repo, 'checkout', '-q', '-b', 'side');
    commitFile(repo, 's.txt', 's1', 'side1');
    git(repo, 'checkout', '-q', main);
    git(repo, 'merge', '--no-ff', '-m', 'merge side', 'side');

    // HEAD=合并提交 → 无目标（Java stopAtFirstMergeCommit：走查止于 HEAD）
    expect(await listAmendTargets(repo)).toEqual([]);

    // 合并后继续提交 c5：走查 c5(HEAD 排除) → c4 → 止于 merge → 目标 [c4]
    commitFile(repo, 'e.txt', 'e1', 'c4');
    commitFile(repo, 'f.txt', 'f1', 'c5');
    expect((await listAmendTargets(repo)).map((t) => t.subject)).toEqual(['c4']);
  });
});

describe('amendSpecificCommit（amend 指定历史提交）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('reword 目标提交：目标提交信息重写、提交数不变、目标之后的提交原样重放', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'a1', 'c1');
    commitFile(repo, 'b.txt', 'b1', 'c2');
    commitFile(repo, 'c.txt', 'c1', 'c3');
    const headBefore = git(repo, 'rev-parse', 'HEAD');

    const result = await amendSpecificCommit(repo, { targetHash: git(repo, 'rev-parse', 'HEAD~1'), message: 'c2（重写）' });

    expect(result.status).toBe('success');
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('3');
    expect(git(repo, 'log', '--format=%s').split('\n').reverse()).toEqual(['c1', 'c2（重写）', 'c3']);
    // 历史被重写：HEAD 变化（内容等价）
    expect(git(repo, 'rev-parse', 'HEAD')).not.toBe(headBefore);
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('c3');
  });

  it('amend 到目标（带暂存改动）：改动折入目标提交；目标之后的提交树保持最终状态', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'a1', 'c1');
    commitFile(repo, 'b.txt', 'b1', 'c2');
    commitFile(repo, 'c.txt', 'c1', 'c3');
    const target = git(repo, 'rev-parse', 'HEAD~1');
    // 暂存 b.txt 改动（amend 提交携带）
    writeFileSync(join(repo, 'b.txt'), 'b2');
    await stagePaths(repo, ['b.txt']);

    const result = await amendSpecificCommit(repo, { targetHash: target, message: 'c2 + 改动' });

    expect(result.status).toBe('success');
    const hashes = git(repo, 'log', '--format=%H', '--reverse').split('\n');
    expect(git(repo, 'show', `${hashes[1]}:b.txt`)).toBe('b2');
    expect(git(repo, 'show', `${hashes[2]}:b.txt`)).toBe('b2');
    expect(git(repo, 'show', 'HEAD:b.txt')).toBe('b2');
    expect(git(repo, 'log', '--format=%s').split('\n').reverse()).toEqual(['c1', 'c2 + 改动', 'c3']);
  });

  it('冲突：折入目标与中间提交改动冲突 → status conflicts（rebase 冲突态交冲突页）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'v1', 'c1');
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'c2' }); // 目标：a.txt=v2
    writeFileSync(join(repo, 'a.txt'), 'v3');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'c3' }); // 中间：a.txt=v3
    // 暂存 v3→v4：amend 提交 diff 的上下文（v3）与目标树（v2）不匹配 → 折入冲突
    writeFileSync(join(repo, 'a.txt'), 'v4');
    await stagePaths(repo, ['a.txt']);
    const target = git(repo, 'rev-parse', 'HEAD~1');

    const result = await amendSpecificCommit(repo, { targetHash: target, message: 'c2（冲突）' });

    expect(result.status).toBe('conflicts');
    // 冲突态：rebase 进行中（交冲突页 continue/abort 流）
    expect(git(repo, 'status', '--porcelain')).not.toBe('');
  });
});
