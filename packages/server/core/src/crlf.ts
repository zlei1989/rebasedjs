/**
 * CRLF 提示原语（GitCrlfProblemsDetector + GitCrlfUtil 语义）：
 * 仅 Windows：core.autocrlf 未设为建议值（true/input）、且即将提交（已暂存）文件工作区内容含 CRLF、
 * 且相关文件无 text/crlf gitattribute 显式覆盖 → 提醒（这些 CRLF 将原样入库且非有意为之）。
 * 修复：git config --global core.autocrlf <建议值>（Windows true / 其余 input；GitCrlfUtil 同值）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './exec';

export interface CoreCrlfWarning {
  warning: boolean;
  files: string[];
}

/** 建议值（GitCrlfUtil.RECOMMENDED_VALUE：Windows true，其余 input） */
export function suggestedAutocrlfValue(): 'true' | 'input' {
  return process.platform === 'win32' ? 'true' : 'input';
}

/** check-attr 输出行 → 显式设置（value !== 'unspecified' 即有意/强制——不提示该文件）时返回路径；否则 null */
function attributedPath(line: string): string | null {
  const m = line.match(/^(.*): (text|crlf): (\S+)$/);
  return m !== null && m[3] !== 'unspecified' ? m[1] : null;
}

/** 已暂存文件是否含 CRLF（工作区内容——Java 读 VirtualFile；读取失败按无 CRLF 保守处理） */
function containsCrlf(cwd: string, file: string): boolean {
  try {
    return readFileSync(join(cwd, file)).includes('\r\n');
  } catch {
    return false;
  }
}

/**
 * CRLF 提示检测：详见文件头；任何子检查失败（config 无值、文件不可读等）按不提示处理（Java 同款 fail gracefully）。
 * 返回 warning=true 时 files 为涉事文件相对路径（提示语展示用）。
 */
export async function detectCrlfWarning(cwd: string): Promise<CoreCrlfWarning> {
  if (process.platform !== 'win32') return { warning: false, files: [] };
  let autocrlf = '';
  try {
    const { stdout } = await runGit(['config', '--get', 'core.autocrlf'], { cwd });
    autocrlf = stdout.trim();
  } catch {
    // 未配置（git config --get 无值 exit 1）→ 视同未建议配置
  }
  if (autocrlf === 'true' || autocrlf === 'input') return { warning: false, files: [] };
  const { stdout } = await runGit(['diff', '--cached', '--name-only', '--diff-filter=ACM'], { cwd });
  const files = stdout
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const crlfFiles = files.filter((f) => containsCrlf(cwd, f));
  if (crlfFiles.length === 0) return { warning: false, files: [] };
  const { stdout: attrOut } = await runGit(['check-attr', 'text', 'crlf', '--', ...crlfFiles], { cwd });
  const attributedPaths = new Set<string>();
  for (const line of attrOut.split('\n')) {
    if (line === '') continue;
    const path = attributedPath(line);
    if (path !== null) attributedPaths.add(path);
  }
  const warned = crlfFiles.filter((f) => !attributedPaths.has(f));
  return { warning: warned.length > 0, files: warned };
}

/** 修复：git config --global core.autocrlf <建议值>（GitCrlfDialog 的「修复并提交」步；cwd 仅为 runGit 执行环境） */
export async function setGlobalAutocrlf(cwd: string): Promise<void> {
  await runGit(['config', '--global', 'core.autocrlf', suggestedAutocrlfValue()], { cwd });
}
