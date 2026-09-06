import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abortGitOperation, getOperationState } from './operation';
import { addRemote, fetchRemote, isShallowRepo, listRemotes, pullRemote, pushBranch, removeRemote, setRemoteUrl } from './remote';
import { getStatus } from './status';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

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

/** 夹具无初始提交：先造 base 提交，返回默认分支名（随 git 版本不同，动态取值） */
function makeBaseCommit(repo: string): string {
  const defaultBranch = git(repo, ['symbolic-ref', 'HEAD', '--short']);
  writeFileSync(join(repo, 'a.txt'), 'hello');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return defaultBranch;
}

/**
 * 裸仓库 + clone 远程装置（沿用 branch.test.ts 配方）：
 * 本地仓库 + 裸仓库充当 origin + push -u 建立 upstream；
 * 裸仓库 HEAD 指到默认分支，使后续 clone 直接检出该分支。
 */
function makeRemoteRig(): { repo: string; bare: string; defaultBranch: string } {
  const repo = track(createTmpRepo());
  const defaultBranch = makeBaseCommit(repo);
  const bare = track(mkdtempSync(join(tmpdir(), 'rebased-core-bare-')));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', '-u', 'origin', defaultBranch]);
  git(bare, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repo, bare, defaultBranch };
}

/** 第二 clone 对端：改动指定文件并推到裸仓库的默认分支（制造远端新提交） */
function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = track(mkdtempSync(join(tmpdir(), 'rebased-core-other-')));
  execFileSync('git', ['clone', '-q', bare, other]);
  git(other, ['config', 'user.email', 'test@example.com']);
  git(other, ['config', 'user.name', 'Test User']);
  writeFileSync(join(other, filename), content);
  git(other, ['add', filename]);
  git(other, ['commit', '-q', '-m', `remote: ${filename}`]);
  git(other, ['push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

describe('远程 CRUD', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('add/list/setUrl/remove 轮转；缺 push 行时 pushUrl=fetchUrl', async () => {
    const repo = track(createTmpRepo());
    expect(await listRemotes(repo)).toEqual([]);

    await addRemote(repo, 'origin', 'https://example.com/a.git');
    await addRemote(repo, 'upstream', 'https://example.com/b.git');
    expect(await listRemotes(repo)).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' },
      { name: 'upstream', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
    ]);

    await setRemoteUrl(repo, 'origin', 'https://example.com/a2.git');
    const renamed = await listRemotes(repo);
    expect(renamed.find((r) => r.name === 'origin')?.fetchUrl).toBe('https://example.com/a2.git');
    expect(renamed.find((r) => r.name === 'origin')?.pushUrl).toBe('https://example.com/a2.git');

    // 独立 pushurl：fetch/push 两行聚合为一条
    git(repo, ['remote', 'set-url', '--push', 'upstream', 'https://example.com/push-only.git']);
    const upstream = (await listRemotes(repo)).find((r) => r.name === 'upstream');
    expect(upstream?.fetchUrl).toBe('https://example.com/b.git');
    expect(upstream?.pushUrl).toBe('https://example.com/push-only.git');

    await removeRemote(repo, 'origin');
    expect((await listRemotes(repo)).map((r) => r.name)).toEqual(['upstream']);
  });
});

describe('fetchRemote', () => {
  it(
    '对端新提交 → updatedRefs 含移动的远程引用，behind 随之变化',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();

      // 无变化时为空
      expect((await fetchRemote(repo, { remote: 'origin' })).updatedRefs).toEqual([]);

      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
      const res = await fetchRemote(repo, { remote: 'origin' });
      expect(res.updatedRefs).toContain(`refs/remotes/origin/${defaultBranch}`);

      const status = await getStatus(repo);
      expect(status.behind).toBe(1);
      expect(status.ahead).toBe(0);
    },
  );

  it(
    'refspec +refs/pull/N/head：FETCH_HEAD 解析到目标提交（GitHub PR 检出用；缺省行为不变）',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      // refs/pull/7/head 指向与默认分支尖不同的提交（同头则缺省 fetch 也会把 FETCH_HEAD 指过去，无法区分）
      const other = track(mkdtempSync(join(tmpdir(), 'rebased-core-other-')));
      execFileSync('git', ['clone', '-q', bare, other]);
      git(other, ['config', 'user.email', 'test@example.com']);
      git(other, ['config', 'user.name', 'Test User']);
      writeFileSync(join(other, 'pr.txt'), 'pr-content');
      git(other, ['add', 'pr.txt']);
      git(other, ['commit', '-q', '-m', 'pr commit']);
      const target = git(other, ['rev-parse', 'HEAD']);
      expect(target).not.toBe(git(bare, ['rev-parse', defaultBranch]));
      git(other, ['push', '-q', 'origin', 'HEAD:refs/pull/7/head']);

      const res = await fetchRemote(repo, { remote: 'origin', refspec: '+refs/pull/7/head' });
      // 原始 refspec 不写远程跟踪引用（不在 4 个指纹命名空间内）：updatedRefs 为空，
      // 但 FETCH_HEAD 已被 git 写入并指向该提交——后续 checkout -b pr-7 FETCH_HEAD 依赖此行为
      expect(res.updatedRefs).toEqual([]);
      expect(git(repo, ['rev-parse', '--verify', 'FETCH_HEAD'])).toBe(target);
    },
  );
});

