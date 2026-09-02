import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getRepoStatus } from './status';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('status 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('映射为契约形状（分支/变更条目/重命名）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'b.txt'), 'new');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'c.txt']);
    const s = await getRepoStatus(repo);
    expect(s.branch).toBeTruthy();
    expect(s.upstream).toBeNull();
    expect(s.headHash).toBeTruthy();
    expect(s.headHash).toMatch(/^[0-9a-f]{40}$/);
    expect(s.ahead).toBe(0);
    expect(s.entries.some((e) => e.path === 'c.txt' && e.renameFrom === 'a.txt')).toBe(true);
    expect(s.entries.some((e) => e.path === 'b.txt' && e.code === '??')).toBe(true);
  });
});
