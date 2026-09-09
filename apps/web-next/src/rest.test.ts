/**
 * web-next REST 路由测试：直接构造 Request 调 route 函数（不起 Next 服务）。
 * 拆分自原 routes.test.ts 的 'web-next REST 路由' describe：原单文件 194s 是测试提速瓶颈，
 * 按 describe 拆成多文件后由 vitest 多 worker 并行。
 * 测试体逐字保留；环境隔离与仓库夹具见 ./testing/routes-helpers。
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getRepos } from '../app/api/repos/route';
import { POST as postOpen } from '../app/api/repos/open/route';
import { GET as getStatus } from '../app/api/repos/[repoId]/status/route';
import { GET as getLog } from '../app/api/repos/[repoId]/log/route';
import { GET as getDiff } from '../app/api/repos/[repoId]/diff/route';
import { GET as getBranchWorkingDiff } from '../app/api/repos/[repoId]/diff/branch-working/route';
import { GET as getConfig, PUT as putConfig } from '../app/api/repos/[repoId]/config/route';
import { GET as getGpgConfig, PUT as putGpgConfig } from '../app/api/repos/[repoId]/settings/gpg-config/route';
import { GET as getOperation } from '../app/api/repos/[repoId]/operation/route';
import { POST as postAbort } from '../app/api/repos/[repoId]/operation/abort/route';
import { POST as postStaging } from '../app/api/repos/[repoId]/staging/route';
import { POST as postHunkStaging } from '../app/api/repos/[repoId]/staging/hunks/route';
import { POST as postCommit } from '../app/api/repos/[repoId]/commit/route';
import { GET as getCrlfWarningRoute } from '../app/api/repos/[repoId]/commit/crlf-warning/route';
import { GET as getAmendTargetsRoute } from '../app/api/repos/[repoId]/commit/amend-targets/route';
import { POST as postAmendSpecific } from '../app/api/repos/[repoId]/commit/amend-specific/route';
import { GET as getBranches, POST as postBranches } from '../app/api/repos/[repoId]/branches/route';
import { POST as postCheckout } from '../app/api/repos/[repoId]/checkout/route';
import { POST as postCheckoutRebase } from '../app/api/repos/[repoId]/checkout-rebase/route';
import { POST as postCheckoutUpdate } from '../app/api/repos/[repoId]/checkout-update/route';
import { POST as postReset } from '../app/api/repos/[repoId]/reset/route';
import { POST as postUndoCommit } from '../app/api/repos/[repoId]/reset/undo-commit/route';
import { GET as getDiffPatch } from '../app/api/repos/[repoId]/diff/patch/route';
import { GET as getSettings, PUT as putSettings } from '../app/api/settings/route';
import { GET as getGitExecutableInfo } from '../app/api/settings/git-executable/route';
import {
  cleanupTestEnv,
  ctx,
  lastRepoPath,
  makeLocalCommit,
  registerRepo as registerRepoBase,
  setupTestEnv,
  tmpDir,
} from './testing/routes-helpers';

/**
 * 文件级隔离（不改变任何用例内容）：本文件 'config 端点' 用例断言仓库本地 user.name 的
 * localValue='Test User'，而共享 registerRepo 按约定不再写本地身份配置（git 身份由
 * vitest setupFiles 注入的 GIT_* 环境变量提供）。故仅本文件在共享夹具之上补设本地身份配置。
 */
