/** rebase 原语测试：onto 成功/已最新/冲突、TODO 列表、交互式（drop/squash/fixup/reword/重排）、继续变基、auto-squash。
 *  性能：8 种夹具形状在 beforeAll 用真实 git 各建一次模板，用例经 instantiateFixture 复制
 *  （0 spawn；本机单次 git spawn ~330ms，历史每用例 4-14 次 spawn 搭夹具）。 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';
import {
  autosquashCommit,
  checkoutWithRebase,
  continueRebase,
  editCommitAction,
  listTodoCommits,
  rebaseOnto,
  runInteractiveRebase,
  skipRebase,
} from './rebase';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（describe 级 afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
  dirs.push(repo);
  return repo;
}

/** 造 base 提交（a.txt 单行），返回默认分支名（随 git 版本不同，动态取值） */
async function makeBaseCommit(repo: string): Promise<string> {
  const { stdout } = await runGit(['symbolic-ref', 'HEAD', '--short'], { cwd: repo });
  const main = stdout.trim();
  await writeFile(join(repo, 'a.txt'), 'base\n');
  await runGit(['add', 'a.txt'], { cwd: repo });
  await runGit(['commit', '-m', 'base'], { cwd: repo });
  return main;
}

/** 造一笔提交：写入 file:content 并 commit -m msg，返回提交哈希 */
async function makeCommit(repo: string, file: string, content: string, msg: string): Promise<string> {
  await writeFile(join(repo, file), content);
  await runGit(['add', file], { cwd: repo });
  await runGit(['commit', '-m', msg], { cwd: repo });
  return (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
}

/** 三提交装置：base（a.txt）之上依次 one/two/three（各自新增一个文件），返回 base 哈希与提交哈希数组 */
async function makeThreeCommitRepo(repo: string): Promise<{ branch: string; base: string; commits: string[] }> {
  const branch = await makeBaseCommit(repo);
  const base = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();
  const commits: string[] = [];
  commits.push(await makeCommit(repo, 'one.txt', 'one\n', 'one'));
  commits.push(await makeCommit(repo, 'two.txt', 'two\n', 'two'));
  commits.push(await makeCommit(repo, 'three.txt', 'three\n', 'three'));
  return { branch, base, commits };
}

/** 冲突装置：base → side 改 a.txt 同一行 → 回主分支再改同一行（合并配方来自 P2-A/P2-E） */
async function makeRebaseConflict(repo: string): Promise<void> {
  const branch = await makeBaseCommit(repo);
  await runGit(['checkout', '-b', 'side'], { cwd: repo });
  await makeCommit(repo, 'a.txt', 'side\n', 'side');
  await runGit(['checkout', branch], { cwd: repo });
  await makeCommit(repo, 'a.txt', 'main\n', 'main');
}

/** 当前 HEAD 的主题列表（新→旧） */
async function headSubjects(repo: string, count: number): Promise<string[]> {
  const { stdout } = await runGit(['log', '--format=%s', `-${count}`], { cwd: repo });
  return stdout.trim().split('\n');
}

/** 制造远程跟踪引用 refs/remotes/origin/<name>（无真实远程；core 原语只依赖跟踪引用）。
 *  另补一条 dummy remote：checkout -b 从远程跟踪引用新建时的自动设上游依赖 remote.origin 已配置（真实环境必有） */
async function makeRemoteRef(repo: string, name: string, target: string): Promise<void> {
  await runGit(['update-ref', `refs/remotes/origin/${name}`, target], { cwd: repo });
  await runGit(['remote', 'add', 'origin', 'https://example.invalid/rebased.git'], { cwd: repo });
}

// ---- 夹具模板：beforeAll 各建一次；templateDirs 由文件级 afterAll 清理（不与各 describe 的 dirs 混清，避免提前删除） ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';
let threeTemplate = '';
let three: { branch: string; base: string; commits: string[] } = { branch: '', base: '', commits: [] };
let conflictTemplate = '';
let baseSideMainTemplate = '';
let remoteSideTemplate = '';
let defaultBranch = '';
let c3Template = '';
let c3Hashes: string[] = [];
let cAConflictTemplate = '';
let cAConflictC1 = '';
let c2Template = '';
let c2Hash = '';

beforeAll(async () => {
  // ① 仅 base 提交（顺带捕获默认分支名，各模板同 git 环境同名）
  baseTemplate = createTmpRepo();
  defaultBranch = await makeBaseCommit(baseTemplate);
  // ② base + one/two/three
  threeTemplate = createTmpRepo();
  three = await makeThreeCommitRepo(threeTemplate);
  // ③ base → side 改 a.txt → main 改 a.txt（冲突配方）
  conflictTemplate = createTmpRepo();
  await makeRebaseConflict(conflictTemplate);
  // ④ base；side 分支 + side.txt；回 main + main.txt（线性两分支）
  baseSideMainTemplate = createTmpRepo();
  const bsmMain = await makeBaseCommit(baseSideMainTemplate);
  await runGit(['checkout', '-b', 'side'], { cwd: baseSideMainTemplate });
  await makeCommit(baseSideMainTemplate, 'side.txt', 'side\n', 'side');
  await runGit(['checkout', bsmMain], { cwd: baseSideMainTemplate });
  await makeCommit(baseSideMainTemplate, 'main.txt', 'main\n', 'main');
  // ⑤ 远程跟踪引用形态：origin/side 指向 side 提交、本地 side 已删、main 上有 main.txt
  remoteSideTemplate = createTmpRepo();
  await makeBaseCommit(remoteSideTemplate);
  await runGit(['checkout', '-b', 'side'], { cwd: remoteSideTemplate });
  const rSide = await makeCommit(remoteSideTemplate, 'side.txt', 'side\n', 'side');
  await makeRemoteRef(remoteSideTemplate, 'side', rSide);
  await runGit(['checkout', defaultBranch], { cwd: remoteSideTemplate });
  await runGit(['branch', '-D', 'side'], { cwd: remoteSideTemplate });
  await makeCommit(remoteSideTemplate, 'main.txt', 'main\n', 'main');
  // ⑥ c1/c2/c3 三提交（各一文件：a/b/c）
  c3Template = createTmpRepo();
  c3Hashes = [
    await makeCommit(c3Template, 'a.txt', 'v1\n', 'c1'),
    await makeCommit(c3Template, 'b.txt', 'b1\n', 'c2'),
    await makeCommit(c3Template, 'c.txt', 'c1\n', 'c3'),
  ];
  // ⑦ 同文件三提交（autosquash 折入冲突配方；c1 = 最旧提交哈希）
  cAConflictTemplate = createTmpRepo();
  await makeCommit(cAConflictTemplate, 'a.txt', 'v1\n', 'c1');
  await makeCommit(cAConflictTemplate, 'a.txt', 'v2\n', 'c2');
  await makeCommit(cAConflictTemplate, 'a.txt', 'v3\n', 'c3');
  cAConflictC1 = (await runGit(['log', '--format=%H', '--reverse'], { cwd: cAConflictTemplate })).stdout.trim().split('\n')[0];
  // ⑧ c1 + c2 两提交（editCommitAction fixup 配方）
  c2Template = createTmpRepo();
  await makeCommit(c2Template, 'a.txt', 'v1\n', 'c1');
  c2Hash = await makeCommit(c2Template, 'b.txt', 'b1\n', 'c2');
  templateDirs.push(baseTemplate, threeTemplate, conflictTemplate, baseSideMainTemplate, remoteSideTemplate, c3Template, cAConflictTemplate, c2Template);
});

describe('rebaseOnto', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('side 分支领先：main 上 rebase onto side → success 且历史线性（main 提交重放到 side 之上）', async () => {
    const repo = instantiate(baseSideMainTemplate);

    const result = await rebaseOnto(repo, { onto: 'side' });
    expect(result.status).toBe('success');

    // 线性：main' → side → base（无合并提交），且两文件都在 HEAD 树中
    expect(await headSubjects(repo, 3)).toEqual(['main', 'side', 'base']);
    const { stdout: parents } = await runGit(['log', '--format=%P', '-1'], { cwd: repo });
    expect(parents.trim().split(' ')).toHaveLength(1);
    expect((await runGit(['show', 'HEAD:side.txt'], { cwd: repo })).stdout).toBe('side\n');
    expect((await runGit(['show', 'HEAD:main.txt'], { cwd: repo })).stdout).toBe('main\n');
  });

  it('onto 为当前分支、无变化 → up-to-date 且 HEAD 未移动', async () => {
    const repo = instantiate(threeTemplate);
    const before = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    const result = await rebaseOnto(repo, { onto: three.branch });
    expect(result.status).toBe('up-to-date');
    expect((await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim()).toBe(before);
  });

  it('双向改同一行 → conflicts 且操作态为 rebase（含 step/total）', async () => {
    const repo = instantiate(conflictTemplate);

    const result = await rebaseOnto(repo, { onto: 'side' });
    expect(result.status).toBe('conflicts');
    // merge 后端写 rebase-merge/msgnum+end：重放 1 笔提交时冲突在第 1 步
    expect(await getOperationState(repo)).toEqual({ kind: 'rebase', step: 1, total: 1 });
  });

  it('无效 onto 原样抛 GitExitError 且不进入 rebase 态', async () => {
    const repo = instantiate(baseTemplate);

    await expect(rebaseOnto(repo, { onto: 'ghost' })).rejects.toBeInstanceOf(GitExitError);
    expect((await getOperationState(repo)).kind).toBe('none');
  });
});

describe('listTodoCommits', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('反序（旧→新）返回 base..HEAD 全量提交，哈希与主题一一对应', async () => {
    const repo = instantiate(threeTemplate);

    const todo = await listTodoCommits(repo, three.base);
    expect(todo).toEqual([
      { hash: three.commits[0], subject: 'one' },
      { hash: three.commits[1], subject: 'two' },
      { hash: three.commits[2], subject: 'three' },
    ]);
  });
});

