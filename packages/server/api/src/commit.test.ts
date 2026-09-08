import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCommitIdentity, commitAndPush, createCommit } from './commit';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function track(dir: string): string {
  dirs.push(dir);
  return dir;
}

/** git 执行（stdout 返回） */
function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

/** 造初始提交并返回当前分支名（配方同 remote 测试） */
function makeBaseCommit(repo: string): string {
  writeFileSync(join(repo, 'a.txt'), 'v1');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return git(repo, ['symbolic-ref', '--short', 'HEAD']);
}

/** 裸仓库对端装置：本地仓库 + bare 当 origin + push -u 建 upstream（配方同 remote 测试） */
function makeRemoteRig(): { repo: string; bare: string; defaultBranch: string } {
  const repo = track(createTmpRepo()); // fixture 已预置 user.name/user.email
  const defaultBranch = makeBaseCommit(repo);
  const bare = track(mkdtempSync(join(tmpdir(), 'rebased-api-bare-')));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', '-u', 'origin', defaultBranch]);
  git(bare, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repo, bare, defaultBranch };
}

describe('commit 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('createCommit 提交暂存区并返回新哈希', async () => {
    const repo = createTmpRepo(); // fixture 已预置 user.name/user.email
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    const { hash } = await createCommit(repo, { message: '测试提交' });
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    expect(subject).toBe('测试提交');
  });

  it('assertCommitIdentity 缺 user.name 或 user.email 时抛 INVALID_QUERY', () => {
    const missing = [
      { key: 'user.name', value: null, localValue: null },
      { key: 'user.email', value: 'a@b.c', localValue: 'a@b.c' },
    ];
    expect(() => assertCommitIdentity(missing)).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUERY', message: '未配置 user.name 或 user.email，请先在设置页配置' }),
    );
    const missingEmail = [
      { key: 'user.name', value: 'Test', localValue: 'Test' },
      { key: 'user.email', value: null, localValue: null },
    ];
    expect(() => assertCommitIdentity(missingEmail)).toThrowError(expect.objectContaining({ code: 'INVALID_QUERY' }));
  });

  it('assertCommitIdentity 生效值齐全时不抛', () => {
    const ok = [
      { key: 'user.name', value: 'Test', localValue: null },
      { key: 'user.email', value: 'a@b.c', localValue: null },
    ];
    expect(() => assertCommitIdentity(ok)).not.toThrow();
  });
});

describe('commitAndPush 组合执行器（GitCommitAndPushExecutor 语义）', () => {
  it('提交 + 推送：commit 落盘且推送到上游（pushed），outcome 含哈希与 push 三态结果', async () => {
    const { repo, bare, defaultBranch } = makeRemoteRig();
    writeFileSync(join(repo, 'a.txt'), 'v2'); // a.txt 已提交 v1（init），改 v2 产生真变更
    execFileSync('git', ['-C', repo, 'add', '.']);

    const outcome = await commitAndPush(repo, { message: '组合提交' });
    expect(outcome.commit.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(outcome.push.status).toBe('pushed');
    // 对端 HEAD 同步了新提交
    expect(execFileSync('git', ['-C', bare, 'rev-parse', defaultBranch], { encoding: 'utf8' }).trim()).toBe(
      outcome.commit.hash,
    );
  });

  it('无上游分支且未带 push 载荷：push 失败透出（提交已落盘——非原子语义）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);

    let err: unknown;
    try {
      await commitAndPush(repo, { message: '无上游提交' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    // 提交已落盘（非原子：推送失败不影响 commit 结果）
    const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    expect(subject).toBe('无上游提交');
  });

  it('分叉后推送：commit 成功 + push.status=rejected（业务结果非错误）', async () => {
    const { repo, bare, defaultBranch } = makeRemoteRig();
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    // 对端前进一个提交（分叉）：clone 裸仓库 → 提交 → 推回默认分支
    const wc = track(mkdtempSync(join(tmpdir(), 'rebased-api-other-')));
    execFileSync('git', ['clone', '-q', bare, wc]);
    git(wc, ['config', 'user.email', 't@e.c']);
    git(wc, ['config', 'user.name', 'Other']);
    writeFileSync(join(wc, 'b.txt'), 'remote');
    git(wc, ['add', 'b.txt']);
    git(wc, ['commit', '-q', '-m', 'remote']);
    git(wc, ['push', '-q', 'origin', `HEAD:${defaultBranch}`]);

    const outcome = await commitAndPush(repo, { message: '分叉提交' });
    expect(outcome.push.status).toBe('rejected');
    expect(outcome.push.hint).toContain('先拉取');
    // 提交已落盘（拒绝推送不撤销 commit）
    const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    expect(subject).toBe('分叉提交');
  });
});
