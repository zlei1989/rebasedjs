import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFileDiff, streamFileDiff } from './diff';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('diff 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('collectFileDiff 输出未暂存修改', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const text = await collectFileDiff(repo, { file: 'a.txt' });
    expect(text).toContain('--- a/a.txt');
    expect(text).toContain('+v2');
  });

  it('staged 模式只看暂存区，from/to 比较两个提交', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    const staged = await collectFileDiff(repo, { file: 'a.txt', staged: true });
    expect(staged).toContain('+v2');
    const ranged = await collectFileDiff(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD' });
    expect(ranged).toBe('');
  });

  it('streamFileDiff 分块产出与 collect 内容一致', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const text = await collectFileDiff(repo, { file: 'a.txt' });
    let streamed = '';
    for await (const chunk of streamFileDiff(repo, { file: 'a.txt' })) streamed += chunk;
    expect(streamed).toBe(text);
  });
});
