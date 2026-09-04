import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';
import { updateProject } from './update';

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
function makeRemoteRig(): { repo: string; bare: string; defaultBranch: string } {
  const repo = track(createTmpRepo());
  const defaultBranch = makeBaseCommit(repo);
  const bare = track(mkdtempSync(join(tmpdir(), 'rebased-api-bare-')));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', '-u', 'origin', defaultBranch]);
  git(bare, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repo, bare, defaultBranch };
}

/** 第二 clone 对端：改动指定文件并推到裸仓库默认分支（制造远端新提交） */
function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = track(mkdtempSync(join(tmpdir(), 'rebased-api-other-')));
  execFileSync('git', ['clone', '-q', bare, other]);
  git(other, ['config', 'user.email', 'test@example.com']);
  git(other, ['config', 'user.name', 'Test User']);
  writeFileSync(join(other, filename), content);
  git(other, ['add', filename]);
  git(other, ['commit', '-q', '-m', `remote: ${filename}`]);
  git(other, ['push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

beforeAll(() => {
  // withAuth 认证回路会查账户簿记（loadConfig）：测试隔离到临时目录，绝不触碰真实 ~/.rebasedjs
  process.env.REBASED_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
});

afterAll(() => dirs.forEach(cleanupTmpRepo));

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
