/** rebase 功能测试：onto 三态、todo 数据源、交互式变基（清单全量校验 + 预检）、无效 ref 与进行中操作预检。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError } from '@rebased/core';
import { applyAutosquash, checkoutRebase, commitEdit, getRebaseTodo, rebaseBranch, runInteractiveRebaseService } from './rebase';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 建临时仓库并入册（afterAll 统一清理） */
function makeRepo(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  return repo;
}

/** git 快捷执行（返回 stdout） */
function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

/** 夹具无初始提交：造 base 提交（a.txt 单行），返回默认分支名（随 git 版本不同，动态取值） */
function makeBaseCommit(repo: string): string {
  const main = git(repo, ['symbolic-ref', 'HEAD', '--short']).trim();
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return main;
}

/** 造一笔提交：写入 file:content 并 commit -m msg，返回提交哈希 */
function makeCommit(repo: string, file: string, content: string, msg: string): string {
  writeFileSync(join(repo, file), content);
  git(repo, ['add', file]);
  git(repo, ['commit', '-q', '-m', msg]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

/** 三提交装置：base（a.txt）之上依次 one/two/three（各自新增一个文件），返回 base 哈希与提交哈希数组 */
function makeThreeCommitRepo(repo: string): { branch: string; base: string; commits: string[] } {
  const branch = makeBaseCommit(repo);
  const base = git(repo, ['rev-parse', 'HEAD']).trim();
  const commits: string[] = [];
  commits.push(makeCommit(repo, 'one.txt', 'one\n', 'one'));
  commits.push(makeCommit(repo, 'two.txt', 'two\n', 'two'));
  commits.push(makeCommit(repo, 'three.txt', 'three\n', 'three'));
  return { branch, base, commits };
}

/** 冲突装置：base → side 改 a.txt 同一行 → 回主分支再改同一行（配方同 core rebase.test.ts） */
function makeRebaseConflict(repo: string): { branch: string; side: string; main: string } {
  const branch = makeBaseCommit(repo);
  git(repo, ['checkout', '-q', '-b', 'side']);
  const side = makeCommit(repo, 'a.txt', 'side\n', 'side');
  git(repo, ['checkout', '-q', branch]);
  const main = makeCommit(repo, 'a.txt', 'main\n', 'main');
  return { branch, side, main };
}

describe('rebaseBranch', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('side 分支领先：main 上 rebase onto side → success 且历史线性', async () => {
    const repo = makeRepo();
    const branch = makeBaseCommit(repo);
    git(repo, ['checkout', '-q', '-b', 'side']);
    makeCommit(repo, 'side.txt', 'side\n', 'side');
    git(repo, ['checkout', '-q', branch]);
    makeCommit(repo, 'main.txt', 'main\n', 'main');

    const outcome = await rebaseBranch(repo, { onto: 'side' });
    expect(outcome.status).toBe('success');
    // 线性：main' → side → base
    expect(git(repo, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['main', 'side', 'base']);
    expect(git(repo, ['log', '--format=%P', '-1']).trim().split(' ')).toHaveLength(1);
  });

  it('onto 为当前分支、无变化 → up-to-date', async () => {
    const repo = makeRepo();
    const { branch } = makeThreeCommitRepo(repo);
    const before = git(repo, ['rev-parse', 'HEAD']).trim();

    const outcome = await rebaseBranch(repo, { onto: branch });
    expect(outcome.status).toBe('up-to-date');
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(before);
  });

  it('双向改同一行 → conflicts', async () => {
    const repo = makeRepo();
    makeRebaseConflict(repo);

    const outcome = await rebaseBranch(repo, { onto: 'side' });
    expect(outcome.status).toBe('conflicts');
  });

  it('onto 无效 → INVALID_REF（引用不存在或不是提交）', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);

    await expect(rebaseBranch(repo, { onto: 'ghost' })).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '引用不存在或不是提交：ghost',
    });
  });

  it('已有进行中操作（rebase 冲突态）→ OPERATION_IN_PROGRESS', async () => {
    const repo = makeRepo();
    makeRebaseConflict(repo);
    await rebaseBranch(repo, { onto: 'side' }); // 进入 rebase 冲突态

    await expect(rebaseBranch(repo, { onto: 'side' })).rejects.toMatchObject({
      code: 'OPERATION_IN_PROGRESS',
      message: '已有进行中的操作，请先完成或中止',
    });
  });
});

