import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getCommitFiles } from './committed';
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

/* 原 getCommittedPage（已提交变更分页浏览）的用例随该页撤除而删；其中**映射侧**的覆盖
   （契约 status 联合含 'T' 的窄化）搬到这里——两条路径共用 toCommittedEntry。 */
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

    expect((await getCommitFiles(repo, h2)).files).toEqual([{ path: 'x.txt', status: 'T' }]);
    expect((await getCommitFiles(repo, h1)).files).toEqual([{ path: 'x.txt', status: 'A' }]);
  });

  // 无效哈希：预检 INVALID_REF（先于 git 执行）
  it('无效哈希：INVALID_REF 引用不存在或不是提交', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');

    const err = await getCommitFiles(repo, 'deadbeef'.repeat(5)).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INVALID_REF', message: expect.stringContaining('引用不存在或不是提交：deadbeef') });
  });

  /* message：整条提交信息（%B）。注解行点击哈希后的浮层要展示「完整提交内容」，
     而 subject（%s）只是首行——这是两者必须同时下发的理由。 */
  it('message 下发完整提交信息（主题 + 多行正文，含制表符正文行）', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const body = 'feat: 主题行\n\n正文第一段\n\nA\tfake.txt';
    const h = commitFile(repo, 'a.txt', 'alpha', body);

    const entry = await getCommitFiles(repo, h);

    expect(entry.subject).toBe('feat: 主题行');
    expect(entry.message).toBe(body);
    // 正文里的 name-status 形状行不得污染变更清单（%B 独立取，见 core 的同名说明）
    expect(entry.files).toEqual([{ path: 'a.txt', status: 'A' }]);
  });
});
