/** submodule 服务集成测试（真实 git；本地 file URL 夹具同 T2 core 先例，见 task-2-report）。
 *  性能：submodule rig（super + content + bare，~14 次 git spawn）在 beforeAll 各建一次模板，
 *  用例复制三目录并以文本替换修正 url 引用（0 spawn；历史每 rig 12-15 spawn）。 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSubmodules, updateSubmodules } from './submodule';
import { instantiateFixture } from './testing/fixture';
import { cleanupTmpRepo, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

/** 复制模板为独立夹具并入册（afterAll 统一清理） */
function instantiate(template: string): string {
  const repo = instantiateFixture(template);
  dirs.push(repo);
  return repo;
}

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
  path: string;
} {
  const content = createTmpRepo();
  writeFileSync(join(content, 'c.txt'), 'c1');
  git(content, ['add', 'c.txt']);
  git(content, ['commit', '-q', '-m', 'A']);
  const aSha = git(content, ['rev-parse', 'HEAD']);
  writeFileSync(join(content, 'c.txt'), 'c2');
  git(content, ['commit', '-q', '-am', 'B']);
  const bSha = git(content, ['rev-parse', 'HEAD']);
  if (opts.branch !== undefined) git(content, ['branch', opts.branch]);
  const bare = content + '.git';
  git(content, ['clone', '--bare', '-q', '.', bare]);
  const bareUrl = bare.replace(/\\/g, '/');
  const subPath = opts.path ?? 'sub';
  const superRepo = createTmpRepo();
  writeFileSync(join(superRepo, 's.txt'), 's');
  git(superRepo, ['add', 's.txt']);
  git(superRepo, ['commit', '-q', '-m', 's1']);
  const addArgs = ['-C', superRepo, '-c', 'protocol.file.allow=always', 'submodule', 'add'];
  if (opts.branch !== undefined) addArgs.push('-b', opts.branch);
  execFileSync('git', [...addArgs, bareUrl, subPath], { encoding: 'utf8' });
  git(superRepo, ['add', '-A']);
  git(superRepo, ['commit', '-q', '-m', 'addsub']);
  const gitlinkSha = git(superRepo, ['rev-parse', `HEAD:${subPath}`]);
  return { super: superRepo, content, bareUrl, aSha, bSha, gitlinkSha, path: subPath };
}

type Rig = ReturnType<typeof makeSubmoduleSuper>;

// ---- rig 模板：beforeAll 各建一次；templateDirs 文件级 afterAll 清理 ----
const templateDirs: string[] = [];
afterAll(() => templateDirs.forEach(cleanupTmpRepo));

let defaultRig: Rig | null = null;
let spacePathRig: Rig | null = null;

