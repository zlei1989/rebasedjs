/**
 * web-next REST 路由测试：直接构造 Request 调 route 函数（不起 Next 服务）。
 * 每个用例独立 REBASED_CONFIG_DIR（空注册表）；成功路径先注册临时 git 仓库再断言响应形状。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getRepos } from '../app/api/repos/route';
import { POST as postOpen } from '../app/api/repos/open/route';
import { GET as getStatus } from '../app/api/repos/[repoId]/status/route';
import { GET as getLog } from '../app/api/repos/[repoId]/log/route';
import { GET as getDiff } from '../app/api/repos/[repoId]/diff/route';
import { GET as getSettings, PUT as putSettings } from '../app/api/settings/route';

/** Next 16：route 第二参的 params 为 Promise */
function ctx(repoId: string): { params: Promise<{ repoId: string }> } {
  return { params: Promise.resolve({ repoId }) };
}

let dirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 建临时 git 仓库（一次提交）并写入配置注册表，返回注册 repoId */
function registerRepo(): string {
  const repo = tmpDir('rebased-web-next-repo-');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test User']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  writeFileSync(
    join(process.env.REBASED_CONFIG_DIR as string, 'config.json'),
    JSON.stringify({
      repos: [{ id: 'r1', path: repo, name: 'tmp-repo', openedAt: new Date().toISOString() }],
      settings: { logInEditor: true, recentRepoIds: ['r1'] },
    }),
  );
  return 'r1';
}

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-next-config-');
});

afterEach(() => {
  delete process.env.REBASED_CONFIG_DIR;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('web-next REST 路由', () => {
  it('log 端点：无 repoId 参数返回 400 INVALID_QUERY', async () => {
    const res = await getLog(new Request('http://localhost/api/repos/x/log'), ctx(''));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('log 端点：limit 超界返回 400 INVALID_QUERY', async () => {
    const res = await getLog(new Request('http://localhost/api/repos/x/log?limit=9999'), ctx('x'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  // 注：真实仓库路径经 getRepoById——无注册仓库时返回 404 REPO_NOT_FOUND（getRepoById 抛错 → 映射）
  it('status 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getStatus(new Request('http://localhost/api/repos/nope/status'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('log 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getLog(new Request('http://localhost/api/repos/nope/log'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('diff 端点：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const res = await getDiff(new Request('http://localhost/api/repos/r1/diff'), ctx('r1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('repos 端点：空注册表返回 200 与空数组', async () => {
    const res = await getRepos();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('open 端点：请求体缺 path 返回 400 INVALID_QUERY', async () => {
    const res = await postOpen(
      new Request('http://localhost/api/repos/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('open 端点：非 git 目录返回 400 NOT_A_GIT_REPO', async () => {
    const dir = tmpDir('rebased-web-next-plain-');
    const res = await postOpen(
      new Request('http://localhost/api/repos/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: dir }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_A_GIT_REPO' } });
  });

  it('settings 端点：GET 返回默认设置，PUT 局部更新后回读生效', async () => {
    const beforeRes = await getSettings();
    expect(beforeRes.status).toBe(200);
    expect(await beforeRes.json()).toEqual({ logInEditor: true, recentRepoIds: [] });

    const res = await putSettings(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logInEditor: false }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ logInEditor: false });

    const afterRes = await getSettings();
    expect(await afterRes.json()).toMatchObject({ logInEditor: false });
  });

  it('settings 端点：PUT 非法字段类型返回 400 INVALID_QUERY', async () => {
    const res = await putSettings(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logInEditor: 'yes' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('status 端点：已注册仓库返回 200 与 RepoStatus 形状', async () => {
    const repoId = registerRepo();
    const res = await getStatus(new Request(`http://localhost/api/repos/${repoId}/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ahead: 0, behind: 0, entries: [] });
    expect(typeof body.branch).toBe('string');
  });

  it('log 端点：已注册仓库返回 200 与 LogPage 形状', async () => {
    const repoId = registerRepo();
    const res = await getLog(new Request(`http://localhost/api/repos/${repoId}/log`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hasMore: false });
    expect(body.commits).toHaveLength(1);
    expect(body.commits[0].message).toContain('init');
    expect(body.commits[0]).toMatchObject({ author: 'Test User' });
  });

  it('diff 端点：已注册仓库 + file 返回 200 与 FileVersions 形状（Monaco 两侧全文）', async () => {
    const repoId = registerRepo();
    const res = await getDiff(new Request(`http://localhost/api/repos/${repoId}/diff?file=a.txt`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ before: 'hello\n', after: 'hello\n' });
  });
});
