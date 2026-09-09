/**
 * web-next 路由测试共享辅助（自 routes.test.ts 按 describe 拆分时抽取）。
 * 每个拆分测试文件独立加载本模块（vitest 文件级模块隔离），模块级状态（dirs/lastRepoPath）
 * 互不共享，保持原单文件语义。
 * git 提交身份由 vitest setupFiles（./setup.ts）注入的 GIT_AUTHOR_* 与 GIT_COMMITTER_* 环境变量提供，
 * 夹具不再写 git config user.*；断言仓库本地 config 值的用例由所在文件做文件级隔离补设。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Next 16：route 第二参的 params 为 Promise */
export function ctx(repoId: string): { params: Promise<{ repoId: string }> } {
  return { params: Promise.resolve({ repoId }) };
}

/** 本测试文件创建的临时目录清单（cleanupTestEnv 统一 force 清理） */
export let dirs: string[] = [];

/** 建临时目录并登记到 dirs */
export function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 最近一次 registerRepo 的仓库磁盘路径（供测试内制造工作区改动） */
export let lastRepoPath = '';

/** 建临时 git 仓库（一次提交）并写入配置注册表，返回注册 repoId */
export function registerRepo(): string {
  const repo = tmpDir('rebased-web-next-repo-');
  lastRepoPath = repo;
  execFileSync('git', ['init', '-q', repo]);
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
export function makeConflictScenario(): void {
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
export function makeRemoteRig(): { repoId: string; bare: string; defaultBranch: string } {
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

/** 第二 clone 对端：提交并推到裸仓库默认分支（制造远端新提交/分叉）；身份由 GIT_* 环境变量提供 */
export function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = tmpDir('rebased-web-next-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
  writeFileSync(join(other, filename), content);
  execFileSync('git', ['-C', other, 'add', filename]);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', `remote: ${filename}`]);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

/** 本地新提交（在 registerRepo 的仓库工作区上）；身份由 GIT_* 环境变量提供 */
export function makeLocalCommit(filename: string, content: string, message: string): void {
  writeFileSync(join(lastRepoPath, filename), content);
  execFileSync('git', ['-C', lastRepoPath, 'add', filename]);
  execFileSync('git', ['-C', lastRepoPath, 'commit', '-q', '-m', message]);
}

/** 每用例独立 REBASED_CONFIG_DIR（空注册表）：原 routes.test.ts 文件级 beforeEach 逻辑 */
export function setupTestEnv(): void {
  process.env.REBASED_CONFIG_DIR = tmpDir('rebased-web-next-config-');
}

/** 删除 REBASED_CONFIG_DIR 并 force 清理本文件创建的全部临时目录：原 routes.test.ts 文件级 afterEach 逻辑 */
export function cleanupTestEnv(): void {
  delete process.env.REBASED_CONFIG_DIR;
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
}
