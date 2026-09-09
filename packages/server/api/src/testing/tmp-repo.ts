/**
 * 测试夹具：临时 git 仓库。仅测试使用，不进公共出口。
 * 平台坑集中在此处理：Windows %TEMP% 8.3 短路径归一（msys2 git 并发 chdir 竞态）、
 * 清理期 EPERM/EBUSY 重试（git 子进程句柄未释放时 rmSync 的 force 只忽略 ENOENT）。
 *
 * 性能：本机实测单次 git spawn ~330ms，建仓曾是每仓库 3 spawn（init + 2×config）。
 * 模板化后：模块级用真实 git init 建一次模板仓库（config 直接写入 [user] 段），
 * 之后每次建仓仅 cpSync 复制（0 spawn）；提交身份另由 setup.ts 注入的
 * GIT_AUTHOR_* / GIT_COMMITTER_* 环境变量兜底，与模板值一致。
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 创建临时目录并归一为长路径：Windows 的 %TEMP% 可能以 8.3 短形式存在
 * （C:\Users\ZHANGL~1\...），msys2 git 并发下对短路径 chdir 偶发
 * "cannot change to ... No such file or directory"——入口统一归一，短路径不再流向 git。
 * 供裸仓库/普通夹具目录使用；仓库夹具用 createTmpRepo。
 */
export function createTmpDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

/** 模板仓库：真实 git init 建一次（含 [user] 段 config），之后建仓复制它。
 *  lazy 构建且跨用例复用——整个测试进程只付一次 init 的 spawn 成本；
 *  模板目录随进程存续，残留交给系统临时目录清理（见文件头约定）。 */
let repoTemplate: string | null = null;

function getRepoTemplate(): string {
  if (repoTemplate === null) {
    const dir = createTmpDir('rebased-api-template-');
    execFileSync('git', ['init', '-q', dir]);
    // 直接追加 [user] 段，省去 2 次 git config spawn（与历史夹具值保持一致）
    writeFileSync(join(dir, '.git', 'config'), '[user]\n\temail = test@example.com\n\tname = Test User\n', { flag: 'a' });
    repoTemplate = dir;
  }
  return repoTemplate;
}

/** 建临时仓库：复制模板（0 spawn）。行为与 git init + 预设身份等价（见 getRepoTemplate） */
export function createTmpRepo(): string {
  const dir = createTmpDir('rebased-api-');
  cpSync(getRepoTemplate(), dir, { recursive: true });
  return dir;
}

/** 同步阻塞等待（测试清理用；Atomics.wait 主线程可用） */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 清理临时仓库，Windows 下带重试：git 子进程句柄未释放/杀毒扫描时 rmSync 抛
 * EPERM/EBUSY/ENOTEMPTY——100ms 起指数退避共 6 次；耗尽后仅告警不抛错：
 * 残留目录交给系统临时目录清理，清理竞态不反噬用例结果。
 */
export function cleanupTmpRepo(dir: string): void {
  let delayMs = 100;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw err;
      if (attempt === 6) {
        console.warn(`[cleanupTmpRepo] ${code} 重试 6 次仍失败，跳过清理：${dir}`);
        return;
      }
      sleepSync(delayMs);
      delayMs *= 2;
    }
  }
}
