import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getFileDiff, getFileThreeVersions, getFileVersions, streamDiffEvents } from './diff';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('diff 功能', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getFileDiff 返回契约形状', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const d = await getFileDiff(repo, { file: 'a.txt', staged: false });
    expect(d.path).toBe('a.txt');
    expect(d.text).toContain('+v2');
  });

  it('streamDiffEvents 产出契约事件且内容与全文一致', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    const full = await getFileDiff(repo, { file: 'a.txt', staged: false });
    let text = '';
    for await (const e of streamDiffEvents(repo, { file: 'a.txt', staged: false })) {
      expect(e.type).toBe('diff.chunk');
      text += e.payload.text;
    }
    expect(text).toBe(full.text);
  });

  it('仅提供 from 无 to 时抛 INVALID_QUERY', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileDiff(repo, { file: 'a.txt', from: 'HEAD', staged: false })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(streamDiffEvents(repo, { file: 'a.txt', from: 'HEAD', staged: false })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('staged 与 from/to 并存时抛 INVALID_QUERY', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileDiff(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD', staged: true })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(streamDiffEvents(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD', staged: true })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('getFileVersions 三态映射两侧内容', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    writeFileSync(join(repo, 'a.txt'), 'v3');
    const worktree = await getFileVersions(repo, { file: 'a.txt', staged: false });
    expect(worktree).toEqual({ before: 'v1', after: 'v3' });
    const staged = await getFileVersions(repo, { file: 'a.txt', staged: true });
    expect(staged).toEqual({ before: 'v1', after: 'v2' });
    const ranged = await getFileVersions(repo, { file: 'a.txt', from: 'HEAD', to: 'HEAD', staged: false });
    expect(ranged).toEqual({ before: 'v1', after: 'v1' });
  });

  it('getFileThreeVersions 三侧全文：HEAD 保持 v1、暂存区 v2、工作区 v3', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'a.txt'), 'v2');
    execFileSync('git', ['-C', repo, 'add', '.']);
    writeFileSync(join(repo, 'a.txt'), 'v3');
    const three = await getFileThreeVersions(repo, { file: 'a.txt' });
    expect(three).toEqual({ head: 'v1', staged: 'v2', working: 'v3' });
  });

  it('getFileThreeVersions 路径越界 → INVALID_QUERY；文件不存在 → GIT_ERROR 上抛', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileThreeVersions(repo, { file: '../secret' })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(getFileThreeVersions(repo, { file: 'no-such.txt' })).rejects.toBeInstanceOf(Error);
  });

  it('getFileVersions 沿用成对校验', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileVersions(repo, { file: 'a.txt', from: 'HEAD', staged: false }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('getFileVersions from/to：路径在 from 侧不存在（新增 A）→ before 为空串（git diff A B -- path 语义）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'b.txt'), 'b1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'add b']);
    const to = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
    const v = await getFileVersions(repo, { file: 'b.txt', from: `${to}~1`, to, staged: false });
    expect(v).toEqual({ before: '', after: 'b1' });
  });

  it('getFileVersions from/to：路径在 to 侧不存在（删除 D）→ after 为空串', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'b.txt'), 'b1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    rmSync(join(repo, 'b.txt'));
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'del b']);
    const to = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
    const v = await getFileVersions(repo, { file: 'b.txt', from: `${to}~1`, to, staged: false });
    expect(v).toEqual({ before: 'b1', after: '' });
  });

  it('file 含 .. 路径段时抛 INVALID_QUERY（防工作区直读逃逸仓库根）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileVersions(repo, { file: '../secret', staged: false }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('file 为绝对路径时抛 INVALID_QUERY（防工作区直读逃逸仓库根）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileDiff(repo, { file: join(repo, 'secret.txt'), staged: false }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
});
