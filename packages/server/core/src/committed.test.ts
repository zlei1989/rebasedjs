import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitFiles, committedPage } from './committed';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 写文件 + 提交，返回提交哈希 */
function commitFile(repo: string, file: string, content: string, msg: string): string {
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
  return git(repo, 'rev-parse', 'HEAD');
}

describe('committed 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 两提交各改不同文件：entries 最新在前；每提交文件集 + 元字段正确
  it('两提交各改不同文件：entries 最新在前且文件集/元字段正确', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create alpha');
    const h2 = commitFile(repo, 'b.txt', 'beta', 'create beta');

    const page = await committedPage(repo, { limit: 10, skip: 0 });

    expect(page.hasMore).toBe(false);
    expect(page.entries.map((e) => e.hash)).toEqual([h2, h1]);
    expect(page.entries.map((e) => e.shortHash)).toEqual([h2.slice(0, 7), h1.slice(0, 7)]);
    expect(page.entries.map((e) => e.subject)).toEqual(['create beta', 'create alpha']);
    expect(page.entries.map((e) => e.author)).toEqual(['Test User', 'Test User']);
    // %aI 原样透传（严格 ISO 含时区偏移）
    expect(page.entries[0].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h2));
    expect(page.entries[1].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h1));
    expect(page.entries[0].files).toEqual([{ path: 'b.txt', status: 'A' }]);
    expect(page.entries[1].files).toEqual([{ path: 'a.txt', status: 'A' }]);
    // %P 父哈希透传：second 的父为 first；first 为根提交（无父）→ []
    expect(page.entries[0].parents).toEqual([h1]);
    expect(page.entries[1].parents).toEqual([]);
  });

  // 根提交（单提交仓库）：parents 为空数组——容器据此对根提交的 diff 打开降级（终审 Must-fix 2）
  it('单提交仓库：根提交 parents 为空数组', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create alpha');

    const page = await committedPage(repo, { limit: 10, skip: 0 });

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].hash).toBe(h1);
    expect(page.entries[0].parents).toEqual([]);
  });

  // git mv 重命名：name-status 输出 R100<old><new> → status 'R' + renameFrom
  it('git mv 重命名提交：status R 且 renameFrom 指向旧路径', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'b.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'rename']);
    const h2 = git(repo, 'rev-parse', 'HEAD');

    const page = await committedPage(repo, { limit: 10, skip: 0 });

    expect(page.entries[0].hash).toBe(h2);
    expect(page.entries[0].files).toEqual([{ path: 'b.txt', status: 'R', renameFrom: 'a.txt' }]);
  });

  // limit=1：多取 1 试探 → 只返回 1 条且 hasMore=true
  it('limit=1：只返回 1 条且 hasMore=true', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create alpha');
    const h2 = commitFile(repo, 'b.txt', 'beta', 'create beta');

    const page = await committedPage(repo, { limit: 1, skip: 0 });

    expect(page.entries.map((e) => e.hash)).toEqual([h2]);
    expect(page.hasMore).toBe(true);
  });

  // skip=1：略过最新提交，从第二条起
  it('skip=1：跳过最新提交后返回其余条目', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create alpha');
    commitFile(repo, 'b.txt', 'beta', 'create beta');

    const page = await committedPage(repo, { limit: 10, skip: 1 });

    expect(page.entries.map((e) => e.hash)).toEqual([h1]);
    expect(page.hasMore).toBe(false);
  });

  // skip 越界：空 entries + hasMore=false
  it('skip 越界：空 entries 且 hasMore=false', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');

    const page = await committedPage(repo, { limit: 10, skip: 100 });

    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  // 引号还原：非 ASCII 路径输出为 C 引号（\NNN 八进制），空格路径不引号——两者都还原为原路径
  it('特殊字符路径：空格原样保留 + 非 ASCII 引号还原', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'with space.txt', 'sp', 'create spaced');
    commitFile(repo, '文件.txt', 'cn', 'create 中文');

    const page = await committedPage(repo, { limit: 10, skip: 0 });

    expect(page.entries[0].files).toEqual([{ path: '文件.txt', status: 'A' }]);
    expect(page.entries[1].files).toEqual([{ path: 'with space.txt', status: 'A' }]);
  });

  // commitFiles：单提交全量文件清单（Show All Affected 语义）——与同一提交的分页条目同源同形
  it('commitFiles：返回指定提交的单条目（含多文件与 renameFrom）', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');
    commitFile(repo, 'b.txt', 'beta', 'beta');
    execFileSync('git', ['-C', repo, 'mv', 'b.txt', 'c.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'rename']);
    const h = git(repo, 'rev-parse', 'HEAD');

    const entry = await commitFiles(repo, h);

    expect(entry.hash).toBe(h);
    expect(entry.subject).toBe('rename');
    // git mv + 无内容修改 → name-status 单条 R；多文件提交参考分页同源语义
    expect(entry.files).toEqual([{ path: 'c.txt', status: 'R', renameFrom: 'b.txt' }]);
  });

  // commitFiles 多文件提交：A/M 并存与分页条目一致
  it('commitFiles：多文件提交按路径排序输出（A/M 并存）', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');
    writeFileSync(join(repo, 'a.txt'), 'changed');
    commitFile(repo, 'n.txt', 'new', 'add n');
    const h = git(repo, 'rev-parse', 'HEAD');

    const entry = await commitFiles(repo, h);

    expect(entry.files).toEqual([
      { path: 'a.txt', status: 'M' },
      { path: 'n.txt', status: 'A' },
    ]);
  });

  // 无效哈希：git exit 128 透出 GitExitError（api 层以 verifyCommitish 预检挡在 400 之前）
  it('commitFiles：无效哈希 → GitExitError', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');

    await expect(commitFiles(repo, 'deadbeef'.repeat(5))).rejects.toMatchObject({ name: 'GitExitError', exitCode: 128 });
  });
});
