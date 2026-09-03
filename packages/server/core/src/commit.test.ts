import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitStaged } from './commit';
import { runGit } from './exec';
import { stagePaths } from './staging';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('commitStaged', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('提交暂存区并返回 40 位十六进制哈希，提交标题等于 message', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    await stagePaths(repo, ['a.txt']);
    const hash = await commitStaged(repo, { message: 'feat: 初始提交' });
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    const { stdout } = await runGit(['log', '-1', '--format=%s'], { cwd: repo });
    expect(stdout.trim()).toBe('feat: 初始提交');
  });

  it('amend 修订上一提交：提交数不变', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'init' });
    writeFileSync(join(repo, 'a.txt'), 'v2');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'init（修订）', amend: true });
    const { stdout } = await runGit(['rev-list', '--count', 'HEAD'], { cwd: repo });
    expect(stdout.trim()).toBe('1');
    const { stdout: subject } = await runGit(['log', '-1', '--format=%s'], { cwd: repo });
    expect(subject.trim()).toBe('init（修订）');
  });

  it('signOff 追加 Signed-off-by 尾注', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    await stagePaths(repo, ['a.txt']);
    await commitStaged(repo, { message: 'signed', signOff: true });
    const { stdout } = await runGit(['log', '-1', '--format=%B'], { cwd: repo });
    expect(stdout).toContain('Signed-off-by: Test User <test@example.com>');
  });
});
