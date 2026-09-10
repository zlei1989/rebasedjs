/**
 * submodule 原语：list（.gitmodules 配置 + `git submodule status` 四态映射）/ update。
 * 实测（git 2.47.0.windows.2）：
 * - status 未 init 的 gitlink 输出 `-<sha> path` 且退出码 0（非 128）——「不初始化」以
 *   前缀 `-` 判定而非退出码判定；仅有 .gitmodules 无 gitlink 时输出为空、退出码 0。
 * - `.gitmodules` 损坏时 status 与 config 均以退出码 128 失败——按控制器裁定：config 解析失败
 *   抛「子模块配置解析失败：<stderr 首行>」（诚实报错，GIT_ERROR 语义，不静默返回空列表）；
 *   config 正常而 status 失败（任意原因）→ 全量按 uninitialized（无 commitSha）。
 * - 子模块名在配置键 `submodule.<name>.path` 中逐字保留大小写（可含空格/点）。
 */
import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { GitExitError, runGit } from './exec';

export interface SubmoduleEntry {
  name: string;
  path: string;
  url: string;
  branch?: string;
  status: 'uninitialized' | 'checked-out' | 'different-commit' | 'conflict';
  commitSha?: string;
}

const CONFIG_KEYS_RE = '^submodule\\..*\\.(path|url|branch)$';

/** .gitmodules 解析出的半成品（status/commitSha 由 mergeSubmoduleStatuses 并入） */
export type SubmoduleConfigEntry = Omit<SubmoduleEntry, 'status'>;

/** status 前缀字符 → 四态（git 文档：空=已检出且匹配 index、+=非 index 检出、-=未 init、U=冲突） */
const STATUS_BY_CHAR: Record<string, SubmoduleEntry['status']> = {
  ' ': 'checked-out',
  '+': 'different-commit',
  '-': 'uninitialized',
  U: 'conflict',
};

/** 解析 `git config -f .gitmodules --get-regexp ...` 输出；
 *  行形如 `submodule.<name>.<key> <value>`——子模块名可含空格/点，键值分隔不能用
 *  首个空格（实测 `submodule.Sub Dir.path Sub Dir`）；
 *  贪婪 name 锚定到最后一个 `.<key> ` 分隔，逐字保留大小写；字段按出现顺序填 */
export function parseSubmodulesConfig(raw: string): SubmoduleConfigEntry[] {
  const byName = new Map<string, SubmoduleConfigEntry>();
  const order: string[] = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    const m = /^submodule\.(.+)\.(path|url|branch) (.*)$/.exec(line);
    if (m === null) continue;
    const name = m[1];
    let entry = byName.get(name);
    if (entry === undefined) {
      entry = { name, path: '', url: '' };
      byName.set(name, entry);
      order.push(name);
    }
    if (m[2] === 'path') entry.path = m[3];
    else if (m[2] === 'url') entry.url = m[3];
    else entry.branch = m[3];
  }
  return order.map((n) => byName.get(n)!);
}

/** 状态合并：statusRaw=null（`git submodule status` 失败）→ 全量 uninitialized 兜底；
 *  status 行按 path 关联；无对应行（如 .gitmodules 有声明但 index 无 gitlink）→ uninitialized */
export function mergeSubmoduleStatuses(
  entries: readonly SubmoduleConfigEntry[],
  statusRaw: string | null,
): SubmoduleEntry[] {
  if (statusRaw === null) return entries.map((e) => ({ ...e, status: 'uninitialized' }));
  const byPath = new Map<string, { ch: string; sha: string }>();
  for (const line of statusRaw.split('\n')) {
    const m = /^([ +\-U])([0-9a-f]{40})\s+(.*)$/.exec(line);
    if (m === null) continue;
    // 尾部 ` (...) ` 描述段（如 (heads/master)）非路径部分，剥离
    byPath.set(m[3].replace(/\s+\([^)]*\)$/, ''), { ch: m[1], sha: m[2] });
  }
  return entries.map((e) => {
    const hit = byPath.get(e.path);
    if (hit === undefined) return { ...e, status: 'uninitialized' };
    return { ...e, status: STATUS_BY_CHAR[hit.ch], commitSha: hit.sha };
  });
}

export async function listSubmodules(cwd: string): Promise<SubmoduleEntry[]> {
  if (!existsSync(join(cwd, '.gitmodules'))) return [];
  let configOut: string;
  try {
    const config = await runGit(['config', '-f', '.gitmodules', '--get-regexp', CONFIG_KEYS_RE], { cwd });
    configOut = config.stdout;
  } catch (e) {
    // 控制器裁定：config 解析失败（如 .gitmodules 损坏，exit 128）→ 诚实报错而非静默空列表；
    // 取 stderr 首个非空行（GitExitError；空 stderr 如空 .gitmodules exit 1 → 回落 e.message，P4-B 终审 M-new2）
    const firstLine =
      e instanceof GitExitError
        ? (e.stderr.trim().split('\n').find((l) => l !== '') ?? e.message)
        : e instanceof Error
          ? e.message
          : String(e);
    throw new Error(`子模块配置解析失败：${firstLine}`, { cause: e });
  }
  const entries = parseSubmodulesConfig(configOut);
  let statusRaw: string | null;
  try {
    const status = await runGit(['submodule', 'status'], { cwd });
    statusRaw = status.stdout;
  } catch {
    // config 已正常而 status 失败（退化状态；未 init 实为 `-` 前缀 exit 0，不触发）→
    // 全量按 uninitialized 兜底（见文件头）
    statusRaw = null;
  }
  return mergeSubmoduleStatuses(entries, statusRaw);
}

/** name → path：从 .gitmodules 精确（大小写敏感）匹配子模块名；未知 name 直接抛错，不把错误名传给 git。
 *  白名单硬化：path 必须解析在仓库根内（`.gitmodules` 声明 `../x` 类越界路径 → 拒绝——git submodule 只应作用于仓库内）。 */
async function resolveSubmodulePath(cwd: string, name: string): Promise<string> {
  const { stdout } = await runGit(['config', '-f', '.gitmodules', '--get-regexp', CONFIG_KEYS_RE], { cwd });
  const entry = parseSubmodulesConfig(stdout).find((e) => e.name === name);
  if (entry === undefined) throw new Error(`updateSubmodules: 未知子模块名 ${name}`);
  const root = resolve(cwd);
  const target = resolve(join(root, entry.path));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`updateSubmodules: 子模块路径越界 ${name}（${entry.path}）`);
  }
  return entry.path;
}

export async function updateSubmodules(
  cwd: string,
  opts: { name?: string; recursive?: boolean } = {},
): Promise<void> {
  const args = ['submodule', 'update', '--init'];
  if (opts.recursive === true) args.push('--recursive');
  if (opts.name !== undefined) args.push('--', await resolveSubmodulePath(cwd, opts.name));
  await runGit(args, { cwd });
}
