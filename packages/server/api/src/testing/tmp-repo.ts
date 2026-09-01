/** 测试夹具：临时 git 仓库。仅测试使用，不进公共出口。 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createTmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rebased-core-'));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test User']);
  return dir;
}

export function cleanupTmpRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
