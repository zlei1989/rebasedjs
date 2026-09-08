import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCommitFiles, getCommittedPage } from './committed';
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

describe('getCommittedPage 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 成功矩阵：两提交各改不同文件 → 最新在前、文件集/元字段正确、末页 hasMore=false
  it('两提交各改不同文件：最新在前且文件集正确', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create alpha');
    const h2 = commitFile(repo, 'b.txt', 'beta', 'create beta');

    const page = await getCommittedPage(repo, { limit: 10, skip: 0 });

    expect(page.hasMore).toBe(false);
    expect(page.entries.map((e) => e.hash)).toEqual([h2, h1]);
    expect(page.entries.map((e) => e.shortHash)).toEqual([h2.slice(0, 7), h1.slice(0, 7)]);
    expect(page.entries.map((e) => e.subject)).toEqual(['create beta', 'create alpha']);
    expect(page.entries[0].author).toBe('Test User');
    // 日期：%aI 带时区偏移的 ISO，原样透传
    expect(page.entries[0].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h2));
    expect(page.entries[1].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h1));
    expect(page.entries[0].files).toEqual([{ path: 'b.txt', status: 'A' }]);
    expect(page.entries[1].files).toEqual([{ path: 'a.txt', status: 'A' }]);
    // %P 父哈希透传：second 的父为 first；first 为根提交（无父）→ []
    expect(page.entries[0].parents).toEqual([h1]);
    expect(page.entries[1].parents).toEqual([]);
  });

  // git mv 重命名：status 'R' + renameFrom 指向旧路径
  it('git mv 重命名提交：status R 且 renameFrom 指向旧路径', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'b.txt']);
    const h2 = commitFile(repo, 'b.txt', 'alpha', 'rename');

    const page = await getCommittedPage(repo, { limit: 10, skip: 0 });

    expect(page.entries[0].hash).toBe(h2);
    expect(page.entries[0].files).toEqual([{ path: 'b.txt', status: 'R', renameFrom: 'a.txt' }]);
  });

  // 分页 hasMore 语义：limit=1 多取 1 试探 → 只回 1 条且 hasMore=true
  it('limit=1：只返回 1 条且 hasMore=true', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create alpha');
    const h2 = commitFile(repo, 'b.txt', 'beta', 'create beta');

    const page = await getCommittedPage(repo, { limit: 1, skip: 0 });

    expect(page.entries.map((e) => e.hash)).toEqual([h2]);
    expect(page.hasMore).toBe(true);
  });

  // skip 越界：空 entries + hasMore=false
  it('skip 越界：空 entries 且 hasMore=false', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');

    const page = await getCommittedPage(repo, { limit: 10, skip: 100 });

    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  // 契约 status 联合含 'T'（typechange）：普通文件 → 符号链接（mode 100644→120000），
  // 索引方式登记（git update-index --cacheinfo），不依赖工作区真实符号链接（Windows 免提权）
  it('类型变更提交：status T 透传（typechange）', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'x.txt', 'v1', 'regular file');
    const blob = git(repo, 'hash-object', '-w', 'x.txt');
    execFileSync('git', ['-C', repo, 'update-index', '--add', '--cacheinfo', `120000,${blob},x.txt`]);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'typechange']);
    const h2 = git(repo, 'rev-parse', 'HEAD');

    const page = await getCommittedPage(repo, { limit: 10, skip: 0 });

    expect(page.entries[0].hash).toBe(h2);
    expect(page.entries[0].files).toEqual([{ path: 'x.txt', status: 'T' }]);
    expect(page.entries[1].hash).toBe(h1);
    expect(page.entries[1].files).toEqual([{ path: 'x.txt', status: 'A' }]);
  });
});

describe('getCommitFiles 服务（Show All Affected 语义 #34）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 成功：指定提交的单条目（含多文件、renameFrom；status 窄化到契约联合）
  it('指定提交：返回单条目且文件集正确（含重命名 renameFrom）', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'b.txt']);
    commitFile(repo, 'c.txt', 'gamma', 'add c');
    const h = git(repo, 'rev-parse', 'HEAD');

    const entry = await getCommitFiles(repo, h);

    expect(entry.hash).toBe(h);
    expect(entry.shortHash).toBe(h.slice(0, 7));
    expect(entry.subject).toBe('add c');
    expect(entry.author).toBe('Test User');
    expect(entry.parents).toEqual([git(repo, 'rev-parse', 'HEAD~1')]);
    expect(entry.files).toEqual([
      { path: 'b.txt', status: 'R', renameFrom: 'a.txt' },
      { path: 'c.txt', status: 'A' },
    ]);
  });

  // 无效哈希：预检 INVALID_REF（先于 git 执行）
  it('无效哈希：INVALID_REF 引用不存在或不是提交', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');

    const err = await getCommitFiles(repo, 'deadbeef'.repeat(5)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INVALID_REF', message: expect.stringContaining('引用不存在或不是提交：deadbeef') });
  });
});
