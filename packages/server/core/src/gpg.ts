/**
 * gpg 原语（GitGpgConfigDialog 语义）：可用签名密钥列举 + GPG 提交签名配置读写。
 *  gpg 程序取自 `git config --get gpg.program`（生效值），未配置 → 'gpg'（Java GitConfigUtil.GPG_PROGRAM 同口径）；
 *  程序串经自研分词（空白分隔 + 双/单引号去引号，对齐 Java ParametersListUtil）后直接 exec（不经 shell——防注入）。
 *  gpg 缺失/退出非零/超时 → 空列表（对话框呈现"未找到可用密钥"）。
 */
import { execFile } from 'node:child_process';
import { getGitConfigEntries, setGitConfigLocal } from './config';

export interface GpgSecretKey {
  id: string;
  description: string | null;
}

/** gpg.program 值分词（ParametersListUtil.parse 语义近似：空白分隔；双/单引号仅去引号，不支持转义） */
export function parseGpgCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  for (const ch of command) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === '\'') {
      quote = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current !== '') {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current !== '') tokens.push(current);
  return tokens;
}

/** 执行 gpg 程序（分词后无 shell 直执行，固定参数防交互），返回 stdout */
function runGpg(program: string): Promise<string> {
  const tokens = parseGpgCommand(program);
  if (tokens.length === 0) return Promise.reject(new Error('gpg.program 不可用'));
  return new Promise((resolve, reject) => {
    execFile(
      tokens[0],
      [
        ...tokens.slice(1),
        '--list-secret-keys',
        '--with-colons',
        '--fixed-list-mode',
        '--batch',
        '--no-tty',
      ],
      {
        windowsHide: true,
        timeout: 8000,
        encoding: 'utf8',
      },
      (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      },
    );
  });
}

/**
 * 解析 gpg --list-secret-keys --with-colons 输出（GitGpgConfigUtils.parseSecretKeys 语义）：
 * sec 记录取字段 5（KeyID）与字段 11（capabilities）：含 s/S（可签名）且不含 D（未禁用）→ 入列；
 * 其后第一个 uid 记录的字段 10（User-ID）作为该密钥描述（多个 uid 仅取首个，对齐 Java）。
 */
export function parseSecretKeyLines(output: string): GpgSecretKey[] {
  const keys: GpgSecretKey[] = [];
  let last: GpgSecretKey | null = null;
  for (const line of output.split(/\r?\n/)) {
    const fields = line.split(':');
    const type = fields[0];
    if (type === 'sec') {
      const keyId = fields[4];
      const capabilities = fields[11];
      // 可签名判定对齐 Java checkKeyCapabilities：capabilities 含 s/S 且不含 D（禁用）
      if (
        keyId !== undefined &&
        capabilities !== undefined &&
        (capabilities.includes('s') || capabilities.includes('S')) &&
        !capabilities.includes('D')
      ) {
        last = { id: keyId, description: null };
        keys.push(last);
      } else {
        last = null;
      }
    } else if (type === 'uid') {
      const userId = fields[9];
      if (userId !== undefined && last !== null) {
        last.description = userId;
      }
      last = null;
    }
  }
  return keys;
}

/** gpg 程序路径：gpg.program 生效值（未设置 → 'gpg'） */
async function resolveGpgProgram(cwd: string): Promise<string> {
  const [{ value }] = await getGitConfigEntries(cwd, ['gpg.program']);
  return value ?? 'gpg';
}

/** 可用签名密钥列表：gpg 缺失/失败 → 空列表（不抛——对话框语义为"无可用密钥"而非错误） */
export async function listSecretGpgKeys(cwd: string): Promise<GpgSecretKey[]> {
  const program = await resolveGpgProgram(cwd);
  const output = await runGpg(program).catch(() => null);
  if (output === null) return [];
  return parseSecretKeyLines(output);
}

/** GPG 提交签名配置：enabled=commit.gpgsign 生效为 'true'；key=user.signingkey 生效值（未设置为 null） */
export async function getGpgCommitConfig(cwd: string): Promise<{ enabled: boolean; key: string | null }> {
  const entries = await getGitConfigEntries(cwd, ['commit.gpgsign', 'user.signingkey']);
  const sign = entries.find((e) => e.key === 'commit.gpgsign')?.value;
  const key = entries.find((e) => e.key === 'user.signingkey')?.value;
  return { enabled: sign === 'true', key: key === undefined ? null : key };
}

/**
 * 写 GPG 提交签名配置（GitGpgConfigUtils.writeGitGpgConfig 语义，仓库级 local）：
 * enabled → commit.gpgsign=true + user.signingkey=<key>；disabled → commit.gpgsign=false（user.signingkey 保留不清）。
 */
export async function setGpgCommitConfig(
  cwd: string,
  body: { enabled: boolean; key: string | null },
): Promise<{ enabled: boolean; key: string | null }> {
  if (body.enabled) {
    if (body.key === null) throw new Error('启用提交签名必须选择密钥');
    await setGitConfigLocal(cwd, 'commit.gpgsign', 'true');
    await setGitConfigLocal(cwd, 'user.signingkey', body.key);
  } else {
    await setGitConfigLocal(cwd, 'commit.gpgsign', 'false');
  }
  return getGpgCommitConfig(cwd);
}