describe('runInteractiveRebase', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('三提交 pick 中间 drop → 中间提交消失，前后两提交保留', async () => {
    const repo = instantiate(threeTemplate);

    const result = await runInteractiveRebase(repo, {
      base: three.base,
      entries: [
        { hash: three.commits[0], action: 'pick' },
        { hash: three.commits[1], action: 'drop' },
        { hash: three.commits[2], action: 'pick' },
      ],
    });
    expect(result.status).toBe('success');

    expect(await headSubjects(repo, 3)).toEqual(['three', 'one', 'base']);
    const { stdout: ls } = await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo });
    expect(ls.split('\n')).toContain('one.txt');
    expect(ls.split('\n')).not.toContain('two.txt');
  });

  it('两提交 squash → 合并为一笔（base..HEAD 仅 1 提交，单父）', async () => {
    const repo = instantiate(threeTemplate);

    const result = await runInteractiveRebase(repo, {
      base: three.base,
      entries: [
        { hash: three.commits[0], action: 'pick' },
        { hash: three.commits[1], action: 'squash' },
      ],
    });
    expect(result.status).toBe('success');

    const { stdout: count } = await runGit(['rev-list', '--count', `${three.base}..HEAD`], { cwd: repo });
    expect(count.trim()).toBe('1');
    const { stdout: parents } = await runGit(['log', '--format=%P', '-1'], { cwd: repo });
    expect(parents.trim().split(' ')).toHaveLength(1);
  });

  it('fixup 并入上一提交 → 合并为一笔且主题沿用被并入提交', async () => {
    const repo = instantiate(threeTemplate);

    const result = await runInteractiveRebase(repo, {
      base: three.base,
      entries: [
        { hash: three.commits[0], action: 'pick' },
        { hash: three.commits[1], action: 'fixup' },
      ],
    });
    expect(result.status).toBe('success');

    const { stdout: count } = await runGit(['rev-list', '--count', `${three.base}..HEAD`], { cwd: repo });
    expect(count.trim()).toBe('1');
    // fixup 不产生独立消息，主题恒为被并入提交的 'one'
    const { stdout: subject } = await runGit(['log', '--format=%s', '-1'], { cwd: repo });
    expect(subject.trim()).toBe('one');
  });

  it('reword 在 core.editor=true 防护下不改信息 → 结果等于 pick', async () => {
    const repo = instantiate(threeTemplate);

    const result = await runInteractiveRebase(repo, {
      base: three.base,
      entries: [{ hash: three.commits[0], action: 'reword' }],
    });
    expect(result.status).toBe('success');
    expect(await headSubjects(repo, 2)).toEqual(['one', 'base']);
  });

  it('重排：两提交交换 → log 顺序反转（先应用 two 再 one）', async () => {
    const repo = instantiate(threeTemplate);

    const result = await runInteractiveRebase(repo, {
      base: three.base,
      entries: [
        { hash: three.commits[1], action: 'pick' },
        { hash: three.commits[0], action: 'pick' },
      ],
    });
    expect(result.status).toBe('success');
    expect(await headSubjects(repo, 3)).toEqual(['one', 'two', 'base']);
  });
});

