/** submodule 原语集成测试（真实 git；本地 file URL 需 -c protocol.file.allow=always 造夹具，见 task-2-report） */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listSubmodules, mergeSubmoduleStatuses, parseSubmodulesConfig, updateSubmodules } from './submodule';
import type { SubmoduleConfigEntry } from './submodule';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/**
 * 子模块夹具：内容仓库两提交（A/B）→ 本地裸仓库；主仓库 submodule add（-c protocol.file.allow=always）。
 * 返回 { super, content, bareUrl, aSha, bSha, gitlinkSha }。
 */
function makeSubmoduleSuper(opts: { branch?: string; path?: string } = {}): {
  super: string;
  content: string;
  bareUrl: string;
  aSha: string;
  bSha: string;
  gitlinkSha: string;
} {
  const content = createTmpRepo();
  dirs.push(content);
  writeFileSync(join(content, 'c.txt'), 'c1');
  git(content, ['add', 'c.txt']);
  git(content, ['commit', '-q', '-m', 'A']);
  const aSha = git(content, ['rev-parse', 'HEAD']);
  writeFileSync(join(content, 'c.txt'), 'c2');
  git(content, ['commit', '-q', '-am', 'B']);
  const bSha = git(content, ['rev-parse', 'HEAD']);
  if (opts.branch !== undefined) git(content, ['branch', opts.branch]);
  const bare = content + '.git';
  dirs.push(bare);
  git(content, ['clone', '--bare', '-q', '.', bare]);
  const bareUrl = bare.replace(/\\/g, '/');
  const subPath = opts.path ?? 'sub';
  const superRepo = createTmpRepo();
  dirs.push(superRepo);
  writeFileSync(join(superRepo, 's.txt'), 's');
  git(superRepo, ['add', 's.txt']);
  git(superRepo, ['commit', '-q', '-m', 's1']);
  const addArgs = ['-C', superRepo, '-c', 'protocol.file.allow=always', 'submodule', 'add'];
  if (opts.branch !== undefined) addArgs.push('-b', opts.branch);
  execFileSync('git', [...addArgs, bareUrl, subPath], { encoding: 'utf8' });
  git(superRepo, ['add', '-A']);
  git(superRepo, ['commit', '-q', '-m', 'addsub']);
  const gitlinkSha = git(superRepo, ['rev-parse', `HEAD:${subPath}`]);
  return { super: superRepo, content, bareUrl, aSha, bSha, gitlinkSha };
}