describe('getRebaseTodo', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('反序（旧→新）返回 base..HEAD 全量提交，哈希与主题一一对应', async () => {
    const repo = makeRepo();
    const { base, commits } = makeThreeCommitRepo(repo);

    const todo = await getRebaseTodo(repo, base);
    expect(todo).toEqual([
      { hash: commits[0], subject: 'one' },
      { hash: commits[1], subject: 'two' },
      { hash: commits[2], subject: 'three' },
    ]);
  });

  it('base 无效 → GitExitError 透出（框架层折 GIT_ERROR）', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);

    await expect(getRebaseTodo(repo, 'ghost')).rejects.toBeInstanceOf(GitExitError);
  });
});

describe('runInteractiveRebaseService', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('三提交 pick 中间 drop → success 且中间提交消失', async () => {
    const repo = makeRepo();
    const { base, commits } = makeThreeCommitRepo(repo);

    const outcome = await runInteractiveRebaseService(repo, {
      base,
      entries: [
        { hash: commits[0], action: 'pick' },
        { hash: commits[1], action: 'drop' },
        { hash: commits[2], action: 'pick' },
      ],
    });
    expect(outcome.status).toBe('success');
    expect(git(repo, ['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['three', 'one', 'base']);
    expect(git(repo, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).toContain('one.txt');
    expect(git(repo, ['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).not.toContain('two.txt');
  });

  it('重放 onto side 冲突 → conflicts', async () => {
    const repo = makeRepo();
    const { side, main } = makeRebaseConflict(repo);

    const outcome = await runInteractiveRebaseService(repo, {
      base: side,
      entries: [{ hash: main, action: 'pick' }],
    });
    expect(outcome.status).toBe('conflicts');
  });

  it('entries 缺少一笔（与实际不符：缺）→ INVALID_QUERY 提交清单与仓库实际不符', async () => {
    const repo = makeRepo();
    const { base, commits } = makeThreeCommitRepo(repo);

    await expect(runInteractiveRebaseService(repo, {
      base,
      entries: [
        { hash: commits[0], action: 'pick' },
        { hash: commits[2], action: 'pick' }, // 缺 commits[1]
      ],
    })).rejects.toMatchObject({ code: 'INVALID_QUERY', message: '提交清单与仓库实际不符' });
  });

  it('entries 多出不在区间内的哈希（与实际不符：多）→ INVALID_QUERY', async () => {
    const repo = makeRepo();
    const { base, commits } = makeThreeCommitRepo(repo);

    await expect(runInteractiveRebaseService(repo, {
      base,
      entries: [
        { hash: commits[0], action: 'pick' },
        { hash: commits[1], action: 'pick' },
        { hash: commits[2], action: 'pick' },
        { hash: 'deadbeef', action: 'pick' },
      ],
    })).rejects.toMatchObject({ code: 'INVALID_QUERY', message: '提交清单与仓库实际不符' });
  });

  it('entries 含重复哈希（与实际不符：重复）→ INVALID_QUERY', async () => {
    const repo = makeRepo();
    const { base, commits } = makeThreeCommitRepo(repo);

    await expect(runInteractiveRebaseService(repo, {
      base,
      entries: [
        { hash: commits[0], action: 'pick' },
        { hash: commits[1], action: 'pick' },
        { hash: commits[1], action: 'pick' },
        { hash: commits[2], action: 'pick' },
      ],
    })).rejects.toMatchObject({ code: 'INVALID_QUERY', message: '提交清单与仓库实际不符' });
  });

  it('已有进行中操作 → OPERATION_IN_PROGRESS', async () => {
    const repo = makeRepo();
    const { side, main } = makeRebaseConflict(repo);
    await runInteractiveRebaseService(repo, { base: side, entries: [{ hash: main, action: 'pick' }] }); // 进入冲突态

    await expect(runInteractiveRebaseService(repo, {
      base: side,
      entries: [{ hash: main, action: 'pick' }],
    })).rejects.toMatchObject({ code: 'OPERATION_IN_PROGRESS', message: '已有进行中的操作，请先完成或中止' });
  });
});

describe('applyAutosquash（fixup!/squash! 折入）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('fixup 成功：暂存改动折入目标提交（提交数不变、信息保留）', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);
    const c2 = makeCommit(repo, 'b.txt', 'b1\n', 'c2');
    makeCommit(repo, 'c.txt', 'c1\n', 'c3');
    const c1 = git(repo, ['log', '--format=%H', '--reverse']).trim().split('\n')[0];
    // 暂存 a.txt 改动（a.txt 在目标提交树中存在）
    writeFileSync(join(repo, 'a.txt'), 'base2\n');
    git(repo, ['add', 'a.txt']);

    const result = await applyAutosquash(repo, { hash: c1, action: 'fixup' });

    expect(result.status).toBe('success');
    expect(git(repo, ['rev-list', '--count', 'HEAD']).trim()).toBe('3');
    expect(git(repo, ['log', '--format=%s']).trim().split('\n').reverse()).toEqual(['base', 'c2', 'c3']);
    void c2;
  });

  it('无暂存内容 → INVALID_QUERY（nothing to commit 业务映射）；无效哈希 → INVALID_REF', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);
    const c1 = git(repo, ['rev-parse', 'HEAD']).trim();

    const emptyErr = await applyAutosquash(repo, { hash: c1, action: 'fixup' }).catch((e: unknown) => e);
    expect(emptyErr).toMatchObject({ code: 'INVALID_QUERY', message: expect.stringContaining('没有暂存的变更') });

    const refErr = await applyAutosquash(repo, { hash: 'deadbeef'.repeat(5), action: 'squash' }).catch((e: unknown) => e);
    expect(refErr).toMatchObject({ code: 'INVALID_REF' });
  });
});

describe('commitEdit（单提交编辑直通：reword/drop）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('reword：重写目标提交信息（提交数不变、信息生效）', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);
    makeCommit(repo, 'b.txt', 'b1\n', 'c2');
    const base = git(repo, ['rev-parse', 'HEAD~1']).trim();

    const result = await commitEdit(repo, { hash: base, action: 'reword', message: 'base（重写）' });

    expect(result.status).toBe('success');
    expect(git(repo, ['rev-list', '--count', 'HEAD']).trim()).toBe('2');
    expect(git(repo, ['log', '--format=%s']).trim().split('\n').reverse()).toEqual(['base（重写）', 'c2']);
  });

  it('reword 缺 message → INVALID_QUERY；无效哈希 → INVALID_REF；根提交 squash → INVALID_QUERY', async () => {
    const repo = makeRepo();
    makeBaseCommit(repo);
    const root = git(repo, ['rev-parse', 'HEAD']).trim();

    const msgErr = await commitEdit(repo, { hash: root, action: 'reword' }).catch((e: unknown) => e);
    expect(msgErr).toMatchObject({ code: 'INVALID_QUERY', message: expect.stringContaining('reword 需要新提交信息') });

    const refErr = await commitEdit(repo, { hash: 'deadbeef'.repeat(5), action: 'drop' }).catch((e: unknown) => e);
    expect(refErr).toMatchObject({ code: 'INVALID_REF' });

    const rootErr = await commitEdit(repo, { hash: root, action: 'squash' }).catch((e: unknown) => e);
    expect(rootErr).toMatchObject({ code: 'INVALID_QUERY', message: expect.stringContaining('父提交') });
  });
});