describe('continueRebase', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('冲突解决后继续 → 完成变基且操作态回到 none', async () => {
    const repo = instantiate(conflictTemplate);
    expect((await rebaseOnto(repo, { onto: 'side' })).status).toBe('conflicts');

    // 手工解决：写最终内容 + add 标记已解决
    await writeFile(join(repo, 'a.txt'), 'resolved\n');
    await runGit(['add', 'a.txt'], { cwd: repo });
    await continueRebase(repo);

    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
    expect(await headSubjects(repo, 3)).toEqual(['main', 'side', 'base']);
    expect((await runGit(['show', 'HEAD:a.txt'], { cwd: repo })).stdout).toBe('resolved\n');
  });

  it('skipRebase：冲突时跳过当前提交（其变更被丢弃），继续后续提交且操作态回到 none', async () => {
    const repo = instantiate(conflictTemplate);
    expect((await rebaseOnto(repo, { onto: 'side' })).status).toBe('conflicts');
    expect((await getOperationState(repo)).kind).toBe('rebase');

    await skipRebase(repo);

    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
    // 变基链重放到 side 之上（main 提交被跳过——冲突提交放弃，无合并提交）
    expect(await headSubjects(repo, 2)).toEqual(['side', 'base']);
  });
});

describe('autosquashCommit（fixup!/squash! 折入，GitAutoSquashCommitAction 语义）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('fixup：暂存改动折入同主题目标提交（目标信息保留、提交数不变、后续提交原样）', async () => {
    const repo = instantiate(c3Template);
    const base = c3Hashes[0];
    // 暂存 a.txt 改动（fixup 提交携带；a.txt 在目标提交树中存在）
    await writeFile(join(repo, 'a.txt'), 'v2\n');
    await runGit(['add', 'a.txt'], { cwd: repo });

    const result = await autosquashCommit(repo, { hash: base, action: 'fixup' });

    expect(result.status).toBe('success');
    // 提交数不变（fixup 折入 → 3 条）
    const count = (await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim();
    expect(count).toBe('3');
    // 目标提交信息保留（fixup 语义）；内容包含暂存改动
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    expect(subjects).toEqual(['c1', 'c2', 'c3']);
    const newBase = (await runGit(['log', '--format=%H', '--reverse'], { cwd: repo })).stdout.trim().split('\n')[0];
    expect((await runGit(['show', `${newBase}:a.txt`], { cwd: repo })).stdout).toBe('v2\n');
    // 后续提交重放：最终树上 b.txt/c.txt 仍在
    expect((await runGit(['show', 'HEAD:b.txt'], { cwd: repo })).stdout).toBe('b1\n');
    expect((await runGit(['show', 'HEAD:c.txt'], { cwd: repo })).stdout).toBe('c1\n');
  });

  it('squash：目标提交信息 = 原信息（消息编辑器 shim 覆写 %B）、提交数不变', async () => {
    const repo = instantiate(c3Template);
    const base = c3Hashes[0];
    await writeFile(join(repo, 'a.txt'), 'v3\n');
    await runGit(['add', 'a.txt'], { cwd: repo });

    const result = await autosquashCommit(repo, { hash: base, action: 'squash' });

    expect(result.status).toBe('success');
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('3');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    // squash 后信息 = 目标提交原文（shim 覆写；无 "squash! " 前缀残留）
    expect(subjects).toEqual(['c1', 'c2', 'c3']);
    const newBase = (await runGit(['log', '--format=%H', '--reverse'], { cwd: repo })).stdout.trim().split('\n')[0];
    expect((await runGit(['show', `${newBase}:a.txt`], { cwd: repo })).stdout).toBe('v3\n');
  });

  it('冲突：折入目标与中间提交同文件改动 → status conflicts（rebase 冲突态）', async () => {
    const repo = instantiate(cAConflictTemplate);
    const c1 = cAConflictC1;
    // 暂存 v3→v4：fixup 提交 diff（v3 上下文）折入目标（v1）→ context 不匹配冲突
    await writeFile(join(repo, 'a.txt'), 'v4\n');
    await runGit(['add', 'a.txt'], { cwd: repo });

    const result = await autosquashCommit(repo, { hash: c1, action: 'fixup' });

    expect(result.status).toBe('conflicts');
    expect((await getOperationState(repo)).kind).toBe('rebase');
  });

  it('无暂存内容：git commit 报错透出（GitExitError）', async () => {
    const repo = instantiate(c3Template);
    const base = c3Hashes[0];

    await expect(autosquashCommit(repo, { hash: base, action: 'fixup' })).rejects.toMatchObject({
      name: 'GitExitError',
    });
  });
});