function registerRepo(): string {
  const repoId = registerRepoBase();
  execFileSync('git', ['-C', lastRepoPath, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', lastRepoPath, 'config', 'user.name', 'Test User']);
  return repoId;
}

beforeEach(() => {
  setupTestEnv();
});

afterEach(() => {
  cleanupTestEnv();
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

  it('diff/branch-working 端点：分支与工作树一致 → 空清单；ghost → 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    const main = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const okRes = await getBranchWorkingDiff(
      new Request(`http://localhost/api/repos/${repoId}/diff/branch-working?branch=${encodeURIComponent(main)}`),
      ctx(repoId),
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ branch: main, files: [] });

    const ghostRes = await getBranchWorkingDiff(
      new Request(`http://localhost/api/repos/${repoId}/diff/branch-working?branch=ghost`),
      ctx(repoId),
    );
    expect(ghostRes.status).toBe(400);
    expect(await ghostRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
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

  it('错误映射统一：空/非法 JSON 请求体 → 400 INVALID_QUERY（之前 SyntaxError 折 500，一等公民修复）', async () => {
    const res = await postOpen(
      new Request('http://localhost/api/repos/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
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
    expect(await beforeRes.json()).toEqual({ logInEditor: true, recentRepoIds: [], protectedBranchPatterns: [] });

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

  it('settings 端点：PUT 保护分支模式（合法/非法正则）→ 200/400', async () => {
    const okRes = await putSettings(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protectedBranchPatterns: ['^main$', '^release/'] }),
      }),
    );
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({ protectedBranchPatterns: ['^main$', '^release/'] });

    const badRes = await putSettings(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protectedBranchPatterns: ['(['] }),
      }),
    );
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('settings/git-executable 端点：200 GitExecutableInfo（本机 PATH git 可执行 → ok 且版本可解析）', async () => {
    const res = await getGitExecutableInfo(new Request('http://localhost/api/settings/git-executable'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exec: string; version: string | null; ok: boolean };
    expect(body.exec).toBe('git');
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^git version \S+/);
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

  it('config 端点：GET 返回 200 且 entries 覆盖 user.name 白名单键', async () => {
    const repoId = registerRepo();
    const res = await getConfig(new Request(`http://localhost/api/repos/${repoId}/config`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.entries.find((e: { key: string }) => e.key === 'user.name');
    expect(entry).toBeDefined();
    expect(entry.localValue).toBe('Test User'); // 夹具仓库本地已设 user.name
  });

  it('config 端点：PUT 白名单键返回 200 且刷新视图 localValue 生效', async () => {
    const repoId = registerRepo();
    const res = await putConfig(
      new Request(`http://localhost/api/repos/${repoId}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'user.name', value: '李四' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.entries.find((e: { key: string }) => e.key === 'user.name');
    expect(entry.localValue).toBe('李四');
  });

  it('config 端点：PUT 白名单外键返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await putConfig(
      new Request(`http://localhost/api/repos/${repoId}/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'core.hooksPath', value: '/x' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('config 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getConfig(new Request('http://localhost/api/repos/nope/config'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('gpg-config 端点：GET 返回视图（gpg 不可用 → keys 空）；PUT 写两键并复核；enabled 无 key → 400', { timeout: 120000 }, async () => {
    const repoId = registerRepo();
    execFileSync('git', ['-C', lastRepoPath, 'config', '--local', 'gpg.program', 'Z:\\no-such-dir\\gpg.exe']);
    const call = (method: 'GET' | 'PUT', body?: unknown) =>
      (method === 'GET' ? getGpgConfig : putGpgConfig)(
        new Request(`http://localhost/api/repos/${repoId}/settings/gpg-config`, {
          method,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
        ctx(repoId),
      );

    const getRes = await call('GET');
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ enabled: false, key: null, keys: [] });

    const KEY = 'A'.repeat(16);
    const putRes = await call('PUT', { enabled: true, key: KEY });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toMatchObject({ enabled: true, key: KEY });
    expect(
      execFileSync('git', ['-C', lastRepoPath, 'config', '--local', '--get', 'commit.gpgsign'], { encoding: 'utf8' }).trim(),
    ).toBe('true');

    const badRes = await call('PUT', { enabled: true });
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('operation 端点：无进行中操作返回 200 与 {kind:"none"}', async () => {
    const repoId = registerRepo();
    const res = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: 'none' });
  });

  it('operation/abort 端点：无进行中操作返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postAbort(
      new Request(`http://localhost/api/repos/${repoId}/operation/abort`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('operation 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getOperation(new Request('http://localhost/api/repos/nope/operation'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('staging 端点：stage 后返回 200 且 entries 反映暂存状态', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const res = await postStaging(
      new Request(`http://localhost/api/repos/${repoId}/staging`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stage', paths: ['a.txt'] }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.entries.find((e: { path: string }) => e.path === 'a.txt');
    expect(entry?.code.startsWith('M.')).toBe(true);
  });

  it('staging 端点：空 paths 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postStaging(
      new Request(`http://localhost/api/repos/${repoId}/staging`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stage', paths: [] }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('staging/hunks 端点：hunk 索引越界返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const res = await postHunkStaging(
      new Request(`http://localhost/api/repos/${repoId}/staging/hunks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stage', file: 'a.txt', hunks: [99] }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('diff/patch 端点：工作区改动后返回 200 且 text 以 diff --git 开头', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const res = await getDiffPatch(new Request(`http://localhost/api/repos/${repoId}/diff/patch?file=a.txt`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.path).toBe('a.txt');
    expect(body.text.startsWith('diff --git')).toBe(true);
  });

  it('diff/patch 端点：缺 file 查询参数返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await getDiffPatch(new Request(`http://localhost/api/repos/${repoId}/diff/patch`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('commit 端点：暂存后提交返回 200 且 hash 为 40 位十六进制', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);
    const res = await postCommit(
      new Request(`http://localhost/api/repos/${repoId}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '测试提交' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('amend 端点：amend-targets 候选列表 200；amend-specific 重写历史提交 200（提交数不变）', async () => {
    const repoId = registerRepo();
    makeLocalCommit('b.txt', 'two\n', 'second');
    const target = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim();

    const listRes = await getAmendTargetsRoute(
      new Request(`http://localhost/api/repos/${repoId}/commit/amend-targets`),
      ctx(repoId),
    );
    expect(listRes.status).toBe(200);
    const targets = await listRes.json();
    // init（HEAD 排除）+ second → 只剩 init 一条候选（新→旧）
    expect(targets.map((t: { subject: string }) => t.subject)).toEqual(['init']);

    const amendRes = await postAmendSpecific(
      new Request(`http://localhost/api/repos/${repoId}/commit/amend-specific`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetHash: target, message: 'init（重写）' }),
      }),
      ctx(repoId),
    );
    expect(amendRes.status).toBe(200);
    const body = await amendRes.json();
    expect(body.status).toBe('success');
    expect(body.hash).toMatch(/^[0-9a-f]{40}$/);
    const subjects = execFileSync('git', ['-C', lastRepoPath, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n').reverse();
    expect(subjects).toEqual(['init（重写）', 'second']);
    expect(execFileSync('git', ['-C', lastRepoPath, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('2');

    // 无效目标 → 400 INVALID_REF
    const badRes = await postAmendSpecific(
      new Request(`http://localhost/api/repos/${repoId}/commit/amend-specific`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetHash: 'deadbeef'.repeat(5), message: 'x' }),
      }),
      ctx(repoId),
    );
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('commit 端点：空 message 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postCommit(
      new Request(`http://localhost/api/repos/${repoId}/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: '' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('commit/crlf-warning 端点：暂存 CRLF 文件（无属性覆盖）→ 200 {warning:true,files}；暂存区空 → 200 {warning:false}', async () => {
    const repoId = registerRepo();
    const url = (id: string) => new Request(`http://localhost/api/repos/${id}/commit/crlf-warning`);

    // 空暂存 → false
    const cleanRes = await getCrlfWarningRoute(url(repoId), ctx(repoId));
    expect(cleanRes.status).toBe(200);
    const clean = (await cleanRes.json()) as { warning: boolean; files: string[] };
    expect(clean.warning).toBe(false);

    // 暂存 CRLF 内容文件 → Windows 平台 true 且列涉事文件（GitCrlfProblemsDetector 语义）
    // 本机系统 gitconfig 可能默认 core.autocrlf=true（Git for Windows），本地覆盖为 false 以走检测主路径
    execFileSync('git', ['-C', lastRepoPath, 'config', 'core.autocrlf', 'false']);
    writeFileSync(join(lastRepoPath, 'crlf.txt'), 'line1\r\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'crlf.txt']);
    const warnRes = await getCrlfWarningRoute(url(repoId), ctx(repoId));
    expect(warnRes.status).toBe(200);
    const warn = (await warnRes.json()) as { warning: boolean; files: string[] };
    if (process.platform === 'win32') {
      expect(warn.warning).toBe(true);
      expect(warn.files).toContain('crlf.txt');
    } else {
      expect(warn.warning).toBe(false);
    }
  });

  it('branches 端点：GET 返回 200 且列表含当前分支（current=true）', async () => {
    const repoId = registerRepo();
    const current = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const res = await getBranches(new Request(`http://localhost/api/repos/${repoId}/branches`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.branches.find((b: { name: string }) => b.name === current);
    expect(entry).toBeDefined();
    expect(entry.current).toBe(true);
    // 最近检出组（reflog）：初始无 checkout 记录 → 空数组
    expect(body.recent).toEqual([]);
  });

  it('branches 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getBranches(new Request('http://localhost/api/repos/nope/branches'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('branches 端点：POST create 返回 200 且刷新列表含新分支', async () => {
    const repoId = registerRepo();
    const res = await postBranches(
      new Request(`http://localhost/api/repos/${repoId}/branches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: 'b1' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.branches.some((b: { name: string }) => b.name === 'b1')).toBe(true);
  });

  it('branches 端点：POST 缺 name 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postBranches(
      new Request(`http://localhost/api/repos/${repoId}/branches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('checkout 端点：branch 检出既有分支返回 200 且 branch 为目标名', async () => {
    const repoId = registerRepo();
    const createRes = await postBranches(
      new Request(`http://localhost/api/repos/${repoId}/branches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: 'b1' }),
      }),
      ctx(repoId),
    );
    expect(createRes.status).toBe(200);
    const res = await postCheckout(
      new Request(`http://localhost/api/repos/${repoId}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'branch', name: 'b1' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).branch).toBe('b1');
  });

  it('checkout 端点：检出不存在分支返回 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    const res = await postCheckout(
      new Request(`http://localhost/api/repos/${repoId}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'branch', name: 'nope' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('checkout-rebase 端点：目标分支检出并变基到当前 → 200 success 且当前分支切换；当前分支/不存在 → 400', { timeout: 120000 }, async () => {
    const repoId = registerRepo();
    const main = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '-q', '-b', 'dev']);
    writeFileSync(join(lastRepoPath, 'dev.txt'), 'dev\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'dev.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'dev']);
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '-q', main]);
    writeFileSync(join(lastRepoPath, 'main.txt'), 'main\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'main.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'main']);
    const post = (path: string, body: unknown) =>
      postCheckoutRebase(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ctx(repoId),
      );

    const res = await post(`/api/repos/${repoId}/checkout-rebase`, { branch: 'dev' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('dev');
    expect(execFileSync('git', ['-C', lastRepoPath, 'show', 'HEAD:main.txt'], { encoding: 'utf8' })).toBe('main\n');

    // 目标为当前分支 → INVALID_QUERY；分支不存在 → INVALID_REF
    const curRes = await post(`/api/repos/${repoId}/checkout-rebase`, { branch: 'dev' });
    expect(curRes.status).toBe(400);
    expect(await curRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const refRes = await post(`/api/repos/${repoId}/checkout-rebase`, { branch: 'ghost' });
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('checkout-update 端点：本地分支（已设上游）检出并更新 → 200 success 且分支切换；无上游/当前 → 400', { timeout: 120000 }, async () => {
    const repoId = registerRepo();
    const main = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const bare = tmpDir('rebased-web-next-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'push', '-q', '-u', 'origin', main]);
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '-q', '-b', 'dev']);
    execFileSync('git', ['-C', lastRepoPath, 'push', '-q', '-u', 'origin', 'dev']);
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '-q', main]);
    const other = tmpDir('rebased-web-next-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 't@t.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 't']);
    writeFileSync(join(other, 'remote.txt'), 'remote\n');
    execFileSync('git', ['-C', other, 'add', 'remote.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'remote dev']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:dev']);
    const post = (path: string, body: unknown) =>
      postCheckoutUpdate(
        new Request(`http://localhost${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ctx(repoId),
      );

    const res = await post(`/api/repos/${repoId}/checkout-update`, { branch: 'dev' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('dev');
    expect(execFileSync('git', ['-C', lastRepoPath, 'show', 'HEAD:remote.txt'], { encoding: 'utf8' })).toBe('remote\n');

    const curRes = await post(`/api/repos/${repoId}/checkout-update`, { branch: 'dev' });
    expect(curRes.status).toBe(400);
    expect(await curRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });

    const refRes = await post(`/api/repos/${repoId}/checkout-update`, { branch: 'ghost' });
    expect(refRes.status).toBe(400);
    expect(await refRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('reset 端点：soft 重置到 HEAD~1 返回 200 且 headHash 回退', async () => {
    const repoId = registerRepo();
    const base = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'second']);
    const res = await postReset(
      new Request(`http://localhost/api/repos/${repoId}/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: 'HEAD~1', mode: 'soft' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.headHash).toBe(base);
  });

  it('reset 端点：空 ref 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postReset(
      new Request(`http://localhost/api/repos/${repoId}/reset`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: '', mode: 'soft' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('reset 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postReset(
      new Request('http://localhost/api/repos/nope/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: 'HEAD~1', mode: 'soft' }),
      }),
      ctx('nope'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('reset/undo-commit 端点：撤销最近提交返回 200 且 headHash 回退', async () => {
    const repoId = registerRepo();
    const base = execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    execFileSync('git', ['-C', lastRepoPath, 'add', 'a.txt']);
    execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', 'second']);
    const res = await postUndoCommit(
      new Request(`http://localhost/api/repos/${repoId}/reset/undo-commit`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.headHash).toBe(base);
  });

  it('reset/undo-commit 端点：根提交上再撤销返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo(); // 仅一次提交（根提交）：无可撤销
    const res = await postUndoCommit(
      new Request(`http://localhost/api/repos/${repoId}/reset/undo-commit`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
});
