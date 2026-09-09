/**
 * web-koa blame/history/browse/committed/search 端点集成测试（拆分自 app.test.ts）。
 * 职责：blame（行归属/previousLineno）、history（--follow 重命名）、browse（树/内容/二进制标记）、
 * committed（分页/父哈希透传）、search（grep/pickaxe）、commits/:hash 端点形状与错误映射断言。
 * 拆分原因：原单文件 app.test.ts（171 用例）约 242s，是测试提速瓶颈；按 describe 拆成 11 个文件，
 * 由 vitest 多 worker 并行执行。
 * 隔离：每文件独立 startServer（ephemeral 端口）；每用例独立 REBASED_CONFIG_DIR（空注册表）；
 * afterEach cleanupDirs 清理临时目录（EPERM/EBUSY 重试）。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupDirs, makeLocalCommit, registerRepo, startServer, tmpDir } from './testing/integration';

let base = '';
let closeServer: () => Promise<void> = async () => {};

beforeAll(async () => {
  const started = await startServer();
  base = started.base;
  closeServer = started.close;
});

afterAll(async () => {
  await closeServer();
});

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-koa-config-');
});

afterEach(async () => {
  delete process.env.REBASED_CONFIG_DIR;
  await cleanupDirs();
});

describe('web-koa blame/history/browse/committed/search 端点', () => {
  /** 本组用例 git 进程密集（多提交/重命名/搜索遍历），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;

  it('blame 端点：两提交后返回 200 且行数/内容/归属字段正确', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    const first = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(repoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', repoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'second']);

    const res = await fetch(`${base}/api/repos/${repoId}/blame?file=a.txt`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ lineno: number; content: string; hash: string; author: string; previousLineno: number | null }>;
    // 行数 = 文件行数；未改动行归属首提交（首创建 → previousLineno null）
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({ lineno: 1, content: 'hello', author: 'Test User' });
    expect(body[0].hash).toBe(first);
    expect(body[0].previousLineno).toBeNull();
    // 新增行归属次提交（hash/日期字段齐全）
    expect(body[1]).toMatchObject({ lineno: 2, content: 'world', author: 'Test User' });
    expect(body[1].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('history 端点：git mv 重命名后返回 200 且含重命名前提交（--follow 证据）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    execFileSync('git', ['-C', repoPath, 'mv', 'a.txt', 'b.txt']);
    execFileSync('git', ['-C', repoPath, 'add', '.']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'rename to b']);

    const res = await fetch(`${base}/api/repos/${repoId}/history?file=b.txt`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ subject: string; hash: string; author: string }>;
    // 最新在前：rename 提交 + init 提交（b.txt 在重命名前提交中不存在 → --follow 跟随证据）
    expect(body.map((e) => e.subject)).toEqual(['rename to b', 'init']);
    expect(body[0].hash).toMatch(/^[0-9a-f]{40}$/);
    expect(body[0].author).toBe('Test User');
  });

  it('browse 端点：rev=HEAD 返回 200 与 BrowseTree 形状；content 返回文本内容与二进制标记', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    writeFileSync(join(repoPath, 'b.txt'), 'two\n');
    execFileSync('git', ['-C', repoPath, 'add', 'b.txt']);
    execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', 'second']);

    const res = await fetch(`${base}/api/repos/${repoId}/browse?rev=HEAD`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rev: string; entries: Array<{ mode: string; type: string; hash: string; path: string }> };
    expect(body.rev).toBe('HEAD'); // rev 原样回显（输入即用户所见），终端哈希见条目 hash 字段
    expect(body.entries.map((e) => e.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(body.entries[0]).toMatchObject({ mode: '100644', type: 'blob' });
    expect(body.entries[0].hash).toMatch(/^[0-9a-f]{40}$/);

    const contentRes = await fetch(`${base}/api/repos/${repoId}/browse/content?rev=HEAD&file=a.txt`);
    expect(contentRes.status).toBe(200);
    expect(await contentRes.json()).toEqual({ content: 'hello\n', binary: false });
  });

  it('browse 端点：缺 rev 或无效 rev 返回 400；未注册 repoId 两个端点返回 404 REPO_NOT_FOUND', async () => {
    const { repoId } = registerRepo();
    const missingRes = await fetch(`${base}/api/repos/${repoId}/browse`);
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const badRes = await fetch(`${base}/api/repos/${repoId}/browse?rev=nope`);
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });

    const notFoundRes = await fetch(`${base}/api/repos/nope/browse?rev=HEAD`);
    const contentNotFound = await fetch(`${base}/api/repos/nope/browse/content?rev=HEAD&file=a.txt`);
    for (const res of [notFoundRes, contentNotFound]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });

  it('committed 端点：默认全量 200 hasMore false；limit=1 分页 hasMore true；skip 越界空页', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'b.txt', 'two\n', 'second');
    makeLocalCommit(repoPath, 'c.txt', 'three\n', 'third');

    const fullRes = await fetch(`${base}/api/repos/${repoId}/committed`);
    expect(fullRes.status).toBe(200);
    const full = (await fullRes.json()) as { entries: Array<{ subject: string; author: string; parents: string[]; files: Array<{ path: string; status: string }> }>; hasMore: boolean };
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

    const pageRes = await fetch(`${base}/api/repos/${repoId}/committed?limit=1`);
    const page = (await pageRes.json()) as typeof full;
    expect(page.entries).toHaveLength(1);
    expect(page.hasMore).toBe(true);

    const beyondRes = await fetch(`${base}/api/repos/${repoId}/committed?limit=1&skip=3`);
    const beyond = (await beyondRes.json()) as typeof full;
    expect(beyond.entries).toHaveLength(0);
    expect(beyond.hasMore).toBe(false);
  });

  it('search 端点：grep 命中提交信息、pickaxe 命中内容增量、无命中空数组，均 200', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'fix.txt', 'patch\n', 'fix: repair the bug');
    makeLocalCommit(repoPath, 'token.txt', 'TOKEN_XYZ\n', 'add token file');

    const grepRes = await fetch(`${base}/api/repos/${repoId}/search?q=FIX&mode=grep`);
    expect(grepRes.status).toBe(200);
    const grepBody = (await grepRes.json()) as Array<{ subject: string; hash: string }>;
    expect(grepBody).toHaveLength(1);
    expect(grepBody[0].subject).toBe('fix: repair the bug');
    expect(grepBody[0].hash).toMatch(/^[0-9a-f]{40}$/);

    const pickRes = await fetch(`${base}/api/repos/${repoId}/search?q=TOKEN_XYZ&mode=pickaxe`);
    expect(pickRes.status).toBe(200);
    const pickBody = (await pickRes.json()) as Array<{ subject: string }>;
    expect(pickBody).toHaveLength(1);
    expect(pickBody[0].subject).toBe('add token file');

    const noneRes = await fetch(`${base}/api/repos/${repoId}/search?q=NOT_PRESENT`);
    expect(noneRes.status).toBe(200);
    expect(await noneRes.json()).toEqual([]);
  });

  it('commits/:hash 端点：单提交全量变更文件 200；无效 hash 400 INVALID_REF；未注册 repoId 404', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, repoPath } = registerRepo();
    makeLocalCommit(repoPath, 'b.txt', 'two\n', 'second');
    const hash = execFileSync('git', ['-C', repoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

    const res = await fetch(`${base}/api/repos/${repoId}/commits/${hash}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string; shortHash: string; subject: string; parents: string[]; files: Array<{ path: string; status: string }> };
    expect(body).toMatchObject({ hash, shortHash: hash.slice(0, 7), subject: 'second' });
    expect(body.parents).toHaveLength(1);
    expect(body.files).toEqual([{ path: 'b.txt', status: 'A' }]);

    const badRes = await fetch(`${base}/api/repos/${repoId}/commits/${'deadbeef'.repeat(5)}`);
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });

    const notFoundRes = await fetch(`${base}/api/repos/nope/commits/${hash}`);
    expect(notFoundRes.status).toBe(404);
    expect(await notFoundRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('blame/history/search 端点：缺必填查询参数（file/q）返回 400 INVALID_QUERY', async () => {
    const { repoId } = registerRepo();
    const blameRes = await fetch(`${base}/api/repos/${repoId}/blame`);
    const historyRes = await fetch(`${base}/api/repos/${repoId}/history`);
    const searchRes = await fetch(`${base}/api/repos/${repoId}/search`);
    for (const res of [blameRes, historyRes, searchRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：blame/history/committed/search 返回 404 REPO_NOT_FOUND', async () => {
    const blameRes = await fetch(`${base}/api/repos/nope/blame?file=a.txt`);
    const historyRes = await fetch(`${base}/api/repos/nope/history?file=a.txt`);
    const committedRes = await fetch(`${base}/api/repos/nope/committed`);
    const searchRes = await fetch(`${base}/api/repos/nope/search?q=x`);
    for (const res of [blameRes, historyRes, committedRes, searchRes]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