describe('editCommitAction（GitSingleCommitEditingAction 语义：reword/drop/squash/fixup 直通）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('reword：目标提交信息重写（消息 shim 覆写）、其余提交原样、提交数不变', async () => {
    const repo = instantiate(c3Template);
    const c2 = c3Hashes[1];

    const result = await editCommitAction(repo, { hash: c2, action: 'reword', message: 'c2（重写）' });

    expect(result.status).toBe('success');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    expect(subjects).toEqual(['c1', 'c2（重写）', 'c3']);
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('3');
    // 重写后的提交树不变（b.txt 仍在）
    const newC2 = (await runGit(['log', '--format=%H', '--reverse'], { cwd: repo })).stdout.trim().split('\n')[1];
    expect((await runGit(['show', `${newC2}:b.txt`], { cwd: repo })).stdout).toBe('b1\n');
  });

  it('drop：目标提交消失（变更一并丢弃）、其余提交原样、提交数 -1', async () => {
    const repo = instantiate(c3Template);
    const c2 = c3Hashes[1];

    const result = await editCommitAction(repo, { hash: c2, action: 'drop' });

    expect(result.status).toBe('success');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    expect(subjects).toEqual(['c1', 'c3']);
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('2');
    expect((await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo })).stdout).not.toContain('b.txt');
  });

  it('fixup：目标并入父提交（提交数 -1、父主题保留、内容合并）', async () => {
    const repo = instantiate(c2Template);
    const c2 = c2Hash;

    const result = await editCommitAction(repo, { hash: c2, action: 'fixup' });

    expect(result.status).toBe('success');
    const subjects = (await runGit(['log', '--format=%s'], { cwd: repo })).stdout.trim().split('\n').reverse();
    // fixup 并入父：提交数 -1，父（c1）信息保留
    expect(subjects).toEqual(['c1']);
    expect((await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo })).stdout.trim()).toBe('1');
    expect((await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: repo })).stdout).toContain('b.txt');
  });
});

