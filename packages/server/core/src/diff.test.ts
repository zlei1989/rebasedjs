import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFileDiff, collectWorkingDiff, isUnbornHead, listDiffFiles, streamFileDiff } from './diff';
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

  it('collectFileDiff from-only：分支 vs 工作树（GitShowDiffWithRefAction 语义）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const text = await collectFileDiff(repo, { file: 'a.txt', from: head });
    expect(text).toContain('-v1');
    expect(text).toContain('+v2');
  });

  it('listDiffFiles：--name-status 解析（M/A/D + R 重命名双路径）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t.com']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'renamed.txt']);
    writeFileSync(join(repo, 'new.txt'), 'n');
    execFileSync('git', ['-C', repo, 'add', 'new.txt']);

    const files = await listDiffFiles(repo, head);
    const byPath = new Map(files.map((f) => [f.path, f]));
    expect(byPath.get('renamed.txt')).toMatchObject({ status: 'R', renameFrom: 'a.txt' });
    expect(byPath.get('new.txt')).toMatchObject({ status: 'A' });
    // 重命名 + 新增（无删除行——git diff <ref> 将 rename 折叠为 R）
    expect(files.some((f) => f.path === 'a.txt' && f.status === 'D')).toBe(false);
  });

  it('isUnbornHead / collectWorkingDiff：空仓库两段拼接（暂存 vs 空树 + 工作区 vs 索引）；born = git diff HEAD 语义', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    expect(await isUnbornHead(repo)).toBe(true);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    writeFileSync(join(repo, 'a.txt'), 'v2');

    const unborn = await collectWorkingDiff(repo);
    expect(unborn).toContain('+v1'); // 暂存段（vs 空树全新增）
    expect(unborn).toContain('-v1');
    expect(unborn).toContain('+v2');
    // 仅暂存 & 仅工作区：拼接不含对方遗漏
    const stagedOnly = await collectWorkingDiff(repo, []);
    expect(stagedOnly).toContain('+v1');
    void stagedOnly;

    // born：与 git diff HEAD 等价（工作区全量）——commit 带走暂存的 v1，HEAD= v1、工作区 v3
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    expect(await isUnbornHead(repo)).toBe(false);
    writeFileSync(join(repo, 'a.txt'), 'v3');
    const born = await collectWorkingDiff(repo);
    expect(born).toContain('-v1');
    expect(born).toContain('+v3');
  });
});
