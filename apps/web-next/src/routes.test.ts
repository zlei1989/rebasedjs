/**
 * web-next REST 路由测试：直接构造 Request 调 route 函数（不起 Next 服务）。
 * 每个用例独立 REBASED_CONFIG_DIR（空注册表）；成功路径先注册临时 git 仓库再断言响应形状。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertAccount } from '@rebased/api';
import { GET as getRepos } from '../app/api/repos/route';
import { POST as postOpen } from '../app/api/repos/open/route';
import { GET as getStatus } from '../app/api/repos/[repoId]/status/route';
import { GET as getLog } from '../app/api/repos/[repoId]/log/route';
import { GET as getDiff } from '../app/api/repos/[repoId]/diff/route';
import { GET as getConfig, PUT as putConfig } from '../app/api/repos/[repoId]/config/route';
import { GET as getOperation } from '../app/api/repos/[repoId]/operation/route';
import { POST as postAbort } from '../app/api/repos/[repoId]/operation/abort/route';
import { POST as postStaging } from '../app/api/repos/[repoId]/staging/route';
import { POST as postHunkStaging } from '../app/api/repos/[repoId]/staging/hunks/route';
import { POST as postCommit } from '../app/api/repos/[repoId]/commit/route';
import { GET as getBranches, POST as postBranches } from '../app/api/repos/[repoId]/branches/route';
import { GET as getStashes, POST as postStashes } from '../app/api/repos/[repoId]/stashes/route';
import { GET as getRemotes, POST as postRemotes } from '../app/api/repos/[repoId]/remotes/route';
import { POST as postFetch } from '../app/api/repos/[repoId]/fetch/route';
import { POST as postPull } from '../app/api/repos/[repoId]/pull/route';
import { POST as postPush } from '../app/api/repos/[repoId]/push/route';
import { POST as postUpdate } from '../app/api/repos/[repoId]/update/route';
import { GET as getChangelists, POST as postChangelists } from '../app/api/repos/[repoId]/changelists/route';
import { POST as postCheckout } from '../app/api/repos/[repoId]/checkout/route';
import { POST as postReset } from '../app/api/repos/[repoId]/reset/route';
import { POST as postUndoCommit } from '../app/api/repos/[repoId]/reset/undo-commit/route';
import { GET as getDiffPatch } from '../app/api/repos/[repoId]/diff/patch/route';
import { POST as postMerge } from '../app/api/repos/[repoId]/merge/route';
import { POST as postMergeContinue } from '../app/api/repos/[repoId]/merge/continue/route';
import { GET as getConflicts } from '../app/api/repos/[repoId]/conflicts/route';
import { GET as getConflictContentsRoute } from '../app/api/repos/[repoId]/conflicts/contents/route';
import { POST as postResolveConflict } from '../app/api/repos/[repoId]/conflicts/resolve/route';
import { GET as getSettings, PUT as putSettings } from '../app/api/settings/route';
import { GET as getAccounts, POST as postAccounts } from '../app/api/auth/accounts/route';
import { POST as postAccountDelete } from '../app/api/auth/accounts/delete/route';
import { POST as postRebase } from '../app/api/repos/[repoId]/rebase/route';
import { GET as getRebaseTodo } from '../app/api/repos/[repoId]/rebase/todo/route';
import { POST as postInteractiveRebase } from '../app/api/repos/[repoId]/rebase/interactive/route';
import { POST as postCherryPick } from '../app/api/repos/[repoId]/cherry-pick/route';
import { POST as postRevert } from '../app/api/repos/[repoId]/revert/route';
import { POST as postContinueOperation } from '../app/api/repos/[repoId]/operation/continue/route';
import { GET as getTags, POST as postTags } from '../app/api/repos/[repoId]/tags/route';
import { GET as getBlame } from '../app/api/repos/[repoId]/blame/route';
import { GET as getHistory } from '../app/api/repos/[repoId]/history/route';
import { GET as getCommitted } from '../app/api/repos/[repoId]/committed/route';
import { GET as getSearch } from '../app/api/repos/[repoId]/search/route';
import { GET as getPatches } from '../app/api/repos/[repoId]/patches/route';
import { POST as postPatchCreate } from '../app/api/repos/[repoId]/patches/create/route';
import { POST as postPatchApply } from '../app/api/repos/[repoId]/patches/apply/route';
import { POST as postPatchDelete } from '../app/api/repos/[repoId]/patches/delete/route';
import { GET as getShelves, POST as postShelves } from '../app/api/repos/[repoId]/shelves/route';
import { GET as getConsole } from '../app/api/repos/[repoId]/console/route';
import { GET as getIgnore, PUT as putIgnore } from '../app/api/repos/[repoId]/ignore/route';
import { POST as postIgnoreAdd } from '../app/api/repos/[repoId]/ignore/add/route';
import { GET as getIgnoreTemplates } from '../app/api/repos/[repoId]/ignore/templates/route';
import { GET as getGithubStatus } from '../app/api/repos/[repoId]/github/status/route';
import { GET as getGithubPrs } from '../app/api/repos/[repoId]/github/prs/route';
import { GET as getGithubPrDetail } from '../app/api/repos/[repoId]/github/prs/[number]/route';
import { GET as getGithubPrTimeline } from '../app/api/repos/[repoId]/github/prs/[number]/timeline/route';
import { POST as postGithubComment } from '../app/api/repos/[repoId]/github/prs/[number]/comments/route';
import { GET as getGithubPrFiles } from '../app/api/repos/[repoId]/github/prs/[number]/files/route';
import { POST as postGithubReview } from '../app/api/repos/[repoId]/github/prs/[number]/review/route';
import { POST as postGithubMerge } from '../app/api/repos/[repoId]/github/prs/[number]/merge/route';
import { POST as postGithubCheckout } from '../app/api/repos/[repoId]/github/prs/[number]/checkout/route';
import { GET as getGitlabStatus } from '../app/api/repos/[repoId]/gitlab/status/route';
import { GET as getGitlabMrs, POST as postGitlabMrCreate } from '../app/api/repos/[repoId]/gitlab/mrs/route';
import { GET as getGitlabMrDetail } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/route';
import { GET as getGitlabMrTimeline } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/timeline/route';
import { POST as postGitlabComment } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/comments/route';
import { GET as getGitlabMrFiles } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/files/route';
import { POST as postGitlabReview } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/review/route';
import { POST as postGitlabMerge } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/merge/route';
import { POST as postGitlabCheckout } from '../app/api/repos/[repoId]/gitlab/mrs/[iid]/checkout/route';
import { GET as getWorktrees, POST as postWorktreeCreate } from '../app/api/repos/[repoId]/worktrees/route';
import { POST as postWorktreeRemove } from '../app/api/repos/[repoId]/worktrees/remove/route';
import { POST as postWorktreePrune } from '../app/api/repos/[repoId]/worktrees/prune/route';
import { GET as getSubmodulesRoute } from '../app/api/repos/[repoId]/submodules/route';
import { POST as postSubmoduleUpdate } from '../app/api/repos/[repoId]/submodules/update/route';

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

/** 最近一次 registerRepo 的仓库磁盘路径（供测试内制造工作区改动） */
let lastRepoPath = '';

/** 建临时 git 仓库（一次提交）并写入配置注册表，返回注册 repoId */
function registerRepo(): string {
  const repo = tmpDir('rebased-web-next-repo-');
  lastRepoPath = repo;
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

/** 冲突夹具：在 registerRepo 的仓库上造 side/main 两侧改 a.txt 同一行（合并必冲突，stage 1/2/3 全在） */
function makeConflictScenario(): void {
  const repo = lastRepoPath;
  const main = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'side']);
  writeFileSync(join(repo, 'a.txt'), 'side\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'side']);
  execFileSync('git', ['-C', repo, 'checkout', '-q', main]);
  writeFileSync(join(repo, 'a.txt'), 'main\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'main']);
}

/** 裸仓库对端装置：注册仓库 + bare 当 origin + push -u 建 upstream；裸仓库 HEAD 指默认分支（配方同 api 层 remote 测试） */
function makeRemoteRig(): { repoId: string; bare: string; defaultBranch: string } {
  const repoId = registerRepo();
  const repo = lastRepoPath;
  const defaultBranch = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const bare = tmpDir('rebased-web-next-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', bare]);
  execFileSync('git', ['-C', repo, 'push', '-q', '-u', 'origin', defaultBranch]);
  execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repoId, bare, defaultBranch };
}

