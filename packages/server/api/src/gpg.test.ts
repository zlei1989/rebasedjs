/** GPG 签名配置功能测试：视图（启用态+密钥+可用列表）、写入（两键同步语义）、enabled 无 key 拒绝。 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getGpgSettings, setGpgSettings } from './gpg';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];

function makeRepo(): string {
  const repo = createTmpRepo();
  dirs.push(repo);
  return repo;
}

function track(dir: string): string {
  dirs.push(dir);
  return dir;
}

function git(repo: string, args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

const KEY_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** 字段数组 → colons 行（sec 字段 4=KeyID、11=capabilities；uid 字段 9=User-ID） */
function secLine(keyId: string, capabilities: string): string {
  const f = new Array(14).fill('');
  f[0] = 'sec';
  f[4] = keyId;
  f[11] = capabilities;
  return f.join(':');
}

function uidLine(description: string): string {
  const f = new Array(12).fill('');
  f[0] = 'uid';
  f[9] = description;
  return f.join(':');
}

/** node shim 作为 gpg.program：输出固定 colons 文本 */
function installGpgShim(repo: string, text: string): void {
  const dir = track(createTmpDir('rebased-api-gpg-'));
  const shim = join(dir, 'gpg-shim.mjs');
  writeFileSync(shim, `console.log(${JSON.stringify(text)});`, 'utf8');
  const program = `"${process.execPath}" "${shim}"`;
  git(repo, ['config', '--local', 'gpg.program', program]);
}

afterAll(() => dirs.forEach(cleanupTmpRepo));

describe('getGpgSettings（GitGpgConfigDialog 语义：视图）', () => {
  it('未配置且 gpg 不可用 → { enabled:false, key:null, keys:[] }', async () => {
    const repo = makeRepo();
    git(repo, ['config', '--local', 'gpg.program', 'Z:\\no-such-dir\\gpg.exe']);

    expect(await getGpgSettings(repo)).toEqual({ enabled: false, key: null, keys: [] });
  });

  it('已启用 + 密钥 → enabled/key 生效值；可用密钥列表来自 gpg 输出', async () => {
    const repo = makeRepo();
    installGpgShim(repo, `${secLine(KEY_A, 'scSC')}\n${uidLine('Test User <test@example.com>')}`);
    git(repo, ['config', '--local', 'commit.gpgsign', 'true']);
    git(repo, ['config', '--local', 'user.signingkey', KEY_A]);

    const view = await getGpgSettings(repo);
    expect(view.enabled).toBe(true);
    expect(view.key).toBe(KEY_A);
    expect(view.keys).toEqual([{ id: KEY_A, description: 'Test User <test@example.com>' }]);
  });
});

describe('setGpgSettings（写 commit.gpgsign/user.signingkey）', () => {
  it('enabled=true + key → 仓库级写两键，返回刷新视图', async () => {
    const repo = makeRepo();
    installGpgShim(repo, `${secLine(KEY_A, 'scSC')}`);

    const view = await setGpgSettings(repo, { enabled: true, key: KEY_A });

    expect(view.enabled).toBe(true);
    expect(view.key).toBe(KEY_A);
    expect(git(repo, ['config', '--local', '--get', 'commit.gpgsign']).trim()).toBe('true');
    expect(git(repo, ['config', '--local', '--get', 'user.signingkey']).trim()).toBe(KEY_A);
  });

  it('enabled=false → 仅写 commit.gpgsign=false（user.signingkey 保留），返回视图', async () => {
    const repo = makeRepo();
    installGpgShim(repo, `${secLine(KEY_A, 'scSC')}`);
    await setGpgSettings(repo, { enabled: true, key: KEY_A });

    const view = await setGpgSettings(repo, { enabled: false });

    expect(view.enabled).toBe(false);
    expect(view.key).toBe(KEY_A);
    expect(git(repo, ['config', '--local', '--get', 'commit.gpgsign']).trim()).toBe('false');
  });

  it('enabled=true 无 key → INVALID_QUERY（schema refine + 本层预检双保险）', async () => {
    const repo = makeRepo();

    await expect(setGpgSettings(repo, { enabled: true })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
      message: '启用提交签名必须选择密钥',
    });
  });
});
