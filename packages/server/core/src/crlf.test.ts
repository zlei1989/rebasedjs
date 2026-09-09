/** CRLF 提示原语测试：detectCrlfWarning 检测矩阵 + setGlobalAutocrlf 写入（GIT_CONFIG_GLOBAL 隔离到临时文件——绝不触碰真实全局配置）。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectCrlfWarning, setGlobalAutocrlf, suggestedAutocrlfValue } from './crlf';
import { cleanupTmpRepo, createTmpDir, createTmpRepo } from './testing/tmp-repo';

const dirs: string[] = [];
let globalConfig = '';

beforeAll(() => {
  // 隔离：git config --global 读写指向临时文件（GitCrlfUtil 语义写全局；测试绝不触碰真实 ~/.gitconfig）
  globalConfig = createTmpDir('rebased-crlf-global-');
  process.env.GIT_CONFIG_GLOBAL = join(globalConfig, '.gitconfig');
  dirs.push(globalConfig);
});

afterAll(() => dirs.forEach(cleanupTmpRepo));

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/** 提交一文件并暂存另一 CRLF 文件（未入库）；core.autocrlf 本地置 false——
 *  本机系统 gitconfig 可能默认 true（Git for Windows），覆盖成未建议值以走检测主路径 */
function makeStagedCrlf(repo: string, file: string, content: string): void {
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['-C', repo, 'add', 'base.txt']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);
  execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', 'false']);
  writeFileSync(join(repo, file), content);
  execFileSync('git', ['-C', repo, 'add', file]);
}

describe('detectCrlfWarning（GitCrlfProblemsDetector 语义）', () => {
  it('暂存 CRLF 文件且无 text/crlf 属性覆盖 → warning true 且 files 列涉事文件', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeStagedCrlf(repo, 'a.txt', 'line1\r\nline2\r\n');

    const w = await detectCrlfWarning(repo);

    expect(w.warning).toBe(true);
    expect(w.files).toEqual(['a.txt']);
  });

  it('core.autocrlf 已建议（true/input）→ 不提示', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeStagedCrlf(repo, 'a.txt', 'line1\r\n');
    execFileSync('git', ['-C', repo, 'config', 'core.autocrlf', 'true']);

    expect(await detectCrlfWarning(repo)).toEqual({ warning: false, files: [] });
  });

  it('gitattributes 显式 text 属性 → 不提示（有意/强制转换）', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeStagedCrlf(repo, 'a.txt', 'line1\r\n');
    // .gitattributes 本身须 LF（CRLF 的 .gitattributes 会按自身规则被提示——语义正确，夹具避免之）
    writeFileSync(join(repo, '.gitattributes'), 'a.txt text\n');
    execFileSync('git', ['-C', repo, 'add', '.gitattributes']);

    expect(await detectCrlfWarning(repo)).toEqual({ warning: false, files: [] });
  });

  it('文件为 LF（无 CRLF）→ 不提示；混入 CRLF 文件时仅列 CRLF 文件', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    makeStagedCrlf(repo, 'a.txt', 'line1\r\n');
    writeFileSync(join(repo, 'b.txt'), 'line1\n');
    execFileSync('git', ['-C', repo, 'add', 'b.txt']);

    const w = await detectCrlfWarning(repo);

    expect(w.warning).toBe(true);
    expect(w.files).toEqual(['a.txt']);
  });

  it('暂存区为空 → 不提示', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    writeFileSync(join(repo, 'a.txt'), 'x\n');
    execFileSync('git', ['-C', repo, 'add', 'a.txt']);
    execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);

    expect(await detectCrlfWarning(repo)).toEqual({ warning: false, files: [] });
  });
});

describe('setGlobalAutocrlf', () => {
  it('写入建议值（Windows true / 其余 input）且 --global 生效', async () => {
    const repo = createTmpRepo();
    dirs.push(repo);
    await setGlobalAutocrlf(repo);

    const expected = suggestedAutocrlfValue();
    const out = execFileSync('git', ['config', '--global', '--get', 'core.autocrlf'], { encoding: 'utf8' }).trim();
    expect(out).toBe(expected);
  });
});
