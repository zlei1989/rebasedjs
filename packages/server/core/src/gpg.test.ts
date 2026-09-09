/** gpg 原语测试：密钥列解析（--with-colons）、gpg 缺失/失败 → 空列表、GPG 提交签名配置读写。 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getGpgCommitConfig, listSecretGpgKeys, parseGpgCommand, parseSecretKeyLines, setGpgCommitConfig } from './gpg';
import { runGit } from './exec';
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

const KEY_A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const KEY_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

/** 字段数组 → colons 行（显式字段索引：sec 字段 4=KeyID、11=capabilities；uid 字段 9=User-ID） */
function secLine(keyId: string, capabilities: string): string {
  const f = new Array(14).fill('');
  f[0] = 'sec';
  f[2] = 'u';
  f[4] = keyId;
  f[11] = capabilities;
  return f.join(':');
}

function uidLine(description: string): string {
  const f = new Array(12).fill('');
  f[0] = 'uid';
  f[2] = 'u';
  f[9] = description;
  return f.join(':');
}

/** node shim：gpg.program 指向 `"<node>" "<shim>"`（shell 分词），shim 打印固定 colons 文本 */
function makeGpgShim(text: string): string {
  const dir = track(createTmpDir('rebased-core-gpg-'));
  const shim = join(dir, 'gpg-shim.mjs');
  writeFileSync(shim, `console.log(${JSON.stringify(text)});`, 'utf8');
  return shim;
}

function makeShimProgram(shim: string): string {
  return `"${process.execPath}" "${shim}"`;
}

afterEach(() => {
  dirs.forEach(cleanupTmpRepo);
});

describe('parseGpgCommand（gpg.program 值分词，ParametersListUtil 语义近似）', () => {
  it('空白分隔 + 双引号路径去引号', () => {
    expect(parseGpgCommand('"C:\\Program Files\\Git\\gpg.exe" --arg1')).toEqual([
      'C:\\Program Files\\Git\\gpg.exe',
      '--arg1',
    ]);
  });

  it('单引号去引号；连续空白与首尾空白忽略；空串 → 空数组', () => {
    expect(parseGpgCommand('  \'gpg\'   --fixed-list-mode  ')).toEqual(['gpg', '--fixed-list-mode']);
    expect(parseGpgCommand('')).toEqual([]);
  });
});

describe('parseSecretKeyLines（GitGpgConfigUtils.parseSecretKeys 语义）', () => {
  it('sec（可签名）→ 收集 KeyID；其后 uid → 该密钥描述', () => {
    const keys = parseSecretKeyLines(`${secLine(KEY_A, 'scSC')}\n${uidLine('Test User <test@example.com>')}\n`);
    expect(keys).toEqual([{ id: KEY_A, description: 'Test User <test@example.com>' }]);
  });

  it('capabilities 含 D（禁用）或无 s/S（不可签名）→ 跳过；uid 无前置 sec → 忽略', () => {
    const keys = parseSecretKeyLines(
      `${secLine(KEY_A, 'DscSC')}\n${secLine(KEY_B, 'eU')}\n${uidLine('no key')}\n`,
    );
    expect(keys).toEqual([]);
  });

  it('多密钥：每 sec 独立入列，随后 uid 只挂接最近一条后复位', () => {
    const keys = parseSecretKeyLines(`${secLine(KEY_A, 'scSC')}\n${uidLine('User A')}\n${secLine(KEY_B, 's')}\n`);
    expect(keys).toEqual([
      { id: KEY_A, description: 'User A' },
      { id: KEY_B, description: null },
    ]);
  });
});

describe('listSecretGpgKeys（gpg 程序解析 + 执行）', () => {
  it('gpg.program 指向不存在路径 → 空列表（不抛）', async () => {
    const repo = makeRepo();
    await runGit(['config', '--local', 'gpg.program', 'Z:\\no-such-dir\\gpg.exe'], { cwd: repo });
    expect(await listSecretGpgKeys(repo)).toEqual([]);
  });

  it('gpg.program = node shim（shell 分词）→ 解析出密钥列表', async () => {
    const repo = makeRepo();
    const shim = makeGpgShim(`${secLine(KEY_A, 'scSC')}\n${uidLine('Test User <test@example.com>')}`);
    await runGit(['config', '--local', 'gpg.program', makeShimProgram(shim)], { cwd: repo });

    expect(await listSecretGpgKeys(repo)).toEqual([{ id: KEY_A, description: 'Test User <test@example.com>' }]);
  });
});

describe('setGpgCommitConfig / getGpgCommitConfig（GitGpgConfigUtils 语义）', () => {
  it('未配置 → { enabled:false, key:null }', async () => {
    const repo = makeRepo();
    expect(await getGpgCommitConfig(repo)).toEqual({ enabled: false, key: null });
  });

  it('enabled+key → 写 commit.gpgsign=true + user.signingkey（仓库级 local）并读回', async () => {
    const repo = makeRepo();
    await setGpgCommitConfig(repo, { enabled: true, key: KEY_A });
    expect(await getGpgCommitConfig(repo)).toEqual({ enabled: true, key: KEY_A });
    expect((await runGit(['config', '--local', '--get', 'commit.gpgsign'], { cwd: repo })).stdout.trim()).toBe('true');
    expect((await runGit(['config', '--local', '--get', 'user.signingkey'], { cwd: repo })).stdout.trim()).toBe(KEY_A);
  });

  it('disabled → 写 commit.gpgsign=false 且 user.signingkey 保留（Java 不清键）', async () => {
    const repo = makeRepo();
    await setGpgCommitConfig(repo, { enabled: true, key: KEY_A });
    await setGpgCommitConfig(repo, { enabled: false, key: null });
    expect(await getGpgCommitConfig(repo)).toEqual({ enabled: false, key: KEY_A });
  });

  it('enabled 无 key → 拒绝（防御校验）', async () => {
    const repo = makeRepo();
    await expect(setGpgCommitConfig(repo, { enabled: true, key: null })).rejects.toThrow('必须选择密钥');
  });
});