describe('checkoutWithRebase（GitCheckoutWithRebaseAction 语义：检出并变基到当前分支）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('本地分支：检出 side 并 rebase onto 当前 main → success，当前分支切到 side 且 main 新提交重放其历史', async () => {
    const repo = instantiate(baseSideMainTemplate);
    const mainHead = (await runGit(['rev-parse', 'HEAD'], { cwd: repo })).stdout.trim();

    const result = await checkoutWithRebase(repo, { branch: 'side', isRemote: false });

    expect(result.status).toBe('success');
    expect((await runGit(['symbolic-ref', 'HEAD', '--short'], { cwd: repo })).stdout.trim()).toBe('side');
    // side 重放到 main 之上：两个新文件都在 HEAD 树中
    expect((await runGit(['show', 'HEAD:side.txt'], { cwd: repo })).stdout).toBe('side\n');
    expect((await runGit(['show', 'HEAD:main.txt'], { cwd: repo })).stdout).toBe('main\n');
    // 变基只动 side：main 尖保持原样
    expect((await runGit(['rev-parse', defaultBranch], { cwd: repo })).stdout.trim()).toBe(mainHead);
  });

  it('远程分支：缺省剥前缀新建本地分支（origin/side → side）检出并变基，成功后新分支自动跟踪远程', async () => {
    const repo = instantiate(remoteSideTemplate);

    const result = await checkoutWithRebase(repo, { branch: 'origin/side', isRemote: true });

    expect(result.status).toBe('success');
    expect((await runGit(['symbolic-ref', 'HEAD', '--short'], { cwd: repo })).stdout.trim()).toBe('side');
    // 从远程跟踪引用新建 → 自动设上游（branch.autoSetupMerge 默认行为）
    expect((await runGit(['rev-parse', '--abbrev-ref', 'side@{upstream}'], { cwd: repo })).stdout.trim()).toBe('origin/side');
    expect((await runGit(['show', 'HEAD:main.txt'], { cwd: repo })).stdout).toBe('main\n');
    expect((await runGit(['show', 'HEAD:side.txt'], { cwd: repo })).stdout).toBe('side\n');
  });

  it('远程分支：localName 指定新本地名 → 检出并变基到当前', async () => {
    const repo = instantiate(remoteSideTemplate);

    const result = await checkoutWithRebase(repo, { branch: 'origin/side', isRemote: true, localName: 'side-local' });

    expect(result.status).toBe('success');
    expect((await runGit(['symbolic-ref', 'HEAD', '--short'], { cwd: repo })).stdout.trim()).toBe('side-local');
    expect((await runGit(['rev-parse', '--abbrev-ref', 'side-local@{upstream}'], { cwd: repo })).stdout.trim()).toBe('origin/side');
  });

  it('冲突：双向改同一行 → conflicts 且进入 rebase 操作态（交冲突页 continue/abort）', async () => {
    const repo = instantiate(conflictTemplate);

    const result = await checkoutWithRebase(repo, { branch: 'side', isRemote: false });

    expect(result.status).toBe('conflicts');
    expect((await getOperationState(repo)).kind).toBe('rebase');
  });

  it('分离头指针 → 直接拒绝（无当前分支不可 rebase onto current）', async () => {
    const repo = instantiate(remoteSideTemplate);
    await runGit(['checkout', '--detach', defaultBranch], { cwd: repo });

    await expect(checkoutWithRebase(repo, { branch: 'origin/side', isRemote: true })).rejects.toMatchObject({
      message: '分离头指针状态下不可检出并变基（请先检出分支）',
    });
  });
});
