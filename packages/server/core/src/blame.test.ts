import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileBlame, parentHashesOf } from './blame';
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

/** 提交作者严格 ISO（%aI：作者时区偏移墙钟）→ blamer 期望的 dateIso（对齐 history/committed/search 口径） */
function authorIso(repo: string, hash: string): string {
  return git(repo, 'log', '-1', '--format=%aI', hash);
}

describe('blame 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // 两提交改同一行：结果行数 = 文件行数；行 1 归属首提交、行 2 归属次提交
  it('两提交改同一行：逐行归属第二提交并解析 hash/author/date/previousLineno', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'f.txt', 'alpha\nbeta', 'first');
    const h2 = commitFile(repo, 'f.txt', 'alpha\nBETA', 'second');

    const lines = await fileBlame(repo, 'f.txt');

    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.content)).toEqual(['alpha', 'BETA']);
    // 行 1：归属首提交；首提交为边界（文件首创建）→ previousLineno null
    expect(lines[0].lineno).toBe(1);
    expect(lines[0].hash).toBe(h1);
    expect(lines[0].shortHash).toBe(h1.slice(0, 7));
    expect(lines[0].author).toBe('Test User');
    expect(lines[0].authorEmail).toBe('test@example.com');
    expect(lines[0].dateIso).toBe(authorIso(repo, h1));
    expect(lines[0].previousLineno).toBeNull();
    // 行 2：归属次提交；编辑溯源 → previousLineno = 次提交版本中的源行号
    expect(lines[1].lineno).toBe(2);
    expect(lines[1].hash).toBe(h2);
    expect(lines[1].shortHash).toBe(h2.slice(0, 7));
    expect(lines[1].author).toBe('Test User');
    expect(lines[1].authorEmail).toBe('test@example.com');
    expect(lines[1].dateIso).toBe(authorIso(repo, h2));
    expect(lines[1].previousLineno).toBe(2);
  });

  // 重命名文件（git mv）+ 修改：previous 溯源行出现在重命名/编辑交集的行
  it('git mv 重命名 + 修改：previousLineno 非空且指向重命名前行号', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    const h1 = commitFile(repo, 'notes.txt', 'alpha\nbravo\ncharlie', 'create');
    execFileSync('git', ['-C', repo, 'mv', 'notes.txt', 'diary.txt']);
    const h2 = commitFile(repo, 'diary.txt', 'alpha\nBRAVO\ncharlie', 'rename+edit');

    const lines = await fileBlame(repo, 'diary.txt');

    expect(lines).toHaveLength(3);
    // 未改动行仍归属首提交（文件首创建）→ previousLineno null
    expect(lines[0].content).toBe('alpha');
    expect(lines[0].hash).toBe(h1);
    expect(lines[0].previousLineno).toBeNull();
    // 重命名 + 编辑的行归属次提交，且溯源到重命名前的行号
    expect(lines[1].content).toBe('BRAVO');
    expect(lines[1].hash).toBe(h2);
    expect(lines[1].lineno).toBe(2);
    expect(lines[1].previousLineno).toBe(2);
    expect(lines[2].content).toBe('charlie');
    expect(lines[2].hash).toBe(h1);
    expect(lines[2].previousLineno).toBeNull();
  });

  // 非 UTC 作者时区：dateIso 为 %aI 等价偏移 ISO（author-tz 参与墙钟，而非 UTC 截断——终审 Must-fix 1）
  it('非 UTC 作者时区：dateIso 含作者时区偏移（与 %aI 严格一致）', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'f.txt', 'alpha\nbeta', 'first');
    writeFileSync(join(repo, 'f.txt'), 'alpha\nBETA');
    execFileSync('git', ['-C', repo, 'add', '.']);
    // 显式作者时间 + 偏移：wall clock 10:00 +08:00（epoch 为 02:00Z——若按 UTC 截断会错 8 小时）
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'second'], {
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T10:00:00+08:00',
        GIT_COMMITTER_DATE: '2026-01-01T10:00:00+08:00',
      },
    });
    const h2 = git(repo, 'rev-parse', 'HEAD');

    const lines = await fileBlame(repo, 'f.txt');

    expect(lines[1].hash).toBe(h2);
    expect(lines[1].dateIso).toBe('2026-01-01T10:00:00+08:00');
    expect(lines[1].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h2));
  });

  // 冒烟 D-18 复现：工作区存在未提交改动时，git blame 对未提交行输出零哈希伪提交，
  // 修复前 parentHashesOf 把它传给 git log → `fatal: bad object 0000…` 退出码 128 → blame 页 500
  it('未提交行（零哈希）不进入 git log 参数，父哈希按空列表返回', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commitFile(repo, 'f.txt', 'alpha\nbeta', 'first');
    writeFileSync(join(repo, 'f.txt'), 'alpha\nbeta\nGAMMA');
    const lines = await fileBlame(repo, 'f.txt');
    const zero = lines.find((l) => /^0{40}$/.test(l.hash));
    expect(zero).toBeDefined();
    const parents = await parentHashesOf(repo, [...new Set(lines.map((l) => l.hash))]);
    expect(parents[zero!.hash]).toEqual([]);
    // 其余真实提交仍解析出父哈希
    const head = git(repo, 'rev-parse', 'HEAD');
    expect(parents[head]).toEqual([]);
  });
});
