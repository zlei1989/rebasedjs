/** update 服务测试：updateProject merge/rebase 策略、forcePushedUpdate 强推修复。
 *  性能：裸仓库 rig 在 beforeAll 建一次模板，用例复制 repo/bare 并以文本替换修正 origin URL（0 spawn）。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';
import { forcePushedUpdate, updateProject } from './update';

const dirs: string[] = [];

/** 裸仓库装置的用例 git 调用密集（本机单次 git 进程启动约秒级），统一放宽用例超时 */
const RIG_TIMEOUT = 120000;

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function track(dir: string): string {
  dirs.push(dir);
  return dir;
}

/** 夹具无初始提交：先造 base 提交，默认分支名经 symbolic-ref 动态取（随 git 版本不同） */
function makeBaseCommit(repo: string): string {
  const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return defaultBranch;
}

/** 裸仓库 + clone 配方：本地仓库 + 裸仓库充当 origin + push -u 建 upstream；裸仓库 HEAD 指默认分支 */
function buildRemoteRig(): { repo: string; bare: string; defaultBranch: string } {
  const repo = createTmpRepo();
  const defaultBranch = makeBaseCommit(repo);
  const bare = createTmpDir('rebased-api-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', '-u', 'origin', defaultBranch]);
  git(bare, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repo, bare, defaultBranch };
}

// ---- rig 模板：beforeAll 建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
let rigTemplate: { repo: string; bare: string; defaultBranch: string } | null = null;

beforeAll(() => {
  // withAuth 认证回路会查账户簿记（loadConfig）：测试隔离到临时目录，绝不触碰真实 ~/.rebasedjs
  process.env.REBASED_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
  rigTemplate = buildRemoteRig();
  templateDirs.push(rigTemplate.repo, rigTemplate.bare);
});

afterAll(() => {
  dirs.forEach(cleanupTmpRepo);
  templateDirs.forEach(cleanupTmpRepo);
});

/** 复制 rig 模板：repo 与 bare 各复制一份，文本替换 origin URL 指向新的 bare 副本（0 spawn）。
 *  gitconfig 值内反斜杠转义为双反斜杠存储，替换时须同样转义。 */
function makeRemoteRig(): { repo: string; bare: string; defaultBranch: string } {
  const tpl = rigTemplate!;
  const escape = (p: string): string => p.replace(/\\/g, '\\\\');
  const repo = track(instantiateFixture(tpl.repo));
  const bare = track(instantiateFixture(tpl.bare));
  const cfgPath = join(repo, '.git', 'config');
  writeFileSync(cfgPath, readFileSync(cfgPath, 'utf8').split(escape(tpl.bare)).join(escape(bare)));
  return { repo, bare, defaultBranch: tpl.defaultBranch };
}

/** 第二 clone 对端：改动指定文件并推到裸仓库默认分支（制造远端新提交） */
function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = track(createTmpDir('rebased-api-other-'));
  execFileSync('git', ['clone', '-q', bare, other]);
  writeFileSync(join(other, filename), content);
  git(other, ['add', filename]);
  git(other, ['commit', '-q', '-m', `remote: ${filename}`]);
  git(other, ['push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

describe('updateProject', () => {
  it(
    'merge 策略：对端新提交 → fetched 报远程引用 + pull updated（工作区同步）；再次 update → up-to-date',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');

      const r1 = await updateProject(repo, { strategy: 'merge' });
      expect(r1.fetched).toContain(`refs/remotes/origin/${defaultBranch}`);
      expect(r1.pull.status).toBe('updated');
      expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('from-other');

      const r2 = await updateProject(repo, { strategy: 'merge' });
      expect(r2.fetched).toEqual([]);
      expect(r2.pull.status).toBe('up-to-date');
    },
  );

  it(
    'rebase 策略：分叉后本地提交重放到对端之上（log 顺序断言）',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
      writeFileSync(join(repo, 'c.txt'), 'local');
      git(repo, ['add', 'c.txt']);
      git(repo, ['commit', '-q', '-m', 'local commit']);

      const r = await updateProject(repo, { strategy: 'rebase' });
      expect(r.pull.status).toBe('updated');

      const subjects = git(repo, ['log', '--format=%s', '-2']).split('\n');
      expect(subjects[0]).toBe('local commit');
      expect(subjects[1]).toBe('remote: b.txt');
    },
  );
});

describe('forcePushedUpdate（GitForcePushedBranchUpdateAction 语义）', () => {
  /** 远端强推装置：本地有 2 个未推送提交（c1/c2）→ 对端以远端 reset 掉并新增 remote-keep 提交（模拟强推） */
  function makeForcePushedRig(): { repo: string; bare: string; defaultBranch: string; localOnly: string[] } {
    const { repo, bare, defaultBranch } = makeRemoteRig();
    writeFileSync(join(repo, 'l1.txt'), 'local1');
    git(repo, ['add', 'l1.txt']);
    git(repo, ['commit', '-q', '-m', 'local1']);
    writeFileSync(join(repo, 'l2.txt'), 'local2');
    git(repo, ['add', 'l2.txt']);
    git(repo, ['commit', '-q', '-m', 'local2']);
    const localOnly = [git(repo, ['rev-parse', 'HEAD~1']), git(repo, ['rev-parse', 'HEAD'])];
    // 对端强推：另一 clone 从 base 起新增提交
    const other = track(createTmpDir('rebased-api-other-'));
    execFileSync('git', ['clone', '-q', bare, other]);
    writeFileSync(join(other, 'r.txt'), 'remote-new');
    git(other, ['add', 'r.txt']);
    git(other, ['commit', '-q', '-m', 'remote-keep']);
    git(other, ['push', '-q', 'origin', `HEAD:${defaultBranch}`]);
    return { repo, bare, defaultBranch, localOnly };
  }

  it(
    '强推修复：fetch → 本地重置到上游 → 本地独有提交重放（applied 与树内容断言）',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, localOnly } = makeForcePushedRig();

      const r = await forcePushedUpdate(repo);

      expect(r.status).toBe('success');
      expect(r.applied).toEqual(localOnly);
      // 重置+重放后的最终树 = 对端新提交 + 本地两笔提交
      const subjects = git(repo, ['log', '--format=%s']).split('\n');
      expect(subjects[0]).toBe('local2');
      expect(subjects[1]).toBe('local1');
      expect(subjects[2]).toBe('remote-keep');
      expect(readFileSync(join(repo, 'r.txt'), 'utf8')).toBe('remote-new');
      expect(readFileSync(join(repo, 'l1.txt'), 'utf8')).toBe('local1');
      expect(readFileSync(join(repo, 'l2.txt'), 'utf8')).toBe('local2');
    },
  );

  it(
    '无本地独有提交（远端纯领先）→ updated + applied 空（重置即快进等价）',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');

      const r = await forcePushedUpdate(repo);

      expect(r).toEqual({ status: 'updated', applied: [] });
      expect(git(repo, ['rev-parse', 'HEAD'])).toBe(git(bare, ['rev-parse', defaultBranch]));
      expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('from-other');
    },
  );

  it('当前分支无上游 → INVALID_QUERY', async () => {
    const repo = track(createTmpRepo());
    makeBaseCommit(repo);

    const err = await forcePushedUpdate(repo).catch((e: unknown) => e);

    expect(err).toMatchObject({ code: 'INVALID_QUERY', message: expect.stringContaining('没有上游') });
  });
});
