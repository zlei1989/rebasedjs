import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findToken, upsertAccount } from './auth';
import * as apiIndex from './index';
import {
  applyRemoteAction,
  buildAuthConfig,
  fetchRepo,
  getRemotes,
  isAuthFailure,
  pullRepo,
  pushRepo,
} from './remote';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 裸仓库装置的用例 git 调用密集（本机单次 git 进程启动约秒级），统一放宽用例超时 */
const RIG_TIMEOUT = 120000;

/** 泄露探针 token：存进账户簿记，随后断言任何远程操作响应体/错误体都不含它 */
const LEAK_TOKEN = 'leak-probe-token-9f8e7d6c5b4a';

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
  // 账户簿记写入应用配置：测试隔离到临时目录，绝不触碰真实 ~/.rebasedjs
  process.env.REBASED_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'rebased-api-config-'));
});

afterAll(() => dirs.forEach(cleanupTmpRepo));

describe('远程 CRUD', () => {
  it(
    'add/setUrl/remove 轮转并返回刷新列表',
    { timeout: RIG_TIMEOUT },
    async () => {
      const repo = track(createTmpRepo());

      const afterAdd = await applyRemoteAction(repo, { action: 'add', name: 'origin', url: 'https://example.com/a.git' });
      expect(afterAdd.remotes).toEqual([
        { name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' },
      ]);

      await applyRemoteAction(repo, { action: 'add', name: 'upstream', url: 'https://example.com/b.git' });
      const afterSetUrl = await applyRemoteAction(repo, { action: 'setUrl', name: 'origin', url: 'https://example.com/a2.git' });
      expect(afterSetUrl.remotes.find((r) => r.name === 'origin')?.fetchUrl).toBe('https://example.com/a2.git');

      const afterRemove = await applyRemoteAction(repo, { action: 'remove', name: 'origin' });
      expect(afterRemove.remotes.map((r) => r.name)).toEqual(['upstream']);
      expect(await getRemotes(repo)).toEqual(afterRemove);
    },
  );

  it(
    'add 重名 → INVALID_QUERY 远程已存在；remove/setUrl 不存在 → INVALID_REF 远程不存在',
    { timeout: RIG_TIMEOUT },
    async () => {
      const repo = track(createTmpRepo());
      await applyRemoteAction(repo, { action: 'add', name: 'origin', url: 'https://example.com/a.git' });

      await expect(applyRemoteAction(repo, { action: 'add', name: 'origin', url: 'https://example.com/x.git' }))
        .rejects.toMatchObject({ code: 'INVALID_QUERY', message: expect.stringContaining('远程已存在：origin') });
      await expect(applyRemoteAction(repo, { action: 'remove', name: 'nope' }))
        .rejects.toMatchObject({ code: 'INVALID_REF', message: expect.stringContaining('远程不存在：nope') });
      await expect(applyRemoteAction(repo, { action: 'setUrl', name: 'nope', url: 'https://example.com/y.git' }))
        .rejects.toMatchObject({ code: 'INVALID_REF', message: expect.stringContaining('远程不存在：nope') });
    },
  );
});

describe('fetch/pull/push 三状态', () => {
  it(
    '指定不存在的远程 → INVALID_REF 远程不存在（与 CRUD 预检语义统一，不透出 git 的 500）',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, defaultBranch } = makeRemoteRig();
      const expected = { code: 'INVALID_REF', message: expect.stringContaining('远程不存在：ghost') };
      await expect(fetchRepo(repo, { remote: 'ghost' })).rejects.toMatchObject(expected);
      await expect(pullRepo(repo, { remote: 'ghost' })).rejects.toMatchObject(expected);
      await expect(pushRepo(repo, { remote: 'ghost', branch: defaultBranch })).rejects.toMatchObject(expected);
    },
  );

  it(
    '对端新提交 → fetchRepo 报移动引用；无变化 → 空；响应体不含已存 token',
    { timeout: RIG_TIMEOUT },
    async () => {
      upsertAccount({ host: 'probe.example.com', account: 'tester', token: LEAK_TOKEN });
      const { repo, bare, defaultBranch } = makeRemoteRig();

      expect((await fetchRepo(repo, {})).updatedRefs).toEqual([]);

      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
      const res = await fetchRepo(repo, { remote: 'origin' });
      expect(res.updatedRefs).toContain(`refs/remotes/origin/${defaultBranch}`);

      // 泄露断言（P2-H 终审建议）：远程操作响应体序列化后不得含 token 本体
      expect(JSON.stringify(res)).not.toContain(LEAK_TOKEN);
      expect(JSON.stringify(await getRemotes(repo))).not.toContain(LEAK_TOKEN);
    },
  );

  it(
    '对端新提交 → pullRepo updated（工作区同步）；再次 pull → up-to-date',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');

      const r1 = await pullRepo(repo, { remote: 'origin' });
      expect(r1.status).toBe('updated');
      expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('from-other');

      const r2 = await pullRepo(repo, { remote: 'origin' });
      expect(r2.status).toBe('up-to-date');
    },
  );

  it(
    '本地新提交 → pushed 且对端可见；再次 push → up-to-date',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      writeFileSync(join(repo, 'b.txt'), 'local');
      git(repo, ['add', 'b.txt']);
      git(repo, ['commit', '-q', '-m', 'local commit']);

      const r1 = await pushRepo(repo, { remote: 'origin', branch: defaultBranch });
      expect(r1.status).toBe('pushed');
      expect(git(bare, ['rev-parse', defaultBranch])).toBe(git(repo, ['rev-parse', 'HEAD']));

      const r2 = await pushRepo(repo, { remote: 'origin', branch: defaultBranch });
      expect(r2.status).toBe('up-to-date');
    },
  );

  it(
    '对端先推 → rejected + 中文 hint（先拉取/变基）',
    { timeout: RIG_TIMEOUT },
    async () => {
      const { repo, bare, defaultBranch } = makeRemoteRig();
      pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
      writeFileSync(join(repo, 'c.txt'), 'local');
      git(repo, ['add', 'c.txt']);
      git(repo, ['commit', '-q', '-m', 'local commit']);

      const r = await pushRepo(repo, { remote: 'origin', branch: defaultBranch });
      expect(r.status).toBe('rejected');
      expect(r.hint).toBe('远端有更新的提交，请先拉取/变基');
    },
  );
});

