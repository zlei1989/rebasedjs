import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchCommitsService } from './search';
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

/** 搜索夹具：h1 加 needle 行、h2 删 needle 行（grep 与 pickaxe 均命中）、h3 无关文档提交 */
function buildSearchRepo(): { repo: string; h1: string; h2: string; h3: string } {
  const repo = createTmpRepo();
  dirs.push(repo);
  const h1 = commitFile(repo, 'app.txt', 'alpha\nneedle\nomega', 'fix: add needle line');
  const h2 = commitFile(repo, 'app.txt', 'alpha\nomega', 'fix: remove needle line');
  const h3 = commitFile(repo, 'other.txt', 'x', 'docs: add other file');
  return { repo, h1, h2, h3 };
}

describe('searchCommitsService 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  // grep 模式：提交信息含 fix → 命中（最新在前），无关提交不出现，字段完整
  it('grep：提交信息含 fix 命中，无关提交不出现', { timeout: 30000 }, async () => {
    const { repo, h1, h2, h3 } = buildSearchRepo();

    const hits = await searchCommitsService(repo, { q: 'fix', mode: 'grep', limit: 10 });

    expect(hits.map((h) => h.hash)).toEqual([h2, h1]);
    expect(hits.map((h) => h.shortHash)).toEqual([h2.slice(0, 7), h1.slice(0, 7)]);
    expect(hits.map((h) => h.subject)).toEqual(['fix: remove needle line', 'fix: add needle line']);
    expect(hits.map((h) => h.author)).toEqual(['Test User', 'Test User']);
    // 日期：%aI 带时区偏移的 ISO，原样透传
    expect(hits[0].dateIso).toBe(git(repo, 'log', '-1', '--format=%aI', h2));
    expect(hits.map((h) => h.hash)).not.toContain(h3);
  });

  // grep -i：大小写不敏感（FIX 命中 fix 提交）
  it('grep：大小写不敏感（FIX 命中 fix 提交）', { timeout: 30000 }, async () => {
    const { repo, h1, h2 } = buildSearchRepo();

    const hits = await searchCommitsService(repo, { q: 'FIX', mode: 'grep', limit: 10 });

    expect(hits.map((h) => h.hash)).toEqual([h2, h1]);
  });

  // pickaxe：-S 加/删一行特定串都命中（最新在前）
  it('pickaxe：加/删 needle 行的两个提交都命中', { timeout: 30000 }, async () => {
    const { repo, h1, h2, h3 } = buildSearchRepo();

    const hits = await searchCommitsService(repo, { q: 'needle', mode: 'pickaxe', limit: 10 });

    expect(hits.map((h) => h.hash)).toEqual([h2, h1]);
    expect(hits.map((h) => h.subject)).toEqual(['fix: remove needle line', 'fix: add needle line']);
    expect(hits.map((h) => h.hash)).not.toContain(h3);
  });

  // limit 截断：3 个命中 → limit=1 只回 1 条（最新）
  it('limit 截断：只返回最新 limit 条', { timeout: 30000 }, async () => {
    const { repo, h2 } = buildSearchRepo();

    const hits = await searchCommitsService(repo, { q: 'fix', mode: 'grep', limit: 1 });

    expect(hits.map((h) => h.hash)).toEqual([h2]);
  });

  // 无命中：空数组
  it('无命中：返回空数组', { timeout: 30000 }, async () => {
    const { repo } = buildSearchRepo();

    const hits = await searchCommitsService(repo, { q: 'zzz-not-present', mode: 'grep', limit: 10 });

    expect(hits).toEqual([]);
  });

  // 非法正则：grep 按正则交给 git（`[`/`fix(` 等）→ git 128 'Invalid regular expression'
  // → INVALID_QUERY（调用方输入问题），而非 GIT_ERROR 500（终审 Minor）
  it('grep 非法正则：INVALID_QUERY 搜索表达式不是合法的正则表达式', { timeout: 30000 }, async () => {
    const { repo } = buildSearchRepo();

    await expect(searchCommitsService(repo, { q: '[', mode: 'grep', limit: 10 }))
      .rejects.toMatchObject({ code: 'INVALID_QUERY', message: '搜索表达式不是合法的正则表达式' });
  });
});
