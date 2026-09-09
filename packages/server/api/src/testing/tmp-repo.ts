/**
 * 测试夹具：临时 git 仓库。仅测试使用，不进公共出口。
 * 平台坑集中在此处理：Windows %TEMP% 8.3 短路径归一（msys2 git 并发 chdir 竞态）、
 * 清理期 EPERM/EBUSY 重试（git 子进程句柄未释放时 rmSync 的 force 只忽略 ENOENT）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
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

export function createTmpRepo(): string {
  const dir = createTmpDir('rebased-core-');
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test User']);
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