/** 第二 clone 对端：提交并推到裸仓库默认分支（制造远端新提交/分叉） */
function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = tmpDir('rebased-web-next-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
  execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
  writeFileSync(join(other, filename), content);
  execFileSync('git', ['-C', other, 'add', filename]);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', `remote: ${filename}`]);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

/** 本地新提交（在 registerRepo 的仓库工作区上） */
function makeLocalCommit(filename: string, content: string, message: string): void {
  writeFileSync(join(lastRepoPath, filename), content);
  execFileSync('git', ['-C', lastRepoPath, 'add', filename]);
  execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', message]);
}

beforeEach(() => {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-next-config-');
});

afterEach(() => {
  delete process.env.REBASED_CONFIG_DIR;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

describe('web-next auth 账户路由（应用级，无 repoId）', () => {
  const jsonPost = (url: string, body: unknown) =>
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('GET /api/auth/accounts：空配置返回 200 与空账户列表', async () => {
    const res = await getAccounts();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：添加返回掩码视图且响应不含原 token', async () => {
    const token = 'ghp_secret123456';
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain(token);
    expect(body).toEqual({ accounts: [{ host: 'github.com', account: 'zhang', tokenPreview: 'ghp_***' }] });
  });

  it('POST /api/auth/accounts：同 host+account 重复添加覆盖（列表长度 1）', async () => {
    await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'oldtoken123456' }));
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'newtoken654321' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].tokenPreview).toBe('newt***');
  });

  it('POST /api/auth/accounts/delete：删除后列表移除该账户', async () => {
    await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: 'ghp_abc123' }));
    const res = await postAccountDelete(jsonPost('http://localhost/api/auth/accounts/delete', { host: 'github.com', account: 'zhang' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accounts: [] });
  });

  it('POST /api/auth/accounts：空 token（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const res = await postAccounts(jsonPost('http://localhost/api/auth/accounts', { host: 'github.com', account: 'zhang', token: '' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('POST /api/auth/accounts/delete：删除不存在账户返回 400 INVALID_QUERY', async () => {
    const res = await postAccountDelete(jsonPost('http://localhost/api/auth/accounts/delete', { host: 'github.com', account: 'nobody' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });
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

  it('branches 端点：GET 返回 200 且列表含当前分支（current=true）', async () => {
    const repoId = registerRepo();
    const current = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const res = await getBranches(new Request(`http://localhost/api/repos/${repoId}/branches`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    const entry = body.branches.find((b: { name: string }) => b.name === current);
    expect(entry).toBeDefined();
    expect(entry.current).toBe(true);
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

describe('web-next merge/conflicts 路由', () => {
  it('冲突全流程：merge→conflicts 列表→contents 三版本→resolve theirs→continue→操作态清零', async () => {
    const repoId = registerRepo();
    makeConflictScenario();

    // POST merge：冲突合并 → 200 MergeOutcome{status:'conflicts'} 附带冲突列表
    const mergeRes = await postMerge(
      new Request(`http://localhost/api/repos/${repoId}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: 'side' }),
      }),
      ctx(repoId),
    );
    expect(mergeRes.status).toBe(200);
    const outcome = await mergeRes.json();
    expect(outcome.status).toBe('conflicts');
    expect(outcome.conflicts).toEqual([{ path: 'a.txt', stages: [1, 2, 3] }]);

    // GET conflicts：列出冲突路径
    const listRes = await getConflicts(new Request(`http://localhost/api/repos/${repoId}/conflicts`), ctx(repoId));
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual({ conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] });

    // GET conflicts/contents：base/ours/theirs 三字段齐
    const contentsRes = await getConflictContentsRoute(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/contents?path=a.txt`),
      ctx(repoId),
    );
    expect(contentsRes.status).toBe(200);
    expect(await contentsRes.json()).toEqual({ path: 'a.txt', base: 'hello\n', ours: 'main\n', theirs: 'side\n' });

    // POST conflicts/resolve：theirs 采纳 → 列表变空
    const resolveRes = await postResolveConflict(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'theirs', path: 'a.txt' }),
      }),
      ctx(repoId),
    );
    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toEqual({ conflicts: [] });

    // POST merge/continue（无请求体）：产合并提交 → 200 RepoStatus
    const continueRes = await postMergeContinue(
      new Request(`http://localhost/api/repos/${repoId}/merge/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(continueRes.status).toBe(200);
    expect(await continueRes.json()).toMatchObject({ entries: [] });

    // 操作态清零
    const opRes = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect(await opRes.json()).toEqual({ kind: 'none' });
  });

  it('merge 端点：空 branch 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postMerge(
      new Request(`http://localhost/api/repos/${repoId}/merge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: '' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('merge 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postMerge(
      new Request('http://localhost/api/repos/nope/merge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch: 'side' }),
      }),
      ctx('nope'),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('merge/continue 端点：无进行中合并返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postMergeContinue(
      new Request(`http://localhost/api/repos/${repoId}/merge/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('conflicts/contents 端点：缺 path 查询参数返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await getConflictContentsRoute(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/contents`),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('conflicts/resolve 端点：非法 strategy 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postResolveConflict(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'base', path: 'a.txt' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('stashes 端点：GET 返回 200 且空贮藏列表', async () => {
    const repoId = registerRepo();
    const res = await getStashes(new Request(`http://localhost/api/repos/${repoId}/stashes`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stashes: [] });
  });

  it('stashes 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getStashes(new Request('http://localhost/api/repos/nope/stashes'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('stashes 端点：save → apply → drop 往返均返回 200 刷新列表', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const post = (body: unknown) =>
      postStashes(
        new Request(`http://localhost/api/repos/${repoId}/stashes`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        ctx(repoId),
      );
    const saveRes = await post({ action: 'save', message: 'wip' });
    expect(saveRes.status).toBe(200);
    expect((await saveRes.json()).stashes).toHaveLength(1);
    const applyRes = await post({ action: 'apply', index: 0 });
    expect(applyRes.status).toBe(200);
    expect((await applyRes.json()).stashes).toHaveLength(1);
    const dropRes = await post({ action: 'drop', index: 0 });
    expect(dropRes.status).toBe(200);
    expect((await dropRes.json()).stashes).toHaveLength(0);
  });

  it('stashes 端点：pop 带负 index 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postStashes(
      new Request(`http://localhost/api/repos/${repoId}/stashes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'pop', index: -1 }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('stashes 端点：无工作区改动 save 返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postStashes(
      new Request(`http://localhost/api/repos/${repoId}/stashes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'save' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('changelists 端点：GET 返回 200 含默认列表', async () => {
    const repoId = registerRepo();
    const res = await getChangelists(new Request(`http://localhost/api/repos/${repoId}/changelists`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lists: [{ id: 'default', name: '默认', isDefault: true }],
      assignments: {},
    });
  });

  it('changelists 端点：POST create 返回 200 两列表', async () => {
    const repoId = registerRepo();
    const res = await postChangelists(
      new Request(`http://localhost/api/repos/${repoId}/changelists`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: '进行中' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lists).toHaveLength(2);
    expect(body.lists[0]).toEqual({ id: 'default', name: '默认', isDefault: true });
    expect(body.lists[1]).toMatchObject({ name: '进行中', isDefault: false });
  });

  it('changelists 端点：POST move 到不存在列表返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postChangelists(
      new Request(`http://localhost/api/repos/${repoId}/changelists`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'move', paths: ['a.txt'], targetId: 'no-such-list' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('changelists 端点：POST create 缺 name（zod 拒绝）返回 400', async () => {
    const repoId = registerRepo();
    const res = await postChangelists(
      new Request(`http://localhost/api/repos/${repoId}/changelists`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
  });

  it('changelists 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getChangelists(new Request('http://localhost/api/repos/nope/changelists'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});

describe('web-next remotes/fetch/pull/push/update 路由', () => {
  /** 裸仓库装置用例 git 进程密集（本机单次 git 进程启动约秒级），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const postJson = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('remotes 端点：GET 空列表 → add → setUrl → remove 往返均返回刷新 RemoteList', async () => {
    const repoId = registerRepo();
    const getRes = await getRemotes(new Request(`http://localhost/api/repos/${repoId}/remotes`), ctx(repoId));
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ remotes: [] });

    const addRes = await postRemotes(
      postJson(`${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' }),
      ctx(repoId),
    );
    expect(addRes.status).toBe(200);
    expect(await addRes.json()).toEqual({
      remotes: [{ name: 'origin', fetchUrl: 'https://example.com/a.git', pushUrl: 'https://example.com/a.git' }],
    });

    const setUrlRes = await postRemotes(
      postJson(`${repoId}/remotes`, { action: 'setUrl', name: 'origin', url: 'https://example.com/b.git' }),
      ctx(repoId),
    );
    expect(setUrlRes.status).toBe(200);
    expect((await setUrlRes.json()).remotes).toEqual([
      { name: 'origin', fetchUrl: 'https://example.com/b.git', pushUrl: 'https://example.com/b.git' },
    ]);

    const removeRes = await postRemotes(postJson(`${repoId}/remotes`, { action: 'remove', name: 'origin' }), ctx(repoId));
    expect(removeRes.status).toBe(200);
    expect(await removeRes.json()).toEqual({ remotes: [] });
  });

  it('remotes 端点：add 重名 → 400 INVALID_QUERY；remove 不存在 → 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    await postRemotes(postJson(`${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/a.git' }), ctx(repoId));
    const dupRes = await postRemotes(
      postJson(`${repoId}/remotes`, { action: 'add', name: 'origin', url: 'https://example.com/x.git' }),
      ctx(repoId),
    );
    expect(dupRes.status).toBe(400);
    expect(await dupRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const removeRes = await postRemotes(postJson(`${repoId}/remotes`, { action: 'remove', name: 'nope' }), ctx(repoId));
    expect(removeRes.status).toBe(400);
    expect(await removeRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('remotes 端点：未知 action（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postRemotes(postJson(`${repoId}/remotes`, { action: 'wat', name: 'origin' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('remotes 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await getRemotes(new Request('http://localhost/api/repos/nope/remotes'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('fetch 端点：对端新提交后 fetch 返回 200 FetchResult（updatedRefs 含对应引用）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postFetch(postJson(`${repoId}/fetch`, {}), ctx(repoId)); // fetch 体可空 {}
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.updatedRefs).toContain(`refs/remotes/origin/${defaultBranch}`);
  });

  it('fetch 端点：remote 非字符串（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postFetch(postJson(`${repoId}/fetch`, { remote: 123 }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('pull 端点：对端新提交 pull 返回 200 updated 且工作区同步', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postPull(postJson(`${repoId}/pull`, { remote: 'origin' }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'updated' });
    expect(readFileSync(join(lastRepoPath, 'b.txt'), 'utf8')).toBe('from-other');
  });

  it('pull 端点：rebase 非布尔（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postPull(postJson(`${repoId}/pull`, { rebase: 'yes' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('push 端点：本地新提交 push 返回 200 pushed 且对端可见', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    makeLocalCommit('b.txt', 'local', 'local commit');
    const res = await postPush(postJson(`${repoId}/push`, { remote: 'origin', branch: defaultBranch }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pushed' });
    const bareHead = execFileSync('git', ['-C', bare, 'rev-parse', defaultBranch], { encoding: 'utf8' }).trim();
    expect(bareHead).toBe(execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
  });

  it('push 端点：分叉后 push 返回 200 rejected + 中文 hint（业务结果，不做 409 特判）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    makeLocalCommit('c.txt', 'local', 'local commit');
    const res = await postPush(postJson(`${repoId}/push`, { remote: 'origin', branch: defaultBranch }), ctx(repoId));
    expect(res.status).toBe(200); // PushOutcome.rejected 是 200 业务结果，409 保留给真冲突
    expect(await res.json()).toEqual({ status: 'rejected', hint: '远端有更新的提交，请先拉取/变基' });
  });

  it('push 端点：forceWithLease 非布尔（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postPush(postJson(`${repoId}/push`, { forceWithLease: 'yes' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('update 端点：merge 策略返回 200 UpdateOutcome（fetched + pull.updated 且工作区同步）', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare, defaultBranch } = makeRemoteRig();
    pushRemoteCommit(bare, defaultBranch, 'b.txt', 'from-other');
    const res = await postUpdate(postJson(`${repoId}/update`, { strategy: 'merge' }), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pull.status).toBe('updated');
    expect(body.fetched).toContain(`refs/remotes/origin/${defaultBranch}`);
    expect(readFileSync(join(lastRepoPath, 'b.txt'), 'utf8')).toBe('from-other');
  });

  it('update 端点：非法 strategy（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postUpdate(postJson(`${repoId}/update`, { strategy: 'ff-only' }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('update 端点：未注册 repoId 返回 404 REPO_NOT_FOUND', async () => {
    const res = await postUpdate(postJson('nope/update', { strategy: 'merge' }), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
});

describe('web-next rebase/cherry-pick/revert/tags 路由', () => {
  /** 本组用例 git 进程密集（变基/摘樱桃/裸仓库对端 + log 复核），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  /** 在最近注册仓库上执行 git（返回 stdout） */
  const git = (args: string[]): string => execFileSync('git', ['-C', lastRepoPath, ...args], { encoding: 'utf8' });
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('rebase 端点：main 上 rebase onto side → 200 success 且历史线性', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const main = git(['symbolic-ref', '--short', 'HEAD']).trim();
    git(['checkout', '-q', '-b', 'side']);
    makeLocalCommit('side.txt', 'side\n', 'side');
    git(['checkout', '-q', main]);
    makeLocalCommit('main.txt', 'main\n', 'main');

    const res = await postRebase(jsonPost(`${repoId}/rebase`, { onto: 'side' }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['main', 'side', 'init']);
  });

  it('rebase/todo 端点：base..HEAD 反序返回全量提交（哈希+主题）', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const base = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('one.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('two.txt', 'two\n', 'two');
    const two = git(['rev-parse', 'HEAD']).trim();

    const res = await getRebaseTodo(
      new Request(`http://localhost/api/repos/${repoId}/rebase/todo?base=${base}`),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { hash: one, subject: 'one' },
      { hash: two, subject: 'two' },
    ]);
  });

  it('rebase/interactive 端点：drop 中间提交 → 200 success 且 git log 复核（中间提交消失）', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const base = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('one.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('two.txt', 'two\n', 'two');
    const two = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('three.txt', 'three\n', 'three');
    const three = git(['rev-parse', 'HEAD']).trim();

    const res = await postInteractiveRebase(
      jsonPost(`${repoId}/rebase/interactive`, {
        base,
        entries: [
          { hash: one, action: 'pick' },
          { hash: two, action: 'drop' },
          { hash: three, action: 'pick' },
        ],
      }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-3']).trim().split('\n')).toEqual(['three', 'one', 'init']);
    expect(git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).toContain('one.txt');
    expect(git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')).not.toContain('two.txt');
  });

  it('cherry-pick 端点：祖先提交摘樱桃 → 200 success', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const base = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('c.txt', 'two\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    git(['reset', '-q', '--hard', base]);

    const res = await postCherryPick(jsonPost(`${repoId}/cherry-pick`, { hashes: [one] }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-2']).trim().split('\n')).toEqual(['one', 'init']);
    expect(git(['show', 'HEAD:c.txt'])).toBe('two\n');
  });

  it('cherry-pick 端点：祖先提交（已在当前分支历史）→ 400 INVALID_QUERY 且不留空补丁停态', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('one.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();
    makeLocalCommit('two.txt', 'two\n', 'two');

    const res = await postCherryPick(jsonPost(`${repoId}/cherry-pick`, { hashes: [one] }), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    // 预检在 git 创建停态之前拦下（复刻终审实验：祖先摘樱桃不再进入空补丁停态）
    expect(existsSync(join(lastRepoPath, '.git', 'CHERRY_PICK_HEAD'))).toBe(false);
  });

  it('revert 端点：还原祖先提交 → 200 success 且生成 Revert 提交', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeLocalCommit('a.txt', 'one\n', 'one');
    const one = git(['rev-parse', 'HEAD']).trim();

    const res = await postRevert(jsonPost(`${repoId}/revert`, { hashes: [one] }), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'success' });
    expect(git(['log', '--format=%s', '-1']).trim()).toBe('Revert "one"');
    expect(git(['show', 'HEAD:a.txt'])).toBe('hello\n');
  });

  it('operation/continue 端点：无进行中操作（无请求体 POST）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postContinueOperation(
      new Request(`http://localhost/api/repos/${repoId}/operation/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('rebase 冲突全流程：rebase→conflicts 列表→resolve theirs→operation/continue→操作态清零', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    makeConflictScenario();

    // POST rebase：双向改同一行 → 200 RebaseOutcome{status:'conflicts'}
    const rebaseRes = await postRebase(jsonPost(`${repoId}/rebase`, { onto: 'side' }), ctx(repoId));
    expect(rebaseRes.status).toBe(200);
    expect(await rebaseRes.json()).toEqual({ status: 'conflicts' });

    // 操作态为 rebase
    const opRes = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect((await opRes.json()) as { kind: string }).toMatchObject({ kind: 'rebase' });

    // GET conflicts：冲突路径齐
    const listRes = await getConflicts(new Request(`http://localhost/api/repos/${repoId}/conflicts`), ctx(repoId));
    expect(await listRes.json()).toEqual({ conflicts: [{ path: 'a.txt', stages: [1, 2, 3] }] });

    // POST conflicts/resolve：theirs 采纳 → 列表变空
    const resolveRes = await postResolveConflict(
      new Request(`http://localhost/api/repos/${repoId}/conflicts/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: 'theirs', path: 'a.txt' }),
      }),
      ctx(repoId),
    );
    expect(resolveRes.status).toBe(200);
    expect(await resolveRes.json()).toEqual({ conflicts: [] });

    // POST operation/continue（无请求体）：rebase --continue → 200 RepoStatus
    const continueRes = await postContinueOperation(
      new Request(`http://localhost/api/repos/${repoId}/operation/continue`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(continueRes.status).toBe(200);
    expect(await continueRes.json()).toMatchObject({ entries: [] });

    // 操作态清零
    const opAfter = await getOperation(new Request(`http://localhost/api/repos/${repoId}/operation`), ctx(repoId));
    expect(await opAfter.json()).toEqual({ kind: 'none' });
  });

  it('tags 端点：GET 空 → create 轻量/附注 → push 裸仓库 → delete 往返', { timeout: RIG_TIMEOUT }, async () => {
    const { repoId, bare } = makeRemoteRig();
    const head = git(['rev-parse', 'HEAD']).trim();

    const getRes = await getTags(new Request(`http://localhost/api/repos/${repoId}/tags`), ctx(repoId));
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ tags: [] });

    // 轻量标签：hash 即提交哈希，subject 即提交主题，annotated=false
    const createLight = await postTags(
      jsonPost(`${repoId}/tags`, { action: 'create', name: 'v1', ref: 'HEAD' }),
      ctx(repoId),
    );
    expect(createLight.status).toBe(200);
    let list = (await createLight.json()) as { tags: Array<{ name: string; hash: string; subject: string | null; annotated: boolean }> };
    expect(list.tags).toEqual([{ name: 'v1', hash: head, subject: 'init', annotated: false }]);

    // 附注标签：annotated=true，subject 为附注消息
    const createAnnotated = await postTags(
      jsonPost(`${repoId}/tags`, { action: 'create', name: 'v2', message: '发布 1.0' }),
      ctx(repoId),
    );
    expect(createAnnotated.status).toBe(200);
    list = (await createAnnotated.json()) as typeof list;
    const v2 = list.tags.find((t) => t.name === 'v2');
    expect(v2?.annotated).toBe(true);
    expect(v2?.subject).toBe('发布 1.0');

    // push 到裸仓库对端：200 刷新列表且对端 refs/tags/v1 可见
    const pushRes = await postTags(
      jsonPost(`${repoId}/tags`, { action: 'push', name: 'v1', remote: 'origin' }),
      ctx(repoId),
    );
    expect(pushRes.status).toBe(200);
    expect(((await pushRes.json()) as { tags: unknown[] }).tags).toHaveLength(2);
    const bareTag = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/tags/v1'], { encoding: 'utf8' }).trim();
    expect(bareTag).toBe(head);

    // delete：200 刷新列表仅剩 v1
    const deleteRes = await postTags(jsonPost(`${repoId}/tags`, { action: 'delete', name: 'v2' }), ctx(repoId));
    expect(deleteRes.status).toBe(200);
    expect(await deleteRes.json()).toEqual({ tags: [{ name: 'v1', hash: head, subject: 'init', annotated: false }] });
  });

  it('tags 端点：create 重名 → 400 INVALID_QUERY；delete 不存在 → 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    await postTags(jsonPost(`${repoId}/tags`, { action: 'create', name: 'v1' }), ctx(repoId));
    const dupRes = await postTags(jsonPost(`${repoId}/tags`, { action: 'create', name: 'v1' }), ctx(repoId));
    expect(dupRes.status).toBe(400);
    expect(await dupRes.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const delRes = await postTags(jsonPost(`${repoId}/tags`, { action: 'delete', name: 'ghost' }), ctx(repoId));
    expect(delRes.status).toBe(400);
    expect(await delRes.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('zod 反例：空 onto / 空 entries / 空 hashes / 缺 base / 未知 tag action 均返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const results = await Promise.all([
      postRebase(jsonPost(`${repoId}/rebase`, { onto: '' }), ctx(repoId)),
      postInteractiveRebase(jsonPost(`${repoId}/rebase/interactive`, { base: 'HEAD', entries: [] }), ctx(repoId)),
      postCherryPick(jsonPost(`${repoId}/cherry-pick`, { hashes: [] }), ctx(repoId)),
      getRebaseTodo(new Request(`http://localhost/api/repos/${repoId}/rebase/todo`), ctx(repoId)),
      postTags(jsonPost(`${repoId}/tags`, { action: 'rename', name: 'v1' }), ctx(repoId)),
    ]);
    for (const res of results) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：rebase/tags/operation-continue 返回 404 REPO_NOT_FOUND', async () => {
    const rebaseRes = await postRebase(jsonPost('nope/rebase', { onto: 'side' }), ctx('nope'));
    expect(rebaseRes.status).toBe(404);
    expect(await rebaseRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const tagsRes = await getTags(new Request('http://localhost/api/repos/nope/tags'), ctx('nope'));
    expect(tagsRes.status).toBe(404);
    expect(await tagsRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    const contRes = await postContinueOperation(
      new Request('http://localhost/api/repos/nope/operation/continue', { method: 'POST' }),
      ctx('nope'),
    );
    expect(contRes.status).toBe(404);
    expect(await contRes.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });
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

describe('web-next patch/shelf/console/ignore 路由', () => {
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('patches 端点：GET 空 → create 工作区态 → apply 回工作区 → delete 往返均 200', async () => {
    const repoId = registerRepo();
    const emptyRes = await getPatches(new Request(`http://localhost/api/repos/${repoId}/patches`), ctx(repoId));
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ patches: [] });

    // create：工作区 diff 全量存档（返回刷新列表）
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const createRes = await postPatchCreate(jsonPost(`${repoId}/patches/create`, { name: 'p1' }), ctx(repoId));
    expect(createRes.status).toBe(200);
    const created = await createRes.json();
    expect(created.patches).toHaveLength(1);
    expect(created.patches[0]).toMatchObject({ name: 'p1', size: expect.any(Number) });
    expect(created.patches[0].createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // apply：先还原工作区再回放补丁（返回 RepoStatus）
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '--', 'a.txt']);
    expect(readFileSync(join(lastRepoPath, 'a.txt'), 'utf8')).toBe('hello\n');
    const applyRes = await postPatchApply(jsonPost(`${repoId}/patches/apply`, { name: 'p1' }), ctx(repoId));
    expect(applyRes.status).toBe(200);
    const status = await applyRes.json();
    // porcelain v2 代码：index 干净、工作区修改 → '.M'
    expect(status.entries.find((e: { path: string }) => e.path === 'a.txt')?.code).toBe('.M');
    expect(readFileSync(join(lastRepoPath, 'a.txt'), 'utf8')).toBe('hello\nworld\n');

    // delete：刷新列表清空
    const delRes = await postPatchDelete(jsonPost(`${repoId}/patches/delete`, { name: 'p1' }), ctx(repoId));
    expect(delRes.status).toBe(200);
    expect(await delRes.json()).toEqual({ patches: [] });
  });

  it('patches 端点：非法 name（zod 拒绝）与缺 name apply 均 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const badName = await postPatchCreate(jsonPost(`${repoId}/patches/create`, { name: '两 个 空 格' }), ctx(repoId));
    const badApply = await postPatchApply(jsonPost(`${repoId}/patches/apply`, {}), ctx(repoId));
    for (const res of [badName, badApply]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('shelves 端点：GET 空 → save（含未跟踪）→ restore（回工作区）→ drop 往返均 200', async () => {
    const repoId = registerRepo();
    const emptyRes = await getShelves(new Request(`http://localhost/api/repos/${repoId}/shelves`), ctx(repoId));
    expect(emptyRes.status).toBe(200);
    expect(await emptyRes.json()).toEqual({ shelves: [] });

    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    writeFileSync(join(lastRepoPath, 'new.txt'), 'new\n');
    const saveRes = await postShelves(jsonPost(`${repoId}/shelves`, { action: 'save', name: 'wip' }), ctx(repoId));
    expect(saveRes.status).toBe(200);
    const saved = await saveRes.json();
    expect(saved.shelves).toHaveLength(1);
    expect(saved.shelves[0]).toMatchObject({ name: 'wip', untrackedCount: 1 });

    // restore：清理工作区后回放（tracked 补丁 + 未跟踪回拷），shelf 保留
    execFileSync('git', ['-C', lastRepoPath, 'checkout', '--', 'a.txt']);
    rmSync(join(lastRepoPath, 'new.txt'));
    const restoreRes = await postShelves(jsonPost(`${repoId}/shelves`, { action: 'restore', name: 'wip' }), ctx(repoId));
    expect(restoreRes.status).toBe(200);
    expect(((await restoreRes.json()) as { shelves: unknown[] }).shelves).toHaveLength(1);
    expect(readFileSync(join(lastRepoPath, 'a.txt'), 'utf8')).toBe('hello\nworld\n');
    expect(readFileSync(join(lastRepoPath, 'new.txt'), 'utf8')).toBe('new\n');

    const dropRes = await postShelves(jsonPost(`${repoId}/shelves`, { action: 'drop', name: 'wip' }), ctx(repoId));
    expect(dropRes.status).toBe(200);
    expect(await dropRes.json()).toEqual({ shelves: [] });
  });

  it('shelves 端点：save 重名 → 400 INVALID_QUERY；restore 不存在 → 400 INVALID_REF；未知 action（zod 拒绝）→ 400', async () => {
    const repoId = registerRepo();
    writeFileSync(join(lastRepoPath, 'a.txt'), 'hello\nworld\n');
    const body = (b: unknown) => jsonPost(`${repoId}/shelves`, b);
    const first = await postShelves(body({ action: 'save', name: 'dup' }), ctx(repoId));
    expect(first.status).toBe(200);
    const dup = await postShelves(body({ action: 'save', name: 'dup' }), ctx(repoId));
    expect(dup.status).toBe(400);
    expect(await dup.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const ghost = await postShelves(body({ action: 'restore', name: 'ghost' }), ctx(repoId));
    expect(ghost.status).toBe(400);
    expect(await ghost.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
    const unknown = await postShelves(body({ action: 'apply', name: 'x' }), ctx(repoId));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('console 端点：真实调用链制造 git 操作后 GET 返回 200 且 id 从 1 递增、args 为数组', async () => {
    const repoId = registerRepo();
    // 先经 status 端点产生真实 git 记录（runGit 按 resolveRepo 产出的同串 cwd 键控）
    await getStatus(new Request(`http://localhost/api/repos/${repoId}/status`), ctx(repoId));
    const res = await getConsole(new Request(`http://localhost/api/repos/${repoId}/console`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body.map((e: { id: number }) => e.id)).toEqual(body.map((_e: unknown, i: number) => i + 1));
    const last = body[body.length - 1];
    expect(last.args).toBeInstanceOf(Array);
    expect(last.args[0]).toBe('--no-pager'); // git 调用固定注入
    expect(last.args).toContain('status');
    expect(typeof last.exitCode).toBe('number');
    expect(typeof last.durationMs).toBe('number');
    expect(typeof last.stderrTail).toBe('string');
    expect(typeof last.atIso).toBe('string');
  });

  it('console 端点：limit 越界（zod 拒绝）返回 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await getConsole(new Request(`http://localhost/api/repos/${repoId}/console?limit=501`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('ignore 端点：GET 读空 → PUT 整写 → add 幂等追加 → templates 三模板，均 200', async () => {
    const repoId = registerRepo();
    const getRes = await getIgnore(new Request(`http://localhost/api/repos/${repoId}/ignore`), ctx(repoId));
    expect(getRes.status).toBe(200);
    const read = await getRes.json();
    expect(read.gitignore).toBe('');
    expect(typeof read.exclude).toBe('string');

    const putRes = await putIgnore(
      new Request(`http://localhost/api/repos/${repoId}/ignore`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'gitignore', content: 'node_modules/\n' }),
      }),
      ctx(repoId),
    );
    expect(putRes.status).toBe(200);
    expect((await putRes.json()).gitignore).toBe('node_modules/\n');

    // add：追加 /<path>；重复追加幂等（行 trim 判等不重复）
    const addRes = await postIgnoreAdd(jsonPost(`${repoId}/ignore/add`, { path: 'dist' }), ctx(repoId));
    expect(addRes.status).toBe(200);
    expect((await addRes.json()).gitignore).toBe('node_modules/\n/dist\n');
    const againRes = await postIgnoreAdd(jsonPost(`${repoId}/ignore/add`, { path: 'dist' }), ctx(repoId));
    expect(againRes.status).toBe(200);
    expect((await againRes.json()).gitignore).toBe('node_modules/\n/dist\n');

    const tplRes = await getIgnoreTemplates(new Request(`http://localhost/api/repos/${repoId}/ignore/templates`), ctx(repoId));
    expect(tplRes.status).toBe(200);
    const templates = await tplRes.json();
    expect(templates.map((t: { id: string }) => t.id)).toEqual(['node', 'python', 'general']);
    expect(templates.map((t: { name: string }) => t.name)).toEqual(['Node.js', 'Python', '通用']);
  });

  it('ignore 端点：PUT 非法 target（zod 拒绝）与 add 缺 path 均 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const putRes = await putIgnore(
      new Request(`http://localhost/api/repos/${repoId}/ignore`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'user', content: 'x' }),
      }),
      ctx(repoId),
    );
    const addRes = await postIgnoreAdd(jsonPost(`${repoId}/ignore/add`, {}), ctx(repoId));
    for (const res of [putRes, addRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
  });

  it('未注册 repoId：patches/shelves/console/ignore 及其子端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getPatches(new Request('http://localhost/api/repos/nope/patches'), ctx('nope')),
      postPatchCreate(jsonPost('nope/patches/create', { name: 'p' }), ctx('nope')),
      postPatchApply(jsonPost('nope/patches/apply', { name: 'p' }), ctx('nope')),
      postPatchDelete(jsonPost('nope/patches/delete', { name: 'p' }), ctx('nope')),
      getShelves(new Request('http://localhost/api/repos/nope/shelves'), ctx('nope')),
      postShelves(jsonPost('nope/shelves', { action: 'save', name: 'w' }), ctx('nope')),
      getConsole(new Request('http://localhost/api/repos/nope/console'), ctx('nope')),
      getIgnore(new Request('http://localhost/api/repos/nope/ignore'), ctx('nope')),
      putIgnore(
        new Request('http://localhost/api/repos/nope/ignore', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ target: 'gitignore', content: 'x' }),
        }),
        ctx('nope'),
      ),
      postIgnoreAdd(jsonPost('nope/ignore/add', { path: 'x' }), ctx('nope')),
      getIgnoreTemplates(new Request('http://localhost/api/repos/nope/ignore/templates'), ctx('nope')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});

describe('web-next GitHub PR 域路由', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/pull），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'ghp_route-test-token-1234567890';
  /** [number] 子路由 ctx：与既有 ctx 同构，多 number 路径段 */
  const numCtx = (repoId: string, number: string): { params: Promise<{ repoId: string; number: string }> } => ({
    params: Promise.resolve({ repoId, number }),
  });
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + github.com 远程（origin = https://github.com/acme/demo.git），返回 repoId */
  const githubRepo = (): string => {
    const repoId = registerRepo();
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
    return repoId;
  };
  /** 配置 github.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'github.com', account: 'me', token: TOKEN });
  /** mock 全局 fetch（数据面路由测试必 stub：不 stub 会打真实网络——绝对禁止） */
  type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
  const mockFetchSequence = (...responses: FakeResponse[]): ReturnType<typeof vi.fn> => {
    const fn = vi.fn();
    for (const r of responses) {
      fn.mockResolvedValueOnce(
        new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers }),
      );
    }
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  /** GitHub API pull JSON 夹具（toPrSummary 所需字段齐） */
  const pullFixture = (overrides: Record<string, unknown> = {}) => ({
    number: 12,
    title: 'Fix thing',
    user: { login: 'alice' },
    state: 'open',
    merged: false,
    base: { ref: 'main' },
    head: { ref: 'feature/fix' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T03:04:05Z',
    ...overrides,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status 端点：无远程 → 200 {detected:false}（三态之一）', async () => {
    const repoId = registerRepo();
    const res = await getGithubStatus(new Request(`http://localhost/api/repos/${repoId}/github/status`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const repoId = githubRepo();
    const res = await getGithubStatus(new Request(`http://localhost/api/repos/${repoId}/github/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      detected: true,
      repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://github.com/acme/demo.git' },
    });
    expect(body.account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：有令牌 → 200 account 返回账户名且响应不含 token', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await getGithubStatus(new Request(`http://localhost/api/repos/${repoId}/github/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detected).toBe(true);
    expect(body.account).toBe('me');
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await getGithubStatus(new Request('http://localhost/api/repos/nope/github/status'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('prs 端点：state 缺省 open 透传（URL 与 token 注入）', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [pullFixture()] });
    const res = await getGithubPrs(new Request(`http://localhost/api/repos/${repoId}/github/prs`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { prs: unknown[] }).prs).toEqual([
      expect.objectContaining({ number: 12, title: 'Fix thing', author: 'alice', state: 'open', merged: false }),
    ]);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls?state=open');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
  });

  it('prs 端点：state=all 透传 query', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [] });
    const res = await getGithubPrs(new Request(`http://localhost/api/repos/${repoId}/github/prs?state=all`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prs: [] });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls?state=all');
  });

  it('prs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await getGithubPrs(new Request(`http://localhost/api/repos/${repoId}/github/prs?state=merge`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('detail 端点：mock fetch 断言 URL 与映射（reviewDecision）', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({
      json: {
        ...pullFixture({ number: 7, title: 'Detail' }),
        body: 'Description',
        mergeable: true,
        review_decision: 'APPROVED',
        comments: 3,
        additions: 40,
        deletions: 12,
      },
    });
    const res = await getGithubPrDetail(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7`),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      number: 7,
      title: 'Detail',
      author: 'alice',
      body: 'Description',
      mergeable: true,
      reviewDecision: 'APPROVED',
      commentsCount: 3,
      additions: 40,
      deletions: 12,
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7');
  });

  it('path 参数：number=0 / number=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    for (const bad of ['0', 'abc']) {
      const res = await getGithubPrDetail(
        new Request(`http://localhost/api/repos/${repoId}/github/prs/${bad}`),
        numCtx(repoId, bad),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('timeline 端点：comments + reviews 两请求 URL 与合并升序', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { json: [{ id: 5, user: { login: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' }] },
      {
        json: [{ id: 12, user: { login: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'needs work', state: 'CHANGES_REQUESTED' }],
      },
    );
    const res = await getGithubPrTimeline(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7/timeline`),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
        {
          id: 1000000012,
          author: 'carol',
          atIso: '2026-01-02T00:00:00Z',
          body: 'needs work',
          kind: 'review',
          reviewState: 'CHANGES_REQUESTED',
        },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect((mock.mock.calls[1] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
  });

  it('files 端点：mock fetch 断言 URL 与映射（patch 缺省 → 空串）', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({
      json: [
        { filename: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { filename: 'new.ts', status: 'added', additions: 5, deletions: 0 },
      ],
    });
    const res = await getGithubPrFiles(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7/files`),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: 'a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@' },
        { path: 'new.ts', status: 'added', additions: 5, deletions: 0, patch: '' },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe('https://api.github.com/repos/acme/demo/pulls/7/files');
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postGithubComment(
      jsonPost(`${repoId}/github/prs/7/comments`, { body: 'new comment' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/issues/7/comments');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGithubReview(
      jsonPost(`${repoId}/github/prs/7/review`, { event: 'APPROVED' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('review 端点：POST 载荷 {event, body} 与刷新详情回包', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      {
        status: 201,
        json: { id: 21, state: 'APPROVED', user: { login: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'looks good' },
      },
      {
        json: {
          ...pullFixture({ number: 7 }),
          body: 'b',
          mergeable: true,
          review_decision: 'APPROVED',
          comments: 1,
          additions: 1,
          deletions: 0,
        },
      },
    );
    const res = await postGithubReview(
      jsonPost(`${repoId}/github/prs/7/review`, { event: 'APPROVE', body: 'looks good' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewDecision: string }).reviewDecision).toBe('APPROVED');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/reviews');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ event: 'APPROVE', body: 'looks good' }));
  });

  it('merge 端点：method 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGithubMerge(
      jsonPost(`${repoId}/github/prs/7/merge`, { method: 'ff' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('merge 端点：POST {merge_method} 载荷与回包', async () => {
    const repoId = githubRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ status: 200, json: { merged: true, message: 'Pull Request successfully merged' } });
    const res = await postGithubMerge(
      jsonPost(`${repoId}/github/prs/7/merge`, { method: 'squash' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Pull Request successfully merged' });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/acme/demo/pulls/7/merge');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ merge_method: 'squash' }));
  });

  it('checkout 端点：真实裸仓库 refs/pull/7/head → pr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-next-github-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-next-github-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'pr.txt'), 'pr-7 content');
    execFileSync('git', ['-C', other, 'add', 'pr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'pr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head']);
    const prHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/pull/7/head'], { encoding: 'utf8' }).trim();

    const res = await postGithubCheckout(
      new Request(`http://localhost/api/repos/${repoId}/github/prs/7/checkout`, { method: 'POST' }),
      numCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'pr-7' });
    expect(execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('pr-7');
    expect(execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'refs/heads/pr-7'], { encoding: 'utf8' }).trim()).toBe(prHash);
    expect(execFileSync('git', ['-C', lastRepoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：github 全部 9 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getGithubStatus(new Request('http://localhost/api/repos/nope/github/status'), ctx('nope')),
      getGithubPrs(new Request('http://localhost/api/repos/nope/github/prs'), ctx('nope')),
      getGithubPrDetail(new Request('http://localhost/api/repos/nope/github/prs/7'), numCtx('nope', '7')),
      getGithubPrTimeline(new Request('http://localhost/api/repos/nope/github/prs/7/timeline'), numCtx('nope', '7')),
      postGithubComment(jsonPost('nope/github/prs/7/comments', { body: 'x' }), numCtx('nope', '7')),
      getGithubPrFiles(new Request('http://localhost/api/repos/nope/github/prs/7/files'), numCtx('nope', '7')),
      postGithubReview(jsonPost('nope/github/prs/7/review', { event: 'APPROVE' }), numCtx('nope', '7')),
      postGithubMerge(jsonPost('nope/github/prs/7/merge', { method: 'merge' }), numCtx('nope', '7')),
      postGithubCheckout(new Request('http://localhost/api/repos/nope/github/prs/7/checkout', { method: 'POST' }), numCtx('nope', '7')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});

describe('web-next GitLab MR 域路由', () => {
  /** 裸仓库装置用例 git 进程密集（clone + push refs/merge-requests），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const TOKEN = 'glpat-route-test-token-1234567890';
  /** [iid] 子路由 ctx：与既有 ctx 同构，多 iid 路径段 */
  const iidCtx = (repoId: string, iid: string): { params: Promise<{ repoId: string; iid: string }> } => ({
    params: Promise.resolve({ repoId, iid }),
  });
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  /** 注册仓库 + gitlab.com 远程（origin = https://gitlab.com/acme/demo.git），返回 repoId */
  const gitlabRepo = (): string => {
    const repoId = registerRepo();
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', 'https://gitlab.com/acme/demo.git']);
    return repoId;
  };
  /** 配置 gitlab.com 账户（写 config store：逐用例独立 REBASED_CONFIG_DIR，互不污染） */
  const withToken = () => upsertAccount({ host: 'gitlab.com', account: 'me', token: TOKEN });
  /** mock 全局 fetch（数据面路由测试必 stub：不 stub 会打真实网络——绝对禁止） */
  type FakeResponse = { status?: number; json?: unknown; headers?: Record<string, string> };
  const mockFetchSequence = (...responses: FakeResponse[]): ReturnType<typeof vi.fn> => {
    const fn = vi.fn();
    for (const r of responses) {
      fn.mockResolvedValueOnce(
        new Response(JSON.stringify(r.json ?? null), { status: r.status ?? 200, headers: r.headers }),
      );
    }
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  /** GitLab API project 基址：owner 全路径（含子组）encodeURIComponent 后为 acme%2Fdemo */
  const MR_BASE = 'https://gitlab.com/api/v4/projects/acme%2Fdemo';
  /** GitLab MR JSON 夹具（toMrSummary 所需字段齐） */
  const mrFixture = (overrides: Record<string, unknown> = {}) => ({
    iid: 12,
    title: 'Fix thing',
    author: { username: 'alice' },
    state: 'opened',
    source_branch: 'feature/fix',
    target_branch: 'main',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T03:04:05Z',
    ...overrides,
  });
  /** MR 详情夹具（toMrDetail 所需字段齐：merge_status/user_notes_count） */
  const mrDetailFixture = (overrides: Record<string, unknown> = {}) => ({
    iid: 7,
    title: 'Detail',
    author: { username: 'carol' },
    state: 'opened',
    source_branch: 'fix',
    target_branch: 'main',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    description: 'Description',
    merge_status: 'can_be_merged',
    user_notes_count: 3,
    ...overrides,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('status 端点：无远程 → 200 {detected:false}（三态之一）', async () => {
    const repoId = registerRepo();
    const res = await getGitlabStatus(new Request(`http://localhost/api/repos/${repoId}/gitlab/status`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detected: false });
  });

  it('status 端点：有远程无令牌 → 200 detected:true 无 account 且不含 token', async () => {
    const repoId = gitlabRepo();
    const res = await getGitlabStatus(new Request(`http://localhost/api/repos/${repoId}/gitlab/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      detected: true,
      repo: { owner: 'acme', name: 'demo', remoteUrl: 'https://gitlab.com/acme/demo.git' },
    });
    expect((body as { account?: string }).account).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：有令牌 → 200 account 返回账户名且响应不含 token', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const res = await getGitlabStatus(new Request(`http://localhost/api/repos/${repoId}/gitlab/status`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ detected: true, account: 'me' });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it('status 端点：未注册 repoId → 404 REPO_NOT_FOUND', async () => {
    const res = await getGitlabStatus(new Request('http://localhost/api/repos/nope/gitlab/status'), ctx('nope'));
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
  });

  it('mrs 端点：state 缺省 opened 透传（URL 与 PRIVATE-TOKEN 注入）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [mrFixture()] });
    const res = await getGitlabMrs(new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      mrs: [
        {
          iid: 12,
          title: 'Fix thing',
          author: 'alice',
          state: 'opened',
          sourceBranch: 'feature/fix',
          targetBranch: 'main',
          createdAtIso: '2026-01-01T00:00:00Z',
          updatedAtIso: '2026-01-02T03:04:05Z',
        },
      ],
    });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests?state=opened`);
    expect(init.headers).toMatchObject({ 'PRIVATE-TOKEN': TOKEN });
  });

  it('mrs 端点：state=merged 透传 query', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ json: [] });
    const res = await getGitlabMrs(new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs?state=merged`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mrs: [] });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests?state=merged`);
  });

  it('mrs 端点：state=merge（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await getGitlabMrs(new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs?state=merge`), ctx(repoId));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('create 端点：POST 载荷（sourceBranch/targetBranch/title/description）与重查 detail 回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      {
        status: 201,
        json: {
          iid: 11,
          title: 'New MR',
          author: { username: 'me' },
          state: 'opened',
          source_branch: 'feature',
          target_branch: 'main',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          description: 'D',
        },
      },
      {
        json: {
          iid: 11,
          title: 'New MR',
          author: { username: 'me' },
          state: 'opened',
          source_branch: 'feature',
          target_branch: 'main',
          created_at: '2026-03-01T00:00:00Z',
          updated_at: '2026-03-01T00:00:00Z',
          description: 'D',
          merge_status: 'checking',
          user_notes_count: 0,
        },
      },
      { json: [] },
    );
    const res = await postGitlabMrCreate(
      jsonPost(`${repoId}/gitlab/mrs`, { sourceBranch: 'feature', targetBranch: 'main', title: 'New MR', description: 'D' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ iid: 11, title: 'New MR', body: 'D' });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(
      JSON.stringify({ source_branch: 'feature', target_branch: 'main', title: 'New MR', description: 'D' }),
    );
    // 重查 detail 走 GET /merge_requests/11（create 返回后）。
    expect((mock.mock.calls[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/11`);
  });

  it('create 端点：缺 targetBranch（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGitlabMrCreate(
      jsonPost(`${repoId}/gitlab/mrs`, { sourceBranch: 'feature', title: 'No target' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('detail 端点：mock fetch 断言 URL 序列（MR + 尽力 reviews）与映射', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await getGitlabMrDetail(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7`),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      iid: 7,
      title: 'Detail',
      author: 'carol',
      state: 'opened',
      sourceBranch: 'fix',
      targetBranch: 'main',
      createdAtIso: '2026-01-01T00:00:00Z',
      updatedAtIso: '2026-01-02T00:00:00Z',
      body: 'Description',
      mergeable: true,
      reviewState: 'APPROVED',
      commentsCount: 3,
      additions: 0,
      deletions: 0,
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7`);
    expect((mock.mock.calls[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('path 参数：iid=0 / iid=abc（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    for (const bad of ['0', 'abc']) {
      const res = await getGitlabMrDetail(
        new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/${bad}`),
        iidCtx(repoId, bad),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it('timeline 端点：notes + reviews 两请求 URL 与合并升序（review id 移位）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      {
        json: [
          { id: 5, author: { username: 'alice' }, created_at: '2026-01-01T00:00:00Z', body: 'comment 1' },
          { id: 6, author: { username: 'bob' }, created_at: '2026-01-03T00:00:00Z', body: 'comment 3' },
        ],
      },
      {
        json: [
          { id: 12, state: 'approved', author: { username: 'carol' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' },
          { id: 13, state: 'rejected', author: { username: 'dave' }, created_at: '2026-01-04T00:00:00Z', body: 'needs work' },
          { id: 14, state: 'commented', author: { username: 'erin' }, created_at: '2026-01-05T00:00:00Z', body: 'hmm' },
        ],
      },
    );
    const res = await getGitlabMrTimeline(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7/timeline`),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [
        { id: 5, author: 'alice', atIso: '2026-01-01T00:00:00Z', body: 'comment 1', kind: 'comment' },
        { id: 1000000012, author: 'carol', atIso: '2026-01-02T00:00:00Z', body: 'lgtm', kind: 'review', reviewState: 'APPROVED' },
        { id: 6, author: 'bob', atIso: '2026-01-03T00:00:00Z', body: 'comment 3', kind: 'comment' },
        { id: 1000000013, author: 'dave', atIso: '2026-01-04T00:00:00Z', body: 'needs work', kind: 'review', reviewState: 'CHANGES_REQUESTED' },
        { id: 1000000014, author: 'erin', atIso: '2026-01-05T00:00:00Z', body: 'hmm', kind: 'review', reviewState: 'COMMENTED' },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect((mock.mock.calls[1] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/reviews`);
  });

  it('files 端点：mock fetch 断言 URL 与映射（new_path ?? old_path；旗标；diff 缺省 → 空串）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({
      json: [
        { new_path: 'a.ts', old_path: 'a.ts', diff: '@@ -1 +1 @@', new_file: false, deleted_file: false },
        { new_path: 'new.ts', old_path: null, new_file: true, deleted_file: false },
        { new_path: 'renamed.ts', old_path: 'old.ts', renamed_file: true, new_file: true, deleted_file: false },
        { new_path: null, old_path: 'del.ts', deleted_file: true, new_file: false },
        { new_path: 'm.ts', old_path: 'm.ts', new_file: false, deleted_file: false, renamed_file: false, diff: null },
      ],
    });
    const res = await getGitlabMrFiles(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7/files`),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { path: 'a.ts', status: 'modified', additions: 0, deletions: 0, diff: '@@ -1 +1 @@' },
        { path: 'new.ts', status: 'added', additions: 0, deletions: 0, diff: '' },
        { path: 'renamed.ts', status: 'renamed', additions: 0, deletions: 0, diff: '' },
        { path: 'del.ts', status: 'removed', additions: 0, deletions: 0, diff: '' },
        { path: 'm.ts', status: 'modified', additions: 0, deletions: 0, diff: '' },
      ],
    });
    expect((mock.mock.calls[0] as [string])[0]).toBe(`${MR_BASE}/merge_requests/7/changes`);
  });

  it('comments 端点：POST 载荷 {body} 与刷新时间线回包（note + notes + reviews 三请求）', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' } },
      { json: [{ id: 77, author: { username: 'me' }, created_at: '2026-02-01T00:00:00Z', body: 'new comment' }] },
      { json: [] },
    );
    const res = await postGitlabComment(
      jsonPost(`${repoId}/gitlab/mrs/7/comments`, { body: 'new comment' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      entries: [{ id: 77, author: 'me', atIso: '2026-02-01T00:00:00Z', body: 'new comment', kind: 'comment' }],
    });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'new comment' }));
  });

  it('review 端点：event 非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'APPROVED' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('review 端点：APPROVE → POST .../approve（无 body）与刷新详情回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 200, json: { id: 1, state: 'approved' } },
      { json: mrDetailFixture() },
      {
        json: [{ id: 20, state: 'approved', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'lgtm' }],
      },
    );
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'APPROVE', body: 'looks good' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('APPROVED');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/approve`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('review 端点：REQUEST_CHANGES → POST .../reviews {state:rejected} 与刷新详情回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 2, state: 'rejected' } },
      { json: mrDetailFixture({ user_notes_count: 0 }) },
      {
        json: [{ id: 21, state: 'rejected', author: { username: 'me' }, created_at: '2026-01-02T00:00:00Z', body: 'nope' }],
      },
    );
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'REQUEST_CHANGES', body: 'nope' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { reviewState: string }).reviewState).toBe('CHANGES_REQUESTED');
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/reviews`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ state: 'rejected' }));
  });

  it('review 端点：COMMENT → POST .../notes {body} 与刷新详情回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence(
      { status: 201, json: { id: 3, body: 'need fix', author: { username: 'me' } } },
      { json: mrDetailFixture({ user_notes_count: 1 }) },
      { json: [] },
    );
    const res = await postGitlabReview(
      jsonPost(`${repoId}/gitlab/mrs/7/review`, { event: 'COMMENT', body: 'need fix' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { commentsCount: number }).commentsCount).toBe(1);
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/notes`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ body: 'need fix' }));
  });

  it('merge 端点：squash 类型非法（zod 拒绝）→ 400 INVALID_QUERY 且不发起请求', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);
    const res = await postGitlabMerge(
      jsonPost(`${repoId}/gitlab/mrs/7/merge`, { squash: 'yes' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    expect(mock).not.toHaveBeenCalled();
  });

  it('merge 端点：PUT {squash:true} 载荷与回包', async () => {
    const repoId = gitlabRepo();
    withToken(); // registerRepo 整写 config.json，账户必须最后写（否则被清空）
    const mock = mockFetchSequence({ status: 200, json: { state: 'merged', message: 'Merge request merged successfully' } });
    const res = await postGitlabMerge(
      jsonPost(`${repoId}/gitlab/mrs/7/merge`, { squash: true }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ merged: true, message: 'Merge request merged successfully' });
    const [url, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${MR_BASE}/merge_requests/7/merge`);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ squash: true }));
  });

  it('checkout 端点：真实裸仓库 refs/merge-requests/7/head → mr-7 分支建立并检出', { timeout: RIG_TIMEOUT }, async () => {
    const repoId = registerRepo();
    const defaultBranch = execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    const bare = tmpDir('rebased-web-next-gitlab-bare-');
    execFileSync('git', ['init', '-q', '--bare', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'remote', 'add', 'origin', bare]);
    execFileSync('git', ['-C', lastRepoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
    const other = tmpDir('rebased-web-next-gitlab-other-');
    execFileSync('git', ['clone', '-q', bare, other]);
    execFileSync('git', ['-C', other, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', other, 'config', 'user.name', 'Test User']);
    writeFileSync(join(other, 'mr.txt'), 'mr-7 content');
    execFileSync('git', ['-C', other, 'add', 'mr.txt']);
    execFileSync('git', ['-C', other, 'commit', '-q', '-m', 'mr 7 commit']);
    execFileSync('git', ['-C', other, 'push', '-q', 'origin', 'HEAD:refs/merge-requests/7/head']);
    const mrHash = execFileSync('git', ['-C', bare, 'rev-parse', 'refs/merge-requests/7/head'], { encoding: 'utf8' }).trim();

    const res = await postGitlabCheckout(
      new Request(`http://localhost/api/repos/${repoId}/gitlab/mrs/7/checkout`, { method: 'POST' }),
      iidCtx(repoId, '7'),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branchName: 'mr-7' });
    expect(execFileSync('git', ['-C', lastRepoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()).toBe('mr-7');
    expect(execFileSync('git', ['-C', lastRepoPath, 'rev-parse', 'refs/heads/mr-7'], { encoding: 'utf8' }).trim()).toBe(mrHash);
    expect(execFileSync('git', ['-C', lastRepoPath, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('');
  });

  it('未注册 repoId：gitlab 全部 10 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getGitlabStatus(new Request('http://localhost/api/repos/nope/gitlab/status'), ctx('nope')),
      getGitlabMrs(new Request('http://localhost/api/repos/nope/gitlab/mrs'), ctx('nope')),
      postGitlabMrCreate(jsonPost('nope/gitlab/mrs', { sourceBranch: 'a', targetBranch: 'b', title: 't' }), ctx('nope')),
      getGitlabMrDetail(new Request('http://localhost/api/repos/nope/gitlab/mrs/7'), iidCtx('nope', '7')),
      getGitlabMrTimeline(new Request('http://localhost/api/repos/nope/gitlab/mrs/7/timeline'), iidCtx('nope', '7')),
      postGitlabComment(jsonPost('nope/gitlab/mrs/7/comments', { body: 'x' }), iidCtx('nope', '7')),
      getGitlabMrFiles(new Request('http://localhost/api/repos/nope/gitlab/mrs/7/files'), iidCtx('nope', '7')),
      postGitlabReview(jsonPost('nope/gitlab/mrs/7/review', { event: 'APPROVE' }), iidCtx('nope', '7')),
      postGitlabMerge(jsonPost('nope/gitlab/mrs/7/merge', { squash: true }), iidCtx('nope', '7')),
      postGitlabCheckout(new Request('http://localhost/api/repos/nope/gitlab/mrs/7/checkout', { method: 'POST' }), iidCtx('nope', '7')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});

describe('web-next worktree/submodule 域路由', () => {
  /** 子模块装置用例 git 进程密集（content 仓库 + bare + submodule add + 多次 status），统一放宽用例超时 */
  const RIG_TIMEOUT = 120000;
  const jsonPost = (path: string, body: unknown) =>
    new Request(`http://localhost/api/repos/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const git = (repo: string, args: string[]) =>
    execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  /** 主仓库旁的副工作树路径（sibling） */
  const siblingPath = (repo: string, suffix: string) => join(dirname(repo), basename(repo) + suffix);
  /** 路径等价比较：git 输出 realpath 长形式，mkdtemp 可能返回 8.3 短形式——OS 级归一 */
  const samePath = (a: string, b: string) => realpathSync.native(a) === realpathSync.native(b);

  it('worktrees 列表端点：初始返回单条主工作树（branch/head/detached）', async () => {
    const repoId = registerRepo();
    const res = await getWorktrees(new Request(`http://localhost/api/repos/${repoId}/worktrees`), ctx(repoId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worktrees).toHaveLength(1);
    const main = body.worktrees[0];
    expect(samePath(main.path, lastRepoPath)).toBe(true);
    expect(main.branch).toBe(git(lastRepoPath, ['symbolic-ref', '--short', 'HEAD']));
    expect(main.detached).toBe(false);
    expect(main.head).toBe(git(lastRepoPath, ['rev-parse', 'HEAD']));
  });

  it('create 端点 newBranch：200 刷新列表含主+副（副 branch/head 完整）', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-new');
    const res = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, newBranch: 'feat-route' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worktrees).toHaveLength(2);
    const wt = body.worktrees.find((w: { path: string }) => samePath(w.path, wtPath));
    expect(wt).toMatchObject({ branch: 'feat-route', detached: false });
    expect(wt.head).toBe(git(lastRepoPath, ['rev-parse', 'refs/heads/feat-route']));
  });

  it('create 端点 branch 挂接既有分支', async () => {
    const repoId = registerRepo();
    git(lastRepoPath, ['branch', 'feat']);
    const wtPath = siblingPath(lastRepoPath, '-wt-attach');
    const res = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, branch: 'feat' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const wt = body.worktrees.find((w: { path: string }) => samePath(w.path, wtPath));
    expect(wt).toMatchObject({ branch: 'feat', detached: false });
  });

  it('create 端点互斥预检：都缺/同给 → 400 INVALID_QUERY；分支不存在 → 400 INVALID_REF', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-excl');
    const missing = await postWorktreeCreate(jsonPost(`${repoId}/worktrees`, { path: wtPath }), ctx(repoId));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const both = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, branch: 'a', newBranch: 'b' }),
      ctx(repoId),
    );
    expect(both.status).toBe(400);
    expect(await both.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
    const noBranch = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, branch: 'nope' }),
      ctx(repoId),
    );
    expect(noBranch.status).toBe(400);
    expect(await noBranch.json()).toMatchObject({ error: { code: 'INVALID_REF' } });
  });

  it('create 端点 zod 反例：path 空 → 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const res = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: '', newBranch: 'x' }),
      ctx(repoId),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('remove 端点：创建后移除 → 200 列表复原；已不存在 → 400 INVALID_QUERY', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-rm');
    const created = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, newBranch: 'rm-b' }),
      ctx(repoId),
    );
    expect((await created.json()).worktrees).toHaveLength(2);

    const res = await postWorktreeRemove(jsonPost(`${repoId}/worktrees/remove`, { path: wtPath }), ctx(repoId));
    expect(res.status).toBe(200);
    expect((await res.json()).worktrees).toHaveLength(1);

    const gone = await postWorktreeRemove(jsonPost(`${repoId}/worktrees/remove`, { path: wtPath }), ctx(repoId));
    expect(gone.status).toBe(400);
    expect(await gone.json()).toMatchObject({ error: { code: 'INVALID_QUERY' } });
  });

  it('prune 端点：目录缺失的陈旧条目被清理 → 200 列表复原', async () => {
    const repoId = registerRepo();
    const wtPath = siblingPath(lastRepoPath, '-wt-stale');
    const created = await postWorktreeCreate(
      jsonPost(`${repoId}/worktrees`, { path: wtPath, newBranch: 'stale-b' }),
      ctx(repoId),
    );
    expect((await created.json()).worktrees).toHaveLength(2);
    rmSync(wtPath, { recursive: true, force: true });

    const res = await postWorktreePrune(
      new Request(`http://localhost/api/repos/${repoId}/worktrees/prune`, { method: 'POST' }),
      ctx(repoId),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).worktrees).toHaveLength(1);
  });

  it('submodules 列表/更新往返：add 后 checked-out → 检出旧提交 different-commit → update 复原', { timeout: RIG_TIMEOUT }, async () => {
    const content = tmpDir('rebased-web-next-subcontent-');
    git(content, ['init', '-q']);
    git(content, ['config', 'user.email', 'test@example.com']);
    git(content, ['config', 'user.name', 'Test User']);
    writeFileSync(join(content, 'c.txt'), 'c1');
    git(content, ['add', 'c.txt']);
    git(content, ['commit', '-q', '-m', 'A']);
    const aSha = git(content, ['rev-parse', 'HEAD']);
    writeFileSync(join(content, 'c.txt'), 'c2');
    git(content, ['commit', '-q', '-am', 'B']);
    const bSha = git(content, ['rev-parse', 'HEAD']);
    const bare = content + '.git';
    git(content, ['clone', '--bare', '-q', '.', bare]);
    const bareUrl = bare.replace(/\\/g, '/');
    const repoId = registerRepo();
    git(lastRepoPath, ['-c', 'protocol.file.allow=always', 'submodule', 'add', bareUrl, 'sub']);
    git(lastRepoPath, ['add', '-A']);
    git(lastRepoPath, ['commit', '-q', '-m', 'addsub']);
    const gitlinkSha = git(lastRepoPath, ['rev-parse', 'HEAD:sub']);
    expect(gitlinkSha).toBe(bSha);

    // 初始：submodule add 后即 checked-out（commitSha=gitlink sha）
    let res = await getSubmodulesRoute(new Request(`http://localhost/api/repos/${repoId}/submodules`), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'checked-out', commitSha: bSha }],
    });

    // 子模块工作树检出旧提交 A → different-commit
    git(join(lastRepoPath, 'sub'), ['checkout', '-q', aSha]);
    res = await getSubmodulesRoute(new Request(`http://localhost/api/repos/${repoId}/submodules`), ctx(repoId));
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'different-commit', commitSha: aSha }],
    });

    // update 复原 checked-out（无网络：对象在本仓库）；CLI 复核实际检出
    res = await postSubmoduleUpdate(jsonPost(`${repoId}/submodules/update`, {}), ctx(repoId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      submodules: [{ name: 'sub', path: 'sub', url: bareUrl, status: 'checked-out', commitSha: bSha }],
    });
    expect(git(join(lastRepoPath, 'sub'), ['rev-parse', 'HEAD'])).toBe(bSha);
  });

  it('未注册 repoId：worktree/submodule 全部 6 端点返回 404 REPO_NOT_FOUND', async () => {
    const cases: Array<Promise<Response>> = [
      getWorktrees(new Request('http://localhost/api/repos/nope/worktrees'), ctx('nope')),
      postWorktreeCreate(jsonPost('nope/worktrees', { path: 'C:/wt', newBranch: 'x' }), ctx('nope')),
      postWorktreeRemove(jsonPost('nope/worktrees/remove', { path: 'C:/wt' }), ctx('nope')),
      postWorktreePrune(new Request('http://localhost/api/repos/nope/worktrees/prune', { method: 'POST' }), ctx('nope')),
      getSubmodulesRoute(new Request('http://localhost/api/repos/nope/submodules'), ctx('nope')),
      postSubmoduleUpdate(jsonPost('nope/submodules/update', {}), ctx('nope')),
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ error: { code: 'REPO_NOT_FOUND' } });
    }
  });
});
