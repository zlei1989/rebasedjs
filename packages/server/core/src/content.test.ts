import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileAtRev } from './content';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('readFileAtRev', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('三态读取：工作区 / HEAD / 暂存区', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');          // 工作区 v2
    execFileSync('git', ['-C', repo, 'add', '.']);     // 暂存区 v2
    writeFileSync(join(repo, 'a.txt'), 'v3');          // 工作区 v3
    expect(await readFileAtRev(repo, { file: 'a.txt' })).toBe('v3');
    expect(await readFileAtRev(repo, { file: 'a.txt', rev: 'HEAD' })).toBe('v1');
    expect(await readFileAtRev(repo, { file: 'a.txt', rev: '' })).toBe('v2');
  });

  it('不存在的 rev/文件抛 GitExitError', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    await expect(readFileAtRev(repo, { file: 'a.txt', rev: 'no-such-ref' })).rejects.toMatchObject({ name: 'GitExitError' });
    await expect(readFileAtRev(repo, { file: 'missing.txt', rev: 'HEAD' })).rejects.toMatchObject({ name: 'GitExitError' });
  });
});
