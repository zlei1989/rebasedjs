import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './exec';
import { frameRecords, parseLogRecord, streamLog } from './log';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function commit(repo: string, file: string, msg: string): void {
  writeFileSync(join(repo, file), msg);
  execFileSync('git', ['-C', repo, 'add', '.']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', msg]);
}

describe('log 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('parseLogRecord 解析全字段与多行 message', () => {
    const raw = '| * \x01' + ['abc', 'abc123', 'p1 p2', '张三', 'a@b.c', '2026-09-01T10:00:00+08:00', 'HEAD -> main, tag: v1', '第一行\n第二行'].join('\x1f') + '\x02';
    const c = parseLogRecord(raw);
    expect(c.hash).toBe('abc');
    expect(c.parents).toEqual(['p1', 'p2']);
    expect(c.refs).toEqual(['HEAD -> main', 'tag: v1']);
    expect(c.message).toBe('第一行\n第二行');
    expect(c.graph).toBe('| *');
  });

  // 本机 git 命令耗时 ~0.5-1.6s/条（杀软扫描），默认 5s 超时不够，显式放宽
  it('streamLog 在双分支仓库产出全部提交', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'c1');
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'feature']);
    commit(repo, 'b.txt', 'c2');
    const commits = [];
    for await (const c of streamLog(repo, { maxCount: 10 })) commits.push(c);
    expect(commits).toHaveLength(2);
    expect(commits.some((c) => c.message === 'c1')).toBe(true);
    expect(commits.some((c) => c.message === 'c2')).toBe(true);
    expect(commits.every((c) => c.graph.length > 0)).toBe(true);
  });

  // 分支对比视图语义：range 'master..feature' 只含分支独有提交（c2），反向只含当前独有（c1）
  it('streamLog range 过滤：双分支独有提交双向视图（分支对比）', { timeout: 60000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'c1');
    const base = execFileSync('git', ['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'feature']);
    commit(repo, 'b.txt', 'c2');
    // 切换到原分支补一个提交（制造「当前独有」）
    execFileSync('git', ['-C', repo, 'checkout', '-q', base]);
    commit(repo, 'c.txt', 'c3');

    const featureOnly = [];
    for await (const c of streamLog(repo, { range: `${base}..feature` })) featureOnly.push(c.message);
    expect(featureOnly).toEqual(['c2']);

    const baseOnly = [];
    for await (const c of streamLog(repo, { range: `feature..${base}` })) baseOnly.push(c.message);
    expect(baseOnly).toEqual(['c3']);
  });

  // 复现审查缺陷：chunk 恰在 \x02 处结束时，终结符 \n 随下一 chunk 到达会缀到
  // 下一条记录头部（graph 变 '\n*'、width 虚增、图字符开头的内容行被多剥）
  it('frameRecords 在 chunk 恰以 \x02 结尾时不把终结符 \n 带进下条记录', { timeout: 30000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    commit(repo, 'a.txt', 'a\n| b');
    commit(repo, 'b.txt', 'c1');
    // 与 streamLog 相同的 --format（镜像自 log.ts 的 args 构造）
    const fmt = '\x01%H\x1f%h\x1f%P\x1f%an\x1f%ae\x1f%aI\x1f%D\x1f%B\x02';
    const { stdout } = await runGit(['log', '--graph', '--date-order', `--format=${fmt}`], { cwd: repo });
    // 把真实输出按 \x02 重切块：每块以 \x02 结尾，紧随的 \n 落入下一块头部
    const chunks: string[] = [];
    let last = 0;
    for (let idx = stdout.indexOf('\x02'); idx >= 0; idx = stdout.indexOf('\x02', last)) {
      chunks.push(stdout.slice(last, idx + 1));
      last = idx + 1;
    }
    if (last < stdout.length) chunks.push(stdout.slice(last));
    const commits = [];
    for await (const record of frameRecords(chunks)) commits.push(parseLogRecord(record));
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toBe('c1');
    expect(commits[0].graph).toBe('*');
    // 第二条记录头部缀过 \n：graph 不得污染为 '\n*'，'| b' 行不得被多剥成 ' b'
    expect(commits[1].message).toBe('a\n| b');
    expect(commits[1].graph).toBe('*');
  });
});
