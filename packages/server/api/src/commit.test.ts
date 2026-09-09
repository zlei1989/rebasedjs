/** commit 服务测试：提交/身份断言/CRLF/组合推送/amend/GPG-模板链路。
 *  性能：base 提交模板与裸仓库 rig 在 beforeAll 各建一次，用例经 instantiateFixture 复制（0 spawn）。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { amendSpecificCommit, assertCommitIdentity, commitAndPush, createCommit, getAmendTargets, getCrlfWarning } from './commit';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function track(dir: string): string {
  dirs.push(dir);
  return dir;
}

/** git 执行（stdout 返回） */
function git(dir: string, args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
}

/** 造初始提交并返回当前分支名（配方同 remote 测试） */
function makeBaseCommit(repo: string): string {
  writeFileSync(join(repo, 'a.txt'), 'v1');
  git(repo, ['add', 'a.txt']);
  git(repo, ['commit', '-q', '-m', 'init']);
  return git(repo, ['symbolic-ref', '--short', 'HEAD']);
}

/** 裸仓库对端装置：本地仓库 + bare 当 origin + push -u 建 upstream（配方同 remote 测试） */
function buildRemoteRig(): { repo: string; bare: string; defaultBranch: string } {
  const repo = createTmpRepo(); // fixture 已预置 user.name/user.email
  const defaultBranch = makeBaseCommit(repo);
  const bare = createTmpDir('rebased-api-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  git(repo, ['remote', 'add', 'origin', bare]);
  git(repo, ['push', '-q', '-u', 'origin', defaultBranch]);
  git(bare, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repo, bare, defaultBranch };
}

// ---- 夹具模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let baseTemplate = '';
let rigTemplate: { repo: string; bare: string; defaultBranch: string } | null = null;

beforeAll(() => {
  baseTemplate = createTmpRepo();
  makeBaseCommit(baseTemplate);
  rigTemplate = buildRemoteRig();
  templateDirs.push(baseTemplate, rigTemplate.repo, rigTemplate.bare);
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

describe('commit 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('createCommit 提交暂存区并返回新哈希', async () => {
    const repo = instantiateFixture(baseTemplate); // fixture 已预置 user.name/user.email
    dirs.push(repo);
    writeFileSync(join(repo, 'b.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    const { hash } = await createCommit(repo, { message: '测试提交' });
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    expect(subject).toBe('测试提交');
  });

  it('assertCommitIdentity 缺 user.name 或 user.email 时抛 INVALID_QUERY', () => {
    const missing = [
      { key: 'user.name', value: null, localValue: null },
      { key: 'user.email', value: 'a@b.c', localValue: 'a@b.c' },
    ];
    expect(() => assertCommitIdentity(missing)).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUERY', message: '未配置 user.name 或 user.email，请先在设置页配置' }),
    );
    const missingEmail = [
      { key: 'user.name', value: 'Test', localValue: 'Test' },
      { key: 'user.email', value: null, localValue: null },
    ];
    expect(() => assertCommitIdentity(missingEmail)).toThrowError(expect.objectContaining({ code: 'INVALID_QUERY' }));
  });

  it('assertCommitIdentity 生效值齐全时不抛', () => {
    const ok = [
      { key: 'user.name', value: 'Test', localValue: null },
      { key: 'user.email', value: 'a@b.c', localValue: null },
    ];
    expect(() => assertCommitIdentity(ok)).not.toThrow();
  });
});

describe('CRLF 提示（GitCrlfDialog 语义）', () => {
  const crlfDirs: string[] = [];

  beforeAll(() => {
    // 隔离：crlfFix 写 core.autocrlf --global → GIT_CONFIG_GLOBAL 指向临时文件（绝不触碰真实全局配置）；
    // 本组自管清理数组（顶部 dirs 会被文件内其它 describe 的作用域 afterAll 提前清空——模块内数组被共享）
    const globalConfig = mkdtempSync(join(tmpdir(), 'rebased-api-crlf-'));
    process.env.GIT_CONFIG_GLOBAL = join(globalConfig, '.gitconfig');
    crlfDirs.push(globalConfig);
  });

  afterAll(() => crlfDirs.forEach(cleanupTmpRepo));

  it('getCrlfWarning：暂存 CRLF 文件无属性覆盖 → warning true + 文件列表（Windows 平台；autocrlf 本地置 false 绕过系统默认 true）', async () => {
    const repo = instantiateFixture(baseTemplate);
    crlfDirs.push(repo);
    execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', 'false']);
    writeFileSync(join(repo, 'crlf.txt'), 'line1\r\n');
    execFileSync('git', ['-C', repo, 'add', 'crlf.txt']);

    const w = await getCrlfWarning(repo);

    expect(w.warning).toBe(true);
    expect(w.files).toEqual(['crlf.txt']);
  });

  it('createCommit crlfFix：先写 global core.autocrlf 建议值再提交（GIT_CONFIG_GLOBAL 隔离）', async () => {
    const repo = instantiateFixture(baseTemplate);
    crlfDirs.push(repo);
    writeFileSync(join(repo, 'b.txt'), 'v2\n');
    execFileSync('git', ['-C', repo, 'add', 'b.txt']);

    const { hash } = await createCommit(repo, { message: '带 crlf 修复提交', crlfFix: true });

    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const global = execFileSync('git', ['config', '--global', '--get', 'core.autocrlf'], { encoding: 'utf8' }).trim();
    expect(global).toBe(process.platform === 'win32' ? 'true' : 'input');
  });
});

describe('commitAndPush 组合执行器（GitCommitAndPushExecutor 语义）', () => {
  it('提交 + 推送：commit 落盘且推送到上游（pushed），outcome 含哈希与 push 三态结果', async () => {
    const { repo, bare, defaultBranch } = makeRemoteRig();
    writeFileSync(join(repo, 'a.txt'), 'v2'); // a.txt 已提交 v1（init），改 v2 产生真变更
    execFileSync('git', ['-C', repo, 'add', '.']);

    const outcome = await commitAndPush(repo, { message: '组合提交' });
    expect(outcome.commit.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(outcome.push.status).toBe('pushed');
    // 对端 HEAD 同步了新提交
    expect(execFileSync('git', ['-C', bare, 'rev-parse', defaultBranch], { encoding: 'utf8' }).trim()).toBe(
      outcome.commit.hash,
    );
  });

  it('无上游分支且未带 push 载荷：push 失败透出（提交已落盘——非原子语义）', async () => {
    const repo = instantiateFixture(baseTemplate);
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);

    let err: unknown;
    try {
      await commitAndPush(repo, { message: '无上游提交' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    // 提交已落盘（非原子：推送失败不影响 commit 结果）
    const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    expect(subject).toBe('无上游提交');
  });

  it('分叉后推送：commit 成功 + push.status=rejected（业务结果非错误）', async () => {
    const { repo, bare, defaultBranch } = makeRemoteRig();
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    // 对端前进一个提交（分叉）：clone 裸仓库 → 提交 → 推回默认分支
    const wc = track(createTmpDir('rebased-api-other-'));
    execFileSync('git', ['clone', '-q', bare, wc]);
    writeFileSync(join(wc, 'b.txt'), 'remote');
    git(wc, ['add', 'b.txt']);
    git(wc, ['commit', '-q', '-m', 'remote']);
    git(wc, ['push', '-q', 'origin', `HEAD:${defaultBranch}`]);

    const outcome = await commitAndPush(repo, { message: '分叉提交' });
    expect(outcome.push.status).toBe('rejected');
    expect(outcome.push.hint).toContain('先拉取');
    // 提交已落盘（拒绝推送不撤销 commit）
    const subject = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
    expect(subject).toBe('分叉提交');
  });
});

describe('amend 指定历史提交（GitCommitDialog「Amend <subject>」语义）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getAmendTargets：返回未发布的非合并非 HEAD 提交（HEAD=c2 排除，仅 init 候选）', async () => {
    const repo = instantiateFixture(baseTemplate);
    dirs.push(repo);
    git(repo, ['commit', '--allow-empty', '-q', '-m', 'c2']);

    const targets = await getAmendTargets(repo);

    expect(targets.map((t) => t.subject)).toEqual(['init']);
    expect(targets[0].hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('amendSpecificCommit：reword 目标提交成功（提交数不变、信息重写）', async () => {
    const repo = instantiateFixture(baseTemplate);
    dirs.push(repo);
    git(repo, ['commit', '--allow-empty', '-q', '-m', 'c2']);
    const target = git(repo, ['rev-parse', 'HEAD~1']);

    const result = await amendSpecificCommit(repo, { targetHash: target, message: 'init（重写）' });

    expect(result.status).toBe('success');
    expect(result.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(git(repo, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(git(repo, ['log', '--format=%s']).split('\n').reverse()).toEqual(['init（重写）', 'c2']);
  });

  it('amendSpecificCommit：目标为 HEAD → INVALID_QUERY；无效哈希 → INVALID_REF；非祖先 → INVALID_QUERY', async () => {
    const repo = instantiateFixture(baseTemplate);
    dirs.push(repo);
    const head = git(repo, ['rev-parse', 'HEAD']);

    const headErr = await amendSpecificCommit(repo, { targetHash: head, message: 'x' }).catch((e: unknown) => e);
    expect(headErr).toMatchObject({ code: 'INVALID_QUERY', message: expect.stringContaining('当前 HEAD') });

    const refErr = await amendSpecificCommit(repo, { targetHash: 'deadbeef'.repeat(5), message: 'x' }).catch((e: unknown) => e);
    expect(refErr).toMatchObject({ code: 'INVALID_REF' });

    // 非祖先：同一个仓库中侧分支上创建的提交（引用有效但不在 HEAD 历史）
    const main = git(repo, ['symbolic-ref', '--short', 'HEAD']);
    git(repo, ['checkout', '-q', '-b', 'side']);
    writeFileSync(join(repo, 's.txt'), 'side');
    git(repo, ['add', 's.txt']);
    git(repo, ['commit', '-q', '-m', 'side1']);
    const sideHead = git(repo, ['rev-parse', 'HEAD']);
    git(repo, ['checkout', '-q', main]);
    const ancErr = await amendSpecificCommit(repo, { targetHash: sideHead, message: 'x' }).catch((e: unknown) => e);
    expect(ancErr).toMatchObject({ code: 'INVALID_QUERY', message: expect.stringContaining('不在当前分支历史中') });
  });
});

describe('GPG / commit template 提交链路消费', () => {
  const gpgDirs: string[] = [];

  beforeAll(() => {
    // 隔离：签名尝试读全局 key 与 gpg 环境——GIT_CONFIG_GLOBAL 指临时文件，绝不触碰真实全局配置
    const globalConfig = mkdtempSync(join(tmpdir(), 'rebased-api-gpg-'));
    process.env.GIT_CONFIG_GLOBAL = join(globalConfig, '.gitconfig');
    gpgDirs.push(globalConfig);
  });

  afterAll(() => gpgDirs.forEach(cleanupTmpRepo));

  it('commit.gpgsign=true + user.signingkey 无效：提交被签名失败拒绝（配置被消费的实证）', async () => {
    const repo = instantiateFixture(baseTemplate);
    gpgDirs.push(repo);
    writeFileSync(join(repo, 'b.txt'), 'v2\n');
    execFileSync('git', ['-C', repo, 'add', 'b.txt']);
    execFileSync('git', ['-C', repo, 'config', 'commit.gpgsign', 'true']);
    execFileSync('git', ['-C', repo, 'config', 'user.signingkey', 'DEADBEEF-NOT-A-KEY']);

    const err = await createCommit(repo, { message: '签名提交' }).catch((e: unknown) => e);

    // git commit 原生消费 commit.gpgsign/user.signingkey——签名失败（无 gpg/gle key）→ 非零退出透出
    expect(err).toMatchObject({ name: 'GitExitError' });
    const subjects = execFileSync('git', ['-C', repo, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
    expect(subjects).toEqual(['init']); // 提交未产生
  });

  it('commit.gpgsign=false：签名关闭 → 提交成功（关闭态消费验证）', async () => {
    const repo = instantiateFixture(baseTemplate);
    gpgDirs.push(repo);
    writeFileSync(join(repo, 'b.txt'), 'v2\n');
    execFileSync('git', ['-C', repo, 'add', 'b.txt']);
    execFileSync('git', ['-C', repo, 'config', 'commit.gpgsign', 'false']);

    const { hash } = await createCommit(repo, { message: '未签名提交' });

    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('commit.template：git commit -m 优先于模板——设置模板键后提交仍成功', async () => {
    const repo = instantiateFixture(baseTemplate);
    gpgDirs.push(repo);
    writeFileSync(join(repo, 'tpl.txt'), '模板内容\n');
    execFileSync('git', ['-C', repo, 'config', 'commit.template', join(repo, 'tpl.txt')]);
    writeFileSync(join(repo, 'b.txt'), 'v2\n');
    execFileSync('git', ['-C', repo, 'add', 'b.txt']);

    const { hash } = await createCommit(repo, { message: '带模板键的提交' });

    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });
});
