/**
 * web-next blame/history/committed/search 路由测试：注解、文件历史（--follow）、提交列表/单提交变更与搜索。
 * 拆分自原 routes.test.ts 的 'web-next blame/history/committed/search 路由' describe：
 * 原单文件 194s 是测试提速瓶颈，按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getBlame } from '../app/api/repos/[repoId]/blame/route';
import { GET as getHistory } from '../app/api/repos/[repoId]/history/route';
import { GET as getCommitted } from '../app/api/repos/[repoId]/committed/route';
import { GET as getCommitFilesRoute } from '../app/api/repos/[repoId]/commits/[hash]/route';
import { GET as getSearch } from '../app/api/repos/[repoId]/search/route';
import { cleanupTestEnv, ctx, lastRepoPath, makeLocalCommit, registerRepo, setupTestEnv } from './testing/routes-helpers';

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
});

describe('web-next blame/history/committed/search 路由', () => {
  /** 本组用例 git 进程密集（多提交/重命名/搜索遍历），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;

  it('blame 端点：两提交后返回 200 且行数/内容/归属字段正确', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const first = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'second']);

    const res = await getBlame(new Request(`http://localhost/api/repos/${repoId}/blame?file=a.txt`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    // 行数 = 文件行数；未改动行归属首提交（首创建 → previousLineno null）
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ lineno: 1, content: 'hello', author: 'Test User', shortHash: first.slice(0, 7) });
    expect(body[0].hash).toBe(first);
    expect(body[0].previousLineno).toBeNull();
    // 新增行归属次提交（hash/author/日期字段齐全）
    expect(body[1]).toMatchObject({ lineno: 2, content: 'world', author: 'Test User' });
    expect(body[1].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof body[1].dateIso).toBe('string');
  });

  it('history 端点：git mv 重命名后返回 200 且含重命名前提交（--follow 证据）', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    execFileSync('git', ['-C', lastRepoPath, 'mv', 'a.txt', 'b.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'add', '.']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'rename to b']);

    const res = await getHistory(new Request(`http://localhost/api/repos/${repoId}/history?file=b.txt`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    // 最新在前：rename 提交 + init 提交（新路径 b.txt 在重命名前提交中不存在 → --follow 跟随证据）
    expect(body.map((e: { subject: string }) => e.subject)).toEqual(['rename to b', 'init']);
    expect(body[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(body[0].author).toBe('Test User');
    expect(typeof body[0].dateIso).toBe('string');
  });

  it('committed 端点：默认全量 200 hasMore false；limit=1 分页 hasMore true；skip 越界空页', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('b.txt', 'two\n', 'second');
    makeLocalCommit('c.txt', 'three\n', 'third');

    const fullRes = await getCommitted(new Request(`http://localhost/api/repos/${repoId}/committed`), ctx(repoId));
    expect(fullRes.status).toBe(200);
    const full = await fullRes.json();
    expect(full.entries).toHaveLength(3);
    expect(full.hasMore).toBe(false);
    // 最新在前：entries[0] 为 third 提交且变更文件集正确
    expect(full.entries[0]).toMatchObject({ subject: 'third', author: 'Test User' });
    expect(full.entries[0].files).toEqual([{ path: 'c.txt', status: 'A' }]);
    expect(full.entries[1].subject).toBe('second');
    expect(full.entries[1].files).toEqual([{ path: 'b.txt', status: 'A' }]);
    // %P 父哈希透传：非根提交单父；根提交（init）无父 → []（容器据此降级根提交 diff，终审 Must-fix 2）
    expect(full.entries[0].parents).toHaveLength(1);
    expect(full.entries[0].parents[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(full.entries[2].parents).toEqual([]);

    const pageRes = await getCommitted(new Request(`http://localhost/api/repos/${repoId}/committed?limit=1`), ctx(repoId));
    const page = await pageRes.json();
    expect(page.entries).toHaveLength(1);
    expect(page.hasMore).toBe(true);

    const beyondRes = await getCommitted(new Request(`http://localhost/api/repos/${repoId}/committed?limit=1&skip=3`), ctx(repoId));
    const beyond = await beyondRes.json();
    expect(beyond.entries).toHaveLength(0);
    expect(beyond.hasMore).toBe(false);
  });

  it('commits/:hash 端点：单提交全量变更文件 200；无效 hash 400 INVALID_REF；未注册 repoId 404', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('b.txt', 'two\n', 'second');
    const hash = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const hashCtx = (id: string, h: string): { params: Promise<{ repoId: string; hash: string }> } => ({
      params: Promise.resolve({ repoId: id, hash: h }),
    });

    const res = await getCommitFilesRoute(new Request(`http://localhost/api/repos/${repoId}/commits/${hash}`), hashCtx(repoId, hash));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hash, shortHash: hash.slice(0, 7), subject: 'second' });
    expect(body.parents).toHaveLength(1);
    expect(body.files).toEqual([{ path: 'b.txt', status: 'A' }]);

    const badRes = await getCommitFilesRoute(
      new Request(`http://localhost/api/repos/${repoId}/commits/${'deadbeef'.repeat(5)}`),
      hashCtx(repoId, 'deadbeef'.repeat(5)),
    );
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });

    const notFoundRes = await getCommitFilesRoute(
      new Request(`http://localhost/api/repos/nope/commits/${hash}`),
      hashCtx('nope', hash),
    );
    expect(notFoundRes.status).toBe(404);
    expect(await notFoundRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('search 端点：grep 命中提交信息、pickaxe 命中内容增量、无命中空数组，均 200', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('fix.txt', 'patch\n', 'fix: repair the bug');
    makeLocalCommit('token.txt', 'TOKEN_XYZ\n', 'add token file');

    const grepRes = await getSearch(new Request(`http://localhost/api/repos/${repoId}/search?q=FIX&mode=grep`), ctx(repoId));
    expect(grepRes.status).toBe(200);
    const grepBody = await grepRes.json();
    expect(grepBody).toHaveLength(1);
    expect(grepBody[0].subject).toBe('fix: repair the bug');
    expect(grepBody[0].hash).toMatch(/^[0-9a-f]{40}$/);

    const pickRes = await getSearch(
      new Request(`http://localhost/api/repos/${repoId}/search?q=TOKEN_XYZ&mode=pickaxe`),
      ctx(repoId),
    );
    expect(pickRes.status).toBe(200);
    const pickBody = await pickRes.json();
    expect(pickBody).toHaveLength(1);
    expect(pickBody[0].subject).toBe('add token file');

    const noneRes = await getSearch(new Request(`http://localhost/api/repos/${repoId}/search?q=NOT_PRESENT`), ctx(repoId));
    expect(noneRes.status).toBe(200);
    expect(await noneRes.json()).toEqual([]);
  });

  it('blame/history/search 端点：缺必填查询参数（file/q）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const blameRes = await getBlame(new Request(`http://localhost/api/repos/${repoId}/blame`), ctx(repoId));
    const historyRes = await getHistory(new Request(`http://localhost/api/repos/${repoId}/history`), ctx(repoId));
    const searchRes = await getSearch(new Request(`http://localhost/api/repos/${repoId}/search`), ctx(repoId));
    for (const res of [blameRes, historyRes, searchRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：blame/history/committed/search 返回 404 REPO_NOT_FOUND', async () => {
    const blameRes = await getBlame(new Request('http://localhost/api/repos/nope/blame?file=a.txt'), ctx('nope'));
    const historyRes = await getHistory(new Request('http://localhost/api/repos/nope/history?file=a.txt'), ctx('nope'));
    const committedRes = await getCommitted(new Request('http://localhost/api/repos/nope/committed'), ctx('nope'));
    const searchRes = await getSearch(new Request('http://localhost/api/repos/nope/search?q=x'), ctx('nope'));
    for (const res of [blameRes, historyRes, committedRes, searchRes]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
