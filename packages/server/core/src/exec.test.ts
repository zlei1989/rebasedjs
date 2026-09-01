import { afterAll, describe, expect, it } from 'vitest';
import { GitExitError, runGit } from './exec';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('runGit', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('在真实仓库执行 git 命令', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const r = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo });
    expect(r.stdout.trim()).toBe('true');
    expect(r.stderr).toBe('');
  });

  it('非零退出抛 GitExitError 并携带 stderr', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(runGit(['rev-parse', 'no-such-thing'], { cwd: repo })).rejects.toMatchObject({
      name: 'GitExitError',
      exitCode: 128,
    });
  });

  it('AbortSignal 终止进行中的命令', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const ac = new AbortController();
    const p = runGit(['log', '--all'], { cwd: repo, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(GitExitError);
  });
});