describe('submodule 原语', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('listSubmodules 无 .gitmodules 返回空数组', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'f.txt'), 'f');
    git(repo, ['add', 'f.txt']);
    git(repo, ['commit', '-q', '-m', 'f']);

    expect(await listSubmodules(repo)).toEqual([]);
  });

  // fixture 每次约 12-15 次 git 子进程（submodule add 克隆 + 多次 status，单次 0.3-5s）——
  // 与全量套件并行时超过 vitest 默认 30s，放宽到 180s（环境实测记录见 task-2-report）
  it('checked-out 往返：改检出 → different-commit → update 复原', { timeout: 180_000 }, async () => {
    const { super: superRepo, content, aSha, bSha, gitlinkSha } = makeSubmoduleSuper();

    // 初始：submodule add 后即 checked-out（status 前缀空格，commitSha=gitlink sha）
    let list = await listSubmodules(superRepo);
    expect(list).toHaveLength(1);
    const first = list[0];
    expect(first.name).toBe('sub');
    expect(first.path).toBe('sub');
    expect(first.url).toBe(git(superRepo, ['config', '-f', '.gitmodules', '--get', 'submodule.sub.url']));
    expect(first.branch).toBeUndefined();
    expect(first.status).toBe('checked-out');
    expect(first.commitSha).toBe(gitlinkSha);
    expect(gitlinkSha).toBe(bSha);

    // 子模块内容仓库新提交（非主仓库 HEAD 所记录）→ 工作树检出旧提交 A → different-commit
    git(join(superRepo, 'sub'), ['checkout', '-q', aSha]);
    list = await listSubmodules(superRepo);
    const second = list[0];
    expect(second.status).toBe('different-commit');
    expect(second.commitSha).toBe(aSha);

    // update --init 无网络（对象在本仓库）→ 复原 checked-out
    await updateSubmodules(superRepo);
    list = await listSubmodules(superRepo);
    expect(list[0].status).toBe('checked-out');
    expect(list[0].commitSha).toBe(gitlinkSha);
    expect(git(join(superRepo, 'sub'), ['rev-parse', 'HEAD'])).toBe(bSha);
    expect(git(content, ['rev-parse', 'HEAD'])).toBe(bSha);
  });

  it('updateSubmodules name 限定 path（含空格路径）与未知 name 报错', { timeout: 180_000 }, async () => {
    const { super: superRepo, aSha, gitlinkSha } = makeSubmoduleSuper({ path: 'Sub Dir' });

    let list = await listSubmodules(superRepo);
    expect(list[0].name).toBe('Sub Dir'); // .gitmodules 实际子模块名（含空格）逐字保留
    expect(list[0].path).toBe('Sub Dir');
    expect(list[0].status).toBe('checked-out');

    git(join(superRepo, 'Sub Dir'), ['checkout', '-q', aSha]);
    await expect(updateSubmodules(superRepo, { name: 'nope' })).rejects.toThrow(/nope/);

    await expect(updateSubmodules(superRepo, { name: 'Sub Dir', recursive: true })).resolves.toBeUndefined();
    list = await listSubmodules(superRepo);
    expect(list[0].status).toBe('checked-out');
    expect(list[0].commitSha).toBe(gitlinkSha);
  });

  it('fresh clone（未 init）→ 条目 status=uninitialized 且带 gitlink sha', { timeout: 180_000 }, async () => {
    const { super: superRepo, gitlinkSha } = makeSubmoduleSuper();
    const clone = superRepo + '-clone';
    dirs.push(clone);
    git(superRepo, ['clone', '-q', superRepo, clone]);

    const list = await listSubmodules(clone);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('uninitialized');
    expect(list[0].commitSha).toBe(gitlinkSha);
  });

  it('有 .gitmodules 无 gitlink → 全量 uninitialized（无 commitSha）——status 空输出兜底', { timeout: 180_000 }, async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'g.txt'), 'g');
    git(repo, ['add', 'g.txt']);
    git(repo, ['commit', '-q', '-m', 'g']);
    writeFileSync(
      join(repo, '.gitmodules'),
      [
        '[submodule "MixedCase"]',
        '\tpath = sub/sub',
        '\turl = ./nowhere.git',
        '',
      ].join('\n'),
    );
    git(repo, ['add', '.gitmodules']);
    git(repo, ['commit', '-q', '-m', 'modules']);

    const list = await listSubmodules(repo);
    expect(list).toEqual([
      { name: 'MixedCase', path: 'sub/sub', url: './nowhere.git', status: 'uninitialized' },
    ]);
  });

  it('损坏 .gitmodules + gitlink → config 解析失败抛「子模块配置解析失败」（不静默空列表）', { timeout: 180_000 }, async () => {
    const { super: superRepo } = makeSubmoduleSuper();
    writeFileSync(join(superRepo, '.gitmodules'), 'this is not config');

    await expect(listSubmodules(superRepo)).rejects.toThrow(/子模块配置解析失败/);
  });

  it('parseSubmodulesConfig：名称含点/大小写保留/branch 可选/顺序保持', () => {
    const raw = [
      'submodule.a.b.path x/y',
      'submodule.a.b.url https://example.com/x.git',
      'submodule.SwItCh.url file:///z.git',
      'submodule.SwItCh.path sw',
      'submodule.SwItCh.branch dev',
      'submodule.Sub Dir.path Sub Dir',
      'submodule.Sub Dir.url u',
      'submodule.C.path c',
      'submodule.C.url u',
    ].join('\n');

    expect(parseSubmodulesConfig(raw)).toEqual([
      { name: 'a.b', path: 'x/y', url: 'https://example.com/x.git' },
      { name: 'SwItCh', url: 'file:///z.git', path: 'sw', branch: 'dev' },
      { name: 'Sub Dir', path: 'Sub Dir', url: 'u' },
      { name: 'C', path: 'c', url: 'u' },
    ]);
  });

  it('mergeSubmoduleStatuses：四态前缀映射；status 失败（null）→ 全量 uninitialized；无行 → uninitialized', () => {
    const entries: SubmoduleConfigEntry[] = [
      { name: 'ok', path: 'ok', url: 'u' },
      { name: 'ahead', path: 'ahead', url: 'u' },
      { name: 'gone', path: 'gone', url: 'u' },
      { name: 'conflicted', path: 'conflicted', url: 'u' },
      { name: 'missing-line', path: 'missing', url: 'u' },
    ];
    const raw = [
      ' 1111111111111111111111111111111111111111 ok (heads/master)',
      '+2222222222222222222222222222222222222222 ahead (2222222)',
      '-3333333333333333333333333333333333333333 gone',
      'U4444444444444444444444444444444444444444 conflicted',
    ].join('\n');

    const merged = mergeSubmoduleStatuses(entries, raw);
    expect(merged.map((e) => e.status)).toEqual([
      'checked-out',
      'different-commit',
      'uninitialized',
      'conflict',
      'uninitialized',
    ]);
    expect(merged[1].commitSha).toBe('2'.repeat(40));
    expect(merged[2].commitSha).toBe('3'.repeat(40));
    expect(merged[4].commitSha).toBeUndefined();

    const failed = mergeSubmoduleStatuses(entries, null);
    expect(failed.every((e) => e.status === 'uninitialized')).toBe(true);
    expect(failed.every((e) => e.commitSha === undefined)).toBe(true);
  });

  it('updateSubmodules recursive 对非嵌套仓库同样成功', { timeout: 180_000 }, async () => {
    const { super: superRepo } = makeSubmoduleSuper();
    await expect(updateSubmodules(superRepo, { recursive: true })).resolves.toBeUndefined();
  });
});