describe('pullRemote', () => {
  it(
    '对端新提交 → updated（工作区同步）；再次 pull → up-to-date',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');

      const r1 = await pullRemote(repo, { remote: 'origin' });
      expect(r1.status).toBe('updated');
      expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('from-other');

      const r2 = await pullRemote(repo, { remote: 'origin' });
      expect(r2.status).toBe('up-to-date');
    },
  );

  it(
    'rebase：本地提交重放到对端提交之上',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
      writeFileSync(join(repo, 'c.txt'), 'local');
      git(repo, ['add', 'c.txt']);
      git(repo, ['commit', '-q', '-m', 'local commit']);

      const r = await pullRemote(repo, { remote: 'origin', rebase: true });
      expect(r.status).toBe('updated');
      const subjects = git(repo, ['log', '--format=%s', '-2']).split('\n');
      expect(subjects[0]).toBe('local commit');
      expect(subjects[1]).toBe('remote: b.txt');
    },
  );

  it(
    '本地与对端同改一行 → conflicts（operation 原语可见 merge 状态）',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'a.txt', 'remote-line');
      writeFileSync(join(repo, 'a.txt'), 'local-line');
      git(repo, ['commit', '-q', '-am', 'local change']);

      const r = await pullRemote(repo, { remote: 'origin' });
      expect(r.status).toBe('conflicts');
      expect((await getOperationState(repo)).kind).toBe('merge');

      // 清理进行中的 merge，避免临时目录删除受阻
      await abortGitOperation(repo, 'merge');
    },
  );
});

describe('pushBranch', () => {
  it(
    '本地新提交 → pushed 且对端可见；再次 push → up-to-date',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      writeFileSync(join(repo, 'b.txt'), 'local');
      git(repo, ['add', 'b.txt']);
      git(repo, ['commit', '-q', '-m', 'local commit']);

      const r1 = await pushBranch(repo, { remote: 'origin', branch: defaultBranch });
      expect(r1.status).toBe('pushed');
      expect(git(bare, ['rev-parse', defaultBranch])).toBe(git(repo, ['rev-parse', 'HEAD']));

      const r2 = await pushBranch(repo, { remote: 'origin', branch: defaultBranch });
      expect(r2.status).toBe('up-to-date');
    },
  );

  it(
    '对端先推 → rejected 且 hint 含「先拉取」',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
      writeFileSync(join(repo, 'c.txt'), 'local');
      git(repo, ['add', 'c.txt']);
      git(repo, ['commit', '-q', '-m', 'local commit']);

      const r = await pushBranch(repo, { remote: 'origin', branch: defaultBranch });
      expect(r.status).toBe('rejected');
      expect(r.hint).toContain('先拉取');
    },
  );

  it(
    'setUpstream：-u 推送后 upstream 生效',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, defaultBranch } = makeRemoteRig();
      git(repo, ['checkout', '-q', '-b', 'feat']);

      const r = await pushBranch(repo, { remote: 'origin', branch: 'feat', setUpstream: true });
      expect(r.status).toBe('pushed');
      expect(git(repo, ['rev-parse', '--abbrev-ref', 'feat@{upstream}'])).toBe('origin/feat');
      // 回到默认分支，保持装置一致性
      git(repo, ['checkout', '-q', defaultBranch]);
    },
  );
});

describe('传输超时兜底（P3-A 终审 Finding 1）', () => {
  // 停滞服务器：接受连接后永不响应（网络停滞类挂起——凭据提示类已由 GIT_TERMINAL_PROMPT 覆盖）。
  // 三个原语各传小 timeoutMs 触发 exec.ts 既有 124 超时路径，断言以 GitExitError 124 拒绝而非无限挂起。
  let server: Server | undefined;
  let stallUrl = '';

  afterAll(() => server?.close());

  /** 惰性起服务器（同 describe 内三用例共享一台）+ 指向它的仓库（含 base 提交） */
  async function makeStallRepo(): Promise<{ repo: string; defaultBranch: string }> {
    if (server === undefined) {
      const s = createServer(() => {
        // 永不写响应：socket 挂起，git 停在 info/refs 读取上
      });
      server = s;
      await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
      const { port } = s.address() as AddressInfo;
      stallUrl = `http://127.0.0.1:${port}/repo.git`;
    }
    const repo = track(createTmpRepo());
    const defaultBranch = makeBaseCommit(repo);
    git(repo, ['remote', 'add', 'origin', stallUrl]);
    return { repo, defaultBranch };
  }

  it('fetchRemote 停滞 → GitExitError 124（非挂起）', { timeout: 30000 }, async () => {
    const { repo } = await makeStallRepo();
    await expect(fetchRemote(repo, { remote: 'origin', timeoutMs: 2000 })).rejects.toMatchObject({
      name: 'GitExitError',
      exitCode: 124,
    });
  });

  it('pullRemote 停滞 → GitExitError 124（非挂起）', { timeout: 30000 }, async () => {
    const { repo } = await makeStallRepo();
    await expect(pullRemote(repo, { remote: 'origin', timeoutMs: 2000 })).rejects.toMatchObject({
      name: 'GitExitError',
      exitCode: 124,
    });
  });

  it('pushBranch 停滞 → GitExitError 124（非挂起）', { timeout: 30000 }, async () => {
    const { repo, defaultBranch } = await makeStallRepo();
    await expect(pushBranch(repo, { remote: 'origin', branch: defaultBranch, timeoutMs: 2000 })).rejects.toMatchObject({
      name: 'GitExitError',
      exitCode: 124,
    });
  });
});

describe('isShallowRepo', () => {
  it(
    '普通仓库 false；--depth 1 克隆 true',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare } = makeRemoteRig();
      expect(await isShallowRepo(repo)).toBe(false);

      // --depth 仅对非本地传输生效，故用 file:// URL 克隆
      const shallow = track(mkdtempSync(join(tmpdir(), 'rebased-core-shallow-')));
      execFileSync('git', ['clone', '-q', '--depth', '1', pathToFileURL(bare).href, shallow]);
      expect(await isShallowRepo(shallow)).toBe(true);
    },
  );
});
