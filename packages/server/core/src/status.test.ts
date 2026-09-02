import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getStatus, parsePorcelainV2 } from './status';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

describe('status 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('parsePorcelainV2 解析分支/上游/领先落后/重命名/未跟踪', () => {
    const raw = [
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 abc abc file.txt',
      '2 R. N... 100644 100644 100644 abc abc R100 new.txt\u0000old.txt',
      '? untracked.txt',
      '! ignored.log',
    ].join('\0');
    const s = parsePorcelainV2(raw);
    expect(s.branch).toBe('main');
    expect(s.upstream).toBe('origin/main');
    expect(s.headHash).toBe('abc123');
    expect(s.ahead).toBe(2);
    expect(s.behind).toBe(1);
    expect(s.entries).toHaveLength(4);
    expect(s.entries[1]).toEqual({ path: 'new.txt', code: 'R.', renameFrom: 'old.txt' });
    expect(s.entries[2].code).toBe('??');
  });

  it('getStatus 在真实仓库返回变更条目', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'hello');
    const s = await getStatus(repo);
    expect(s.branch).toBeTruthy();
    expect(s.entries.some((e) => e.path === 'a.txt' && e.code === '??')).toBe(true);

    // Ruling 17：真实 -z 输出下的重命名条目也要解析出 renameFrom
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    execFileSync('git', ['-C', repo, 'mv', 'a.txt', 'b.txt']);
    const s2 = await getStatus(repo);
    const renamed = s2.entries.find((e) => e.code === 'R.');
    expect(renamed).toBeDefined();
    expect(renamed?.path).toBe('b.txt');
    expect(renamed?.renameFrom).toBe('a.txt');
  });

  it('冲突仓库 status 含未合并条目', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    execFileSync('git', ['-C', repo, 'branch', '-M', 'main']);
    writeFileSync(join(repo, 'a.txt'), 'v1');
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
    execFileSync('git', ['-C', repo, 'checkout', '-q', '-b', 'side']);
    writeFileSync(join(repo, 'a.txt'), 'side');
    execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'side']);
    execFileSync('git', ['-C', repo, 'checkout', '-q', 'main']);
    writeFileSync(join(repo, 'a.txt'), 'main');
    execFileSync('git', ['-C', repo, 'commit', '-q', '-am', 'main']);
    try {
      execFileSync('git', ['-C', repo, 'merge', 'side'], { stdio: 'ignore' });
    } catch {
      /* 预期冲突：merge 以非零码退出 */
    }
    const s = await getStatus(repo);
    const unmerged = s.entries.find((e) => e.code === 'UU');
    expect(unmerged).toBeDefined();
    expect(unmerged?.path).toBe('a.txt');
  });
});