describe('checkoutRebase（检出并变基到当前分支，GitCheckoutWithRebaseAction 语义）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  /** 制造远程跟踪引用 + dummy remote（checkout -b 自动设上游依赖 remote.origin 已配置） */
  function makeRemoteRef(repo: string, name: string, target: string): void {
    git(repo, ['update-ref', `refs/remotes/origin/${name}`, target]);
    git(repo, ['remote', 'add', 'origin', 'https://example.invalid/rebased.git']);
  }

  /** 侧分支装置：base → side 提交（侧文件）→ 回 main → main 提交（主文件），返回 {main, sideHash}；当前在 main */
  function makeDivergentSide(repo: string): { main: string; sideHash: string } {
    const main = makeBaseCommit(repo);
    git(repo, ['checkout', '-q', '-b', 'side']);
    const sideHash = makeCommit(repo, 'side.txt', 'side\n', 'side');
    git(repo, ['checkout', '-q', main]);
    makeCommit(repo, 'main.txt', 'main\n', 'main');
    return { main, sideHash };
  }

  it('本地分支成功：检出 side 并变基到 main → success，当前分支切到 side', async () => {
    const repo = makeRepo();
    makeDivergentSide(repo);

    const outcome = await checkoutRebase(repo, { branch: 'side' });

    expect(outcome.status).toBe('success');
    expect(git(repo, ['symbolic-ref', 'HEAD', '--short']).trim()).toBe('side');
    expect(git(repo, ['show', 'HEAD:main.txt'])).toBe('main\n');
    expect(git(repo, ['show', 'HEAD:side.txt'])).toBe('side\n');
  });

  it('远程分支成功：缺省剥前缀新建本地分支并变基（origin/side → side）', async () => {
    const repo = makeRepo();
    const { sideHash } = makeDivergentSide(repo);
    makeRemoteRef(repo, 'side', sideHash);
    git(repo, ['branch', '-D', 'side']);

    const outcome = await checkoutRebase(repo, { branch: 'origin/side' });

    expect(outcome.status).toBe('success');
    expect(git(repo, ['symbolic-ref', 'HEAD', '--short']).trim()).toBe('side');
    expect(git(repo, ['rev-parse', '--abbrev-ref', 'side@{upstream}']).trim()).toBe('origin/side');
  });

  it('远程分支：localName 指定新本地名（origin/side → side-local）', async () => {
    const repo = makeRepo();
    const { sideHash } = makeDivergentSide(repo);
    makeRemoteRef(repo, 'side', sideHash);
    git(repo, ['branch', '-D', 'side']);

    const outcome = await checkoutRebase(repo, { branch: 'origin/side', localName: 'side-local' });

    expect(outcome.status).toBe('success');
    expect(git(repo, ['symbolic-ref', 'HEAD', '--short']).trim()).toBe('side-local');
  });

  it('远程分支 + 既有同名本地分支且跟踪同一远程 → 检出既有分支（不新建）并变基', async () => {
    const repo = makeRepo();
    const { sideHash } = makeDivergentSide(repo);
    makeRemoteRef(repo, 'side', sideHash);
    // 既有本地 side 已跟踪 origin/side（场景：之前从远程检出的分支）
    git(repo, ['branch', '--set-upstream-to=origin/side', 'side']);

    const outcome = await checkoutRebase(repo, { branch: 'origin/side' });

    expect(outcome.status).toBe('success');
    expect(git(repo, ['symbolic-ref', 'HEAD', '--short']).trim()).toBe('side');
  });

  it('远程分支 + 既有同名本地分支但未跟踪 → INVALID_QUERY（对齐 Java tracking conflict 重命名）', async () => {
    const repo = makeRepo();
    const { sideHash } = makeDivergentSide(repo);
    makeRemoteRef(repo, 'side', sideHash);
    git(repo, ['branch', '-D', 'side']);
    git(repo, ['branch', 'side', sideHash]); // 无上游的本地分支

    await expect(checkoutRebase(repo, { branch: 'origin/side' })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '本地已存在同名分支 side 且未跟踪 origin/side，请选择其他本地分支名',
    });
  });

  it('目标为当前分支 → INVALID_QUERY；远程建议名与当前分支同名 → INVALID_QUERY', async () => {
    const repo = makeRepo();
    const main = makeBaseCommit(repo);
    // 当前分支 self
    git(repo, ['checkout', '-q', '-b', 'self']);
    const selfErr = await checkoutRebase(repo, { branch: 'self' }).catch((e: unknown) => e);
    expect(selfErr).toMatchObject({ code: 'INVALID_QUERY', message: '不能检出并变基当前分支（可先检其他分支）' });

    // 远程 origin/self 剥前缀 == 当前分支名
    git(repo, ['update-ref', 'refs/remotes/origin/self', git(repo, ['rev-parse', 'HEAD']).trim()]);
    git(repo, ['remote', 'add', 'origin', 'https://example.invalid/rebased.git']);
    const currentErr = await checkoutRebase(repo, { branch: 'origin/self' }).catch((e: unknown) => e);
    expect(currentErr).toMatchObject({ code: 'INVALID_QUERY', message: '本地当前分支与新建名相同（self），请选择其他本地分支名' });
    void main;
  });

  it('分支不存在 → INVALID_REF；分离头指针 → INVALID_QUERY', async () => {
    const repo = makeRepo();
    const main = makeBaseCommit(repo);

    const refErr = await checkoutRebase(repo, { branch: 'ghost' }).catch((e: unknown) => e);
    expect(refErr).toMatchObject({ code: 'INVALID_REF', message: '分支不存在：ghost' });

    git(repo, ['checkout', '-q', '--detach', main]);
    const detachedErr = await checkoutRebase(repo, { branch: main }).catch((e: unknown) => e);
    expect(detachedErr).toMatchObject({ code: 'INVALID_QUERY', message: '分离头指针状态不可检出并变基（请先检出分支）' });
  });

  it('已有进行中操作 → OPERATION_IN_PROGRESS', async () => {
    const repo = makeRepo();
    const { side, main } = makeRebaseConflict(repo);
    await rebaseBranch(repo, { onto: side }); // 进入 rebase 冲突态

    await expect(checkoutRebase(repo, { branch: 'side' })).rejects.toMatchObject({
      code: 'OPERATION_IN_PROGRESS',
      message: '已有进行中的操作，请先完成或中止',
    });
    void main;
  });
});
