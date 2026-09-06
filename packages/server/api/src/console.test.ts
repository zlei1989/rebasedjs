import { afterAll, describe, expect, it } from 'vitest';
import { getStatus, runGit } from '@rebased/core';
import { getConsole } from './console';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

afterAll(() => dirs.forEach(cleanupTmpRepo));

describe('console 功能', () => {
  it('无执行记录时返回空数组', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    expect(await getConsole(repo, 10)).toEqual([]);
  });

  it('键控一致：core 原语在相同 repoPath 字符串上执行后即可查询到（id 从 1 起、旧→新）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    // 与路由层一致的路径原样透传——证明 getExecLog 按 cwd 键控的 key 匹配
    await getStatus(repo);

    const entries = await getConsole(repo, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 1, exitCode: 0, stderrTail: '' });
    expect(entries[0]!.args).toContain('status');
    expect(entries[0]!.args[0]).toBe('--no-pager'); // 最终参数数组（buildArgs 后）
    expect(entries[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(entries[0]!.atIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('limit 截断最近 N 条且保持原序（旧→新，最新在底）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await runGit(['config', 'user.email'], { cwd: repo });
    await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repo });

    const all = await getConsole(repo, 10);
    expect(all.map((e) => e.id)).toEqual([1, 2]);
    expect(all[0]!.args).toContain('config');
    expect(all[1]!.args).toContain('rev-parse');

    const last = await getConsole(repo, 1);
    expect(last).toHaveLength(1);
    expect(last[0]!.id).toBe(1); // 返回窗口内的最旧一条
    expect(last[0]!.args).toContain('rev-parse');
  });

  it('token 剥离：-c extraheader 对不进日志', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await runGit(['rev-parse', '--is-inside-work-tree'], {
      cwd: repo,
      extraConfig: ['http.https://example.com/.extraheader=AUTHORIZATION: basic dG9rZW4='],
    });

    const entries = await getConsole(repo, 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.args).toEqual(['--no-pager', '-c', 'core.pager=cat', 'rev-parse', '--is-inside-work-tree']);
    expect(JSON.stringify(entries[0]!.args)).not.toContain('dG9rZW4=');
    expect(JSON.stringify(entries[0]!.args)).not.toMatch(/extraheader/i);
  });
});