describe('认证回路', () => {
  it.each([
    'fatal: Authentication failed for \'https://github.com/u/r.git/\'',
    // GIT_TERMINAL_PROMPT=0 下无凭据 https 远程的真实报错（见下一条集成用例）
    'fatal: could not read Username for \'https://github.com\': terminal prompts disabled',
    'terminal prompts disabled',
    'The requested URL returned error: 401',
    'The requested URL returned error: 403',
  ])('isAuthFailure 命中认证特征：%s', (stderr) => {
    expect(isAuthFailure(stderr)).toBe(true);
  });

  it.each([
    'fatal: unable to access \'https://x.invalid/\': Could not resolve host: x.invalid',
    'fatal: \'nope\' does not appear to be a git repository',
    // rejected push 是业务结果（200 透出），绝不可误判为认证失败
    'error: failed to push some refs\n! [rejected] main -> main (non-fast-forward)',
  ])('isAuthFailure 不误伤非认证失败：%s', (stderr) => {
    expect(isAuthFailure(stderr)).toBe(false);
  });

  it('buildAuthConfig 组装 http.<baseurl> 条件节（URL 前缀匹配；非默认端口须保留）', () => {
    // 默认端口：https 远程 → 单条 https 节（URL 规范化去默认端口，与 git 的 URL 匹配行为一致）
    expect(buildAuthConfig('https://github.com/user/repo.git', 'tok123')).toEqual([
      'http.https://github.com.extraHeader=Authorization: Bearer tok123',
    ]);
    // 显式非默认端口：git 的 http.<url> 匹配要求端口精确一致（git config --get-urlmatch 实测：
    // 无端口节不匹配带端口 URL），故节名必须保留端口
    expect(buildAuthConfig('http://127.0.0.1:8080/repo.git', 'tok123')).toEqual([
      'http.http://127.0.0.1:8080.extraHeader=Authorization: Bearer tok123',
    ]);
    // 显式默认端口（443）被 URL 规范化去除，等价于无端口节
    expect(buildAuthConfig('https://github.com:443/user/repo.git', 'tok123')).toEqual([
      'http.https://github.com.extraHeader=Authorization: Bearer tok123',
    ]);
    // 大写 host 归一小写（URL 解析器对特殊 scheme 自动小写 scheme+host）
    expect(buildAuthConfig('HTTPS://GitHub.COM/u/r.git', 'tok123')).toEqual([
      'http.https://github.com.extraHeader=Authorization: Bearer tok123',
    ]);
    // 非 http(s) 形态（scp 式 ssh、本地路径）无注入意义 → 空
    expect(buildAuthConfig('git@github.com:user/repo.git', 'tok123')).toEqual([]);
    expect(buildAuthConfig('/tmp/bare.git', 'tok123')).toEqual([]);
  });

  it('findToken 按规范化 host 取回明文 token；未存 → null；不经 index 公共出口', () => {
    upsertAccount({ host: 'GitHub.com', account: 'alice', token: 'ghp_secret_find' });
    expect(findToken('github.com')).toBe('ghp_secret_find');
    expect(findToken('nobody.example.com')).toBeNull();
    expect('findToken' in apiIndex).toBe(false);
  });

  it(
    'http 远程 401 且无凭据（GIT_TERMINAL_PROMPT=0）→ AUTH_FAILED；Bearer 头确已注入；错误体不含 token',
    { timeout: 60000 },
    async () => {
      const token = 'leak-probe-401-token';
      upsertAccount({ host: '127.0.0.1', account: 'tester', token });

      // 可控认证场景：本地 HTTP 服务器对 git smart-http 端点一律 401（携 WWW-Authenticate 触发 git 索要凭据）
      const seenAuth: string[] = [];
      const server: Server = createServer((req, res) => {
        if (req.headers.authorization !== undefined) seenAuth.push(req.headers.authorization);
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="rebased-test"' });
        res.end('auth required');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      try {
        const { port } = server.address() as AddressInfo;
        const repo = track(createTmpRepo());
        execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', `http://127.0.0.1:${port}/repo.git`]);

        const error: unknown = await fetchRepo(repo, { remote: 'origin' }).then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toMatchObject({
          code: 'AUTH_FAILED',
          message: '认证失败，请配置该主机的访问令牌',
          context: { host: '127.0.0.1' },
        });
        // token 注入端到端证据：服务器确实收到 extraHeader 注入的 Authorization 头
        expect(seenAuth).toContain(`Bearer ${token}`);
        // 泄露断言（P2-H 终审建议）：错误体序列化后不得含 token 本体
        expect(JSON.stringify(error)).not.toContain(token);
      } finally {
        server.close();
      }
    },
  );
});
