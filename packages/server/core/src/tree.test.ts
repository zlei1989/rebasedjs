import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listTreeAtRevision, parseTreeList } from './tree';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 写文件 + 提交，返回提交哈希 */
function commitFile(repo: string, file: string, content: string, msg: string): string {
  mkdirSync(join(repo, file.slice(0, file.lastIndexOf('/'))), { recursive: true });
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
  return git(repo, 'rev-parse', 'HEAD');
}

describe('tree 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 解析：NUL 分隔记录的字段切分（mode/type/hash/path）
  it('parseTreeList：解析 NUL 分隔记录为字段条目', () => {
    const stdout = '100644 blob abc123\tsrc/a.ts\0' + '160000 commit def456\tsub/mod\0' + '';
    expect(parseTreeList(stdout)).toEqual([
      { mode: '100644', type: 'blob', hash: 'abc123', path: 'src/a.ts' },
      { mode: '160000', type: 'commit', hash: 'def456', path: 'sub/mod' },
    ]);
  });

  // 多目录文件树：blob 平铺 + 子模块按 commit 类型呈现（gitlink，含空目录）
  it('嵌套目录：递归列出全部 blob，目录由上层聚合', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'A.txt', 'a', 'add A');
    commitFile(repo, 'src/lib/b.ts', 'b', 'add b');
    commitFile(repo, 'src/index.ts', 'i', 'add index');
    // 子模块（gitlink）：type 为 commit；符号链接：mode 120000
    execFileSync('git', ['-C', repo, 'update-index', '--add', '--cacheinfo', '160000,1111111111111111111111111111111111111111,sub/lib']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'add gitlink']);

    const entries = await listTreeAtRevision(repo, 'HEAD');

    const paths = entries.map((e) => e.path);
    expect(paths).toContain('A.txt');
    expect(paths).toContain('src/lib/b.ts');
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('sub/lib');
    const gitlink = entries.find((e) => e.path === 'sub/lib');
    expect(gitlink?.type).toBe('commit');
    expect(gitlink?.mode).toBe('160000');
    for (const e of entries) {
      expect(e.path).toBeTruthy();
      expect(e.hash).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  // 空提交：ls-tree 无输出 → []
  it('空提交：返回空条目数组', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'empty']);

    const entries = await listTreeAtRevision(repo, 'HEAD');

    expect(entries).toEqual([]);
  });

  // 无效 rev：git 报错上抛（上层映射 INVALID_REF）
  it('无效 rev：git 非零退出上抛', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await expect(listTreeAtRevision(repo, 'no-such-ref')).rejects.toThrow(/Not a valid object name/);
  });
});
