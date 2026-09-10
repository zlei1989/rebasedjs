import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBranchWorkingDiff, getFileDiff, getFileThreeVersions, getFileVersions, streamDiffEvents } from './diff';
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

  it('to 无 from 时抛 INVALID_QUERY（from-only = 分支 vs 工作树，合法）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    await expect(getFileDiff(repo, { file: 'a.txt', to: 'HEAD', staged: false })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    // from-only：分支 vs 工作树（GitShowDiffWithRefAction 语义）——工作树与 HEAD 一致 → 空 diff
    const branchDiff = await getFileDiff(repo, { file: 'a.txt', from: 'HEAD', staged: false });
    expect(branchDiff.text).toBe('');
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

  it('getFileVersions 沿用成对校验（to 无 from → INVALID_QUERY；from-only 合法 = 分支 vs 工作树）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    await expect(getFileVersions(repo, { file: 'a.txt', to: 'HEAD', staged: false }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
    // from-only = 分支 vs 工作树（GitShowDiffWithRefAction 语义）：前后两侧 = 分支侧全文 + 工作树全文
    const fromOnly = await getFileVersions(repo, { file: 'a.txt', from: 'HEAD', staged: false });
    expect(fromOnly).toEqual({ before: 'v1', after: 'v1' });
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

  // 冒烟 F-033 复现：工作区已删除（D）的文件此前直读磁盘抛 ENOENT → 路由 500「内部错误」，diff 页整页打不开；
  // 修复后按 `git diff HEAD -- path` 语义取「新侧为空串」，页面渲染为「原文 → 空」
  it('getFileVersions 工作区模式：工作区已删除的文件 → after 空串（不再 500）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'gone.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    rmSync(join(repo, 'gone.txt'));
    const v = await getFileVersions(repo, { file: 'gone.txt', staged: false });
    expect(v).toEqual({ before: 'v1', after: '' });
  });

  it('getFileVersions 工作区模式：HEAD 无、工作区有（未跟踪/新增）→ before 空串', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    writeFileSync(join(repo, 'fresh.txt'), 'new');
    const v = await getFileVersions(repo, { file: 'fresh.txt', staged: false });
    expect(v).toEqual({ before: '', after: 'new' });
  });

  it('getFileThreeVersions：工作区已删除的文件 → working 空串（不再 500）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'gone.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    rmSync(join(repo, 'gone.txt'));
    const three = await getFileThreeVersions(repo, { file: 'gone.txt' });
    expect(three).toEqual({ head: 'v1', staged: 'v1', working: '' });
  });

  it('file 为绝对路径时抛 INVALID_QUERY（防工作区直读逃逸仓库根）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getFileDiff(repo, { file: join(repo, 'secret.txt'), staged: false }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
});

describe('getBranchWorkingDiff（GitShowDiffWithRefAction 语义：分支 vs 工作树）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('分支落后 HEAD 且有工作树改动 → 文件清单含状态；与工作树一致 → 空清单', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t.com']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    const main = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD']).toString().trim();
    // dev 分支停在 init（落后）；main 上加 new.txt 并改 a.txt 工作树
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'dev']);
    const dev = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD']).toString().trim();
    execFileSync('git', ['-C', repo, 'checkout', '-q', main]);
    writeFileSync(join(repo, 'new.txt'), 'n');
    execFileSync('git', ['-C', repo, 'add', 'new.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'add new']);
    writeFileSync(join(repo, 'a.txt'), 'v2'); // 工作树再改

    const view = await getBranchWorkingDiff(repo, dev);
    expect(view.branch).toBe(dev);
    const paths = view.files.map((f) => f.path).sort();
    expect(paths).toEqual(['a.txt', 'new.txt']);
    expect(view.files.find((f) => f.path === 'new.txt')?.status).toBe('A');
    expect(view.files.find((f) => f.path === 'a.txt')?.status).toBe('M');

    // 与工作树一致（检出 dev、无改动）→ 空清单
    execFileSync('git', ['-C', repo, 'stash', '-q']);
    execFileSync('git', ['-C', repo, 'checkout', '-q', dev]);
    const empty = await getBranchWorkingDiff(repo, dev);
    expect(empty.files).toEqual([]);
  });

  it('无效分支 → INVALID_REF', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(getBranchWorkingDiff(repo, 'ghost')).rejects.toMatchObject({
      code: 'INVALID_REF',
      message: '引用不存在或不是提交：ghost',
    });
  });
});