beforeAll(() => {
  defaultRig = makeSubmoduleSuper();
  spacePathRig = makeSubmoduleSuper({ path: 'Sub Dir' });
  templateDirs.push(
    defaultRig.super,
    defaultRig.content,
    defaultRig.bareUrl.replace(/\//g, '\\'),
    spacePathRig.super,
    spacePathRig.content,
    spacePathRig.bareUrl.replace(/\//g, '\\'),
  );
});

/** 复制 rig：super/content/bare 各复制一份，文本替换 .gitmodules 与 modules config 中的裸仓库路径（0 spawn）。
 *  submodule add 以正斜杠 URL 写入两个文件（gitconfig 对正斜杠不转义），按 tpl.bareUrl 原样替换。 */
function instantiateRig(tpl: Rig): Rig {
  const superRepo = instantiate(tpl.super);
  const content = instantiate(tpl.content);
  const bare = instantiate(tpl.bareUrl.replace(/\//g, '\\'));
  const bareUrl = bare.replace(/\\/g, '/');
  const gitmodulesPath = join(superRepo, '.gitmodules');
  writeFileSync(gitmodulesPath, readFileSync(gitmodulesPath, 'utf8').split(tpl.bareUrl).join(bareUrl));
  const moduleConfig = join(superRepo, '.git', 'modules', tpl.path, 'config');
  writeFileSync(moduleConfig, readFileSync(moduleConfig, 'utf8').split(tpl.bareUrl).join(bareUrl));
  return { ...tpl, super: superRepo, content, bareUrl };
}

describe('submodule 服务', () => {
  afterAll(() => dirs.forEach(cleanupTmpRepo));

  it('getSubmodules 无 .gitmodules → 空列表', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'f.txt'), 'f');
    git(repo, ['add', 'f.txt']);
    git(repo, ['commit', '-q', '-m', 'f']);

    expect(await getSubmodules(repo)).toEqual({ submodules: [] });
  });

  // fixture 每次约 12-15 次 git 子进程（submodule add 克隆 + 多次 status）——
  // 与全量套件并行时超 vitest 默认 60s，放宽到 180s（串行运行该文件，实测见 task-2-report）
  it('checked-out 往返：改检出 → different-commit → update 复原（CLI 复核）', { timeout: 180_000 }, async () => {
    const { super: superRepo, aSha, bSha, gitlinkSha } = instantiateRig(defaultRig!);

    // 初始：submodule add 后即 checked-out（status 前缀空格，commitSha=gitlink sha）
    let list = await getSubmodules(superRepo);
    expect(list.submodules).toHaveLength(1);
    const first = list.submodules[0];
    expect(first.name).toBe('sub');
    expect(first.path).toBe('sub');
    expect(first.url).toBe(git(superRepo, ['config', '-f', '.gitmodules', '--get', 'submodule.sub.url']));
    expect(first.branch).toBeUndefined();
    expect(first.status).toBe('checked-out');
    expect(first.commitSha).toBe(gitlinkSha);
    expect(gitlinkSha).toBe(bSha);

    // 子模块工作树检出旧提交 A → different-commit
    git(join(superRepo, 'sub'), ['checkout', '-q', aSha]);
    list = await getSubmodules(superRepo);
    const second = list.submodules[0];
    expect(second.status).toBe('different-commit');
    expect(second.commitSha).toBe(aSha);

    // update --init 无网络（对象在本仓库）→ 复原 checked-out；CLI 复核实际检出
    list = await updateSubmodules(superRepo, {});
    expect(list.submodules[0].status).toBe('checked-out');
    expect(list.submodules[0].commitSha).toBe(gitlinkSha);
    expect(git(join(superRepo, 'sub'), ['rev-parse', 'HEAD'])).toBe(bSha);
  });

  it('updateSubmodules name 限定（含空格路径）与 fresh clone 未 init 状态', { timeout: 180_000 }, async () => {
    const { super: superRepo, aSha, gitlinkSha } = instantiateRig(spacePathRig!);

    let list = await getSubmodules(superRepo);
    expect(list.submodules[0].name).toBe('Sub Dir'); // .gitmodules 实际子模块名（含空格）逐字保留
    expect(list.submodules[0].path).toBe('Sub Dir');
    expect(list.submodules[0].status).toBe('checked-out');

    git(join(superRepo, 'Sub Dir'), ['checkout', '-q', aSha]);
    list = await updateSubmodules(superRepo, { name: 'Sub Dir', recursive: true });
    expect(list.submodules[0].status).toBe('checked-out');
    expect(list.submodules[0].commitSha).toBe(gitlinkSha);

    // fresh clone（未 init）→ 条目 status=uninitialized 且带 gitlink sha
    const clone = superRepo + '-clone';
    dirs.push(clone);
    git(superRepo, ['clone', '-q', superRepo, clone]);
    const cloned = await getSubmodules(clone);
    expect(cloned.submodules).toHaveLength(1);
    expect(cloned.submodules[0].status).toBe('uninitialized');
    expect(cloned.submodules[0].commitSha).toBe(gitlinkSha);
  });

  it('损坏 .gitmodules → GIT_ERROR「子模块配置解析失败」（不静默空列表）', { timeout: 180_000 }, async () => {
    const { super: superRepo } = instantiateRig(defaultRig!);
    writeFileSync(join(superRepo, '.gitmodules'), 'this is not config');

    await expect(getSubmodules(superRepo)).rejects.toMatchObject({
      code: 'GIT_ERROR',
      message: expect.stringMatching(/^子模块配置解析失败：/),
    });
  });
});
