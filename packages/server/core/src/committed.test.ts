import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { committedPage } from './committed';
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
});
