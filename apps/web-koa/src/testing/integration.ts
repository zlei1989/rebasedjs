/**
 * web-koa 集成测试共享夹具（纯辅助，不含 vitest API）：
 * - startServer：createServer(app.callback()) + listen(0) 起 ephemeral 端口，返回 base 与 close（closeAllConnections 后 close）。
 * - tmpDir/sleep/rmRetry/cleanupDirs：临时目录登记与清理（Windows 上句柄未释放时 EPERM/EBUSY 指数退避重试）。
 * - registerRepo/makeConflictScenario/makeRemoteRig/pushRemoteCommit/makeLocalCommit：git 夹具。
 * - readBody：SSE/流式响应体收集。
 *
 * 模块级 dirs 数组按测试文件独立（vitest 每文件独立模块注册表 + 独立 worker），
 * 因此每个拆分文件各自维护自己的目录清单；cleanupDirs 供各文件 afterEach 调用，
 * resetDirs/getDirs 提供重置与只读访问。
 */
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../app';

/** 本模块（即当前测试文件）登记的临时目录 */
let dirs: string[] = [];

/** 重置登记目录（清空清单不删除；诊断/异常恢复用） */
export function resetDirs(): void {
  dirs = [];
}

/** 只读访问当前登记的临时目录 */
export function getDirs(): readonly string[] {
  return dirs;
}

/** 建临时目录并登记，供 afterEach cleanupDirs 统一清理 */
export function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Windows 上句柄未释放时 rmSync 抛 EPERM/EBUSY（force:true 只忽略 ENOENT）：指数退避重试，耗尽后才抛出 */
export async function rmRetry(dir: string, attempts = 6): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') || i === attempts - 1) throw err;
      await sleep(100 * (i + 1));
    }
  }
}

/** afterEach 清理：交换式取出全部登记目录并逐个带重试删除（清理失败不得留下陈旧清单） */
export async function cleanupDirs(): Promise<void> {
  const current = dirs;
  dirs = [];
  for (const dir of current) await rmRetry(dir);
}

/**
 * 起 ephemeral http 服务实测 app.callback()，返回 base 与 close。
 * close 先 closeAllConnections（销毁 SSE/keep-alive 连接）再 close，避免挂起等待。
 */
export async function startServer(): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createServer(app.callback());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** 建临时 git 仓库（一次提交，可选工作区改动供 diff 流产帧）并写入配置注册表，返回注册 repoId */
export function registerRepo(opts: { modify?: boolean } = {}): { repoId: string; repoPath: string } {
  const repo = tmpDir('rebased-web-koa-repo-');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'gc.auto', '0']); // 禁后台 gc：gc --auto 子进程残留会锁临时目录（Windows EPERM）
  // 身份同时写入仓库级 config：git config --get/--local 不读 GIT_AUTHOR_* 环境变量，
  // 而 config 端点测试断言 user.name 的 localValue === 'Test User'（依赖仓库级配置）；
  // 取值以 setup.ts 提供的环境变量为准，保证单一身份来源。
  execFileSync('git', ['-C', repo, 'config', 'user.email', process.env.GIT_AUTHOR_EMAIL ?? 'test@example.com']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', process.env.GIT_AUTHOR_NAME ?? 'Test User']);
  writeFileSync(join(repo, 'a.txt'), 'hello\n');
  execFileSync('git', ['-C', repo, 'add', 'a.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  if (opts.modify) writeFileSync(join(repo, 'a.txt'), 'hello\nworld\n');
  writeFileSync(
    join(process.env.REBASED_CONFIG_DIR as string, 'config.json'),
    JSON.stringify({
      repos: [{ id: 'r1', path: repo, name: 'tmp-repo', openedAt: new Date().toISOString() }],
      settings: { logInEditor: true, recentRepoIds: ['r1'] },
    }),
  );
  return { repoId: 'r1', repoPath: repo };
}

/** 冲突夹具：在注册仓库上造 side/main 两侧改 a.txt 同一行（合并必冲突，stage 1/2/3 全在） */
export function makeConflictScenario(repo: string): void {
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

/** SSE/流式读取：收集整个响应体为文本 */
export function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    res.on('data', (c: Buffer) => (body += c.toString('utf8')));
    res.on('end', () => resolve(body));
    res.on('error', reject);
  });
}

/** 裸仓库对端装置：注册仓库 + bare 当 origin + push -u 建 upstream；裸仓库 HEAD 指默认分支（配方同 api 层 remote 测试） */
export function makeRemoteRig(): { repoId: string; repoPath: string; bare: string; defaultBranch: string } {
  const { repoId, repoPath } = registerRepo();
  const defaultBranch = execFileSync('git', ['-C', repoPath, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const bare = tmpDir('rebased-web-koa-bare-');
  execFileSync('git', ['init', '-q', '--bare', bare]);
  execFileSync('git', ['-C', bare, 'config', 'gc.auto', '0']);
  execFileSync('git', ['-C', repoPath, 'remote', 'add', 'origin', bare]);
  execFileSync('git', ['-C', repoPath, 'push', '-q', '-u', 'origin', defaultBranch]);
  execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
  return { repoId, repoPath, bare, defaultBranch };
}

/** 第二 clone 对端：提交并推到裸仓库默认分支（制造远端新提交/分叉）。
 *  提交身份由环境变量（GIT_AUTHOR_*、GIT_COMMITTER_*，见 testing/setup.ts）提供，无需仓库级配置。 */
export function pushRemoteCommit(bare: string, defaultBranch: string, filename: string, content: string): void {
  const other = tmpDir('rebased-web-koa-other-');
  execFileSync('git', ['clone', '-q', bare, other]);
  execFileSync('git', ['-C', other, 'config', 'gc.auto', '0']);
  writeFileSync(join(other, filename), content);
  execFileSync('git', ['-C', other, 'add', filename]);
  execFileSync('git', ['-C', other, 'commit', '-q', '-m', `remote: ${filename}`]);
  execFileSync('git', ['-C', other, 'push', '-q', 'origin', `HEAD:${defaultBranch}`]);
}

/** 本地新提交（在指定仓库工作区上） */
export function makeLocalCommit(repoPath: string, filename: string, content: string, message: string): void {
  writeFileSync(join(repoPath, filename), content);
  execFileSync('git', ['-C', repoPath, 'add', filename]);
  execFileSync('git', ['-C', repoPath, 'commit', '-q', '-m', message]);
}
