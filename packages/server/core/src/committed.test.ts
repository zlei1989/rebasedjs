import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitFiles } from './committed';
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

/* 本文件只覆盖 commitFiles（Show All Affected 语义，日志页变更集的数据源）。
   原 committedPage（分页浏览）的用例随该页撤除而删；其中**解析侧**的覆盖（引号还原、
   %P 父哈希、renameFrom）搬到这里继续钉住——两条路径共用 parseCommitted/COMMITTED_FORMAT，
   分页没了不等于这些解析规则不再被使用。 */
describe('committed 原语（单提交变更清单 commitFiles）', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 元字段与文件集：%P 父哈希（根提交为空数组）、%aI 原样透传、短哈希/主题/作者
  it('返回指定提交的元字段与文件集；根提交 parents 为空数组', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'a.txt', 'alpha', 'create alpha');
    const h2 = commitFile(repo, 'b.txt', 'beta', 'create beta');

    const second = await commitFiles(repo, h2);

    expect(second.hash).toBe(h2);
    expect(second.shortHash).toBe(h2.slice(0, 7));
    expect(second.subject).toBe('create beta');
    expect(second.author).toBe('Test User');
    // %aI 原样透传（严格 ISO 含时区偏移）
    expect(second.dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h2));
    expect(second.files).toEqual([{ path: 'b.txt', status: 'A' }]);
    // %P 父哈希透传：second 的父为 first；first 为根提交（无父）→ []
    expect(second.parents).toEqual([h1]);

    const root = await commitFiles(repo, h1);
    expect(root.parents).toEqual([]);
    expect(root.files).toEqual([{ path: 'a.txt', status: 'A' }]);
  });

  // git mv 重命名：name-status 输出 R100<old><new> → status 'R' + renameFrom
  it('git mv 重命名提交：status R 且 renameFrom 指向旧路径', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'b.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'rename']);
    const h = git(repo, 'rev-parse', 'HEAD');

    const entry = await commitFiles(repo, h);

    expect(entry.subject).toBe('rename');
    expect(entry.files).toEqual([{ path: 'b.txt', status: 'R', renameFrom: 'a.txt' }]);
  });

  // 引号还原：非 ASCII 路径输出为 C 引号（\NNN 八进制），空格路径不引号——两者都还原为原路径
  it('特殊字符路径：空格原样保留 + 非 ASCII 引号还原', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'with space.txt', 'sp', 'create spaced');
    const h2 = commitFile(repo, '文件.txt', 'cn', 'create 中文');

    expect((await commitFiles(repo, h2)).files).toEqual([{ path: '文件.txt', status: 'A' }]);
    expect((await commitFiles(repo, h1)).files).toEqual([{ path: 'with space.txt', status: 'A' }]);
  });

  // 多文件提交：A/M 并存，顺序即 git name-status 输出顺序
  it('多文件提交按路径排序输出（A/M 并存）', { timeout: 30000 }, async () => {
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
  it('无效哈希 → GitExitError', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'a.txt', 'alpha', 'create');

    await expect(commitFiles(repo, 'deadbeef'.repeat(5))).rejects.toMatchObject({ name: 'GitExitError', exitCode: 128 });
  });
});
