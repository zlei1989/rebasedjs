/**
 * shelf 功能：工作区快照归档（configDir/shelves/<repoId>/<name>/）——
 * tracked 部分存为 patch.diff（git diff HEAD，工作区+暂存全量），未跟踪文件递归复制到 untracked/；
 * 保存不清理工作区；restore 回放 tracked 变更并回拷未跟踪文件（存在且不同 → 保留用户版本）。
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { getStatus, runGit } from '@rebased/core';
import { ServiceError, type ShelfAction, type ShelfEntry, type ShelfList } from '@rebased/contracts';
import type { AppConfig } from './lib/config-store';
import { getConfigDir, loadConfig } from './lib/config-store';
import { applyPatchText, readPatchText } from './patch';

/** repoPath → repoId：经 config.repos 注册表反查（沿 changelist 先例）；未注册 → REPO_NOT_FOUND（防御） */
function repoIdOf(config: AppConfig, repoPath: string): string {
  const repo = config.repos.find((r) => r.path === repoPath);
  if (!repo) {
    throw new ServiceError('REPO_NOT_FOUND', `仓库不存在或未打开：${repoPath}`, { context: { path: repoPath } });
  }
  return repo.id;
}

/** shelf 根目录：<configDir>/shelves/<repoId>/ */
function shelvesDirOf(repoPath: string): string {
  return join(getConfigDir(), 'shelves', repoIdOf(loadConfig(), repoPath));
}

/** name → shelf 目录；restore/drop 的 name 未限制正则，路径逃逸一律按不存在处理 */
function shelfDirOf(repoPath: string, name: string): string {
  const base = resolve(shelvesDirOf(repoPath));
  const dir = resolve(join(base, name));
  if (!dir.startsWith(base + sep)) throw new ServiceError('INVALID_REF', `搁置不存在：${name}`);
  return dir;
}

/** 递归统计未跟踪文件数（untrackedCount 口径：文件个数） */
function countFiles(node: string): number {
  if (!existsSync(node)) return 0;
  let n = 0;
  for (const d of readdirSync(node, { withFileTypes: true })) {
    const p = join(node, d.name);
    n += d.isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

/** shelf 根目录列表：仅子目录，按名称排序（createdAtIso 取目录 mtime） */
function listShelves(dir: string): ShelfEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      name: d.name,
      createdAtIso: statSync(join(dir, d.name)).mtime.toISOString(),
      untrackedCount: countFiles(join(dir, d.name, 'untracked')),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * save：diff HEAD 写 patch.diff；未跟踪（?? 项，未跟踪目录折叠为 dir/）递归复制，跳过 .git。
 * 折叠目录整树复制：目录内被忽略文件也会随档（与逐文件收集的差异），v1 接受；目录层级深。
 */
async function saveShelf(repoPath: string, name: string): Promise<void> {
  const dir = shelfDirOf(repoPath, name);
  if (existsSync(dir)) throw new ServiceError('INVALID_QUERY', `搁置已存在：${name}`);

  const { stdout: diff } = await runGit(['diff', '--no-ext-diff', 'HEAD'], { cwd: repoPath });
  const status = await getStatus(repoPath);
  const untracked = status.entries.filter((e) => e.code === '??').map((e) => e.path);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'patch.diff'), diff, 'utf8');
  for (const rel of untracked) {
    const dest = join(dir, 'untracked', rel);
    mkdirSync(dirname(dest), { recursive: true });
    // cpSync 按普通文件复制：符号链接往返降级为常规文件（链接位不保真），v1 接受
    cpSync(join(repoPath, rel), dest, {
      recursive: true,
      filter: (p) => !p.split(sep).includes('.git'),
    });
  }
}

/** 未跟踪文件子目录递归清单（相对路径） */
function walkFiles(node: string): string[] {
  const out: string[] = [];
  for (const d of readdirSync(node, { withFileTypes: true })) {
    const p = join(node, d.name);
    if (d.isDirectory()) {
      for (const sub of walkFiles(p)) out.push(join(d.name, sub));
    } else {
      out.push(d.name);
    }
  }
  return out;
}

/** 内容是否相同（大小先判，避免大文件全读） */
function sameFile(a: string, b: string): boolean {
  if (statSync(a).size !== statSync(b).size) return false;
  return readFileSync(a).equals(readFileSync(b));
}

/**
 * 未跟踪文件回拷策略（控制器裁定）：目标不存在 → 复制；存在且内容相同 → 跳过（幂等）；
 * 存在且内容不同 → 跳过不覆盖（不破坏用户工作区数据）。
 */
function copyBackUntracked(shelfUntracked: string, repoPath: string): void {
  if (!existsSync(shelfUntracked)) return;
  for (const rel of walkFiles(shelfUntracked)) {
    const src = join(shelfUntracked, rel);
    const target = join(repoPath, rel);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(src, target);
    } else if (!sameFile(src, target)) {
      // 跳过：保留用户版本
    }
  }
}

/**
 * restore：apply patch.diff（check 先行，失败映射同 patch apply）→ untracked/ 回拷；shelf 本身保留。
 * 纯未跟踪 shelf 的 patch.diff 为 0 字节（git diff HEAD 无 tracked 变更），空输入 git apply 会以
 * exit 128「No valid patches in input」失败——此时跳过 apply（无可应用变更），仅回拷未跟踪文件。
 */
async function restoreShelf(repoPath: string, name: string): Promise<void> {
  const dir = shelfDirOf(repoPath, name);
  if (!existsSync(dir)) throw new ServiceError('INVALID_REF', `搁置不存在：${name}`);
  const patchFile = join(dir, 'patch.diff');
  if (!existsSync(patchFile)) throw new ServiceError('INVALID_REF', `搁置不存在：${name}`);
  const patch = readFileSync(patchFile, 'utf8');
  if (patch.trim().length > 0) {
    await applyPatchText(repoPath, patch);
  }
  copyBackUntracked(join(dir, 'untracked'), repoPath);
}

/** drop：删除 shelf 目录 */
async function dropShelf(repoPath: string, name: string): Promise<void> {
  const dir = shelfDirOf(repoPath, name);
  if (!existsSync(dir)) throw new ServiceError('INVALID_REF', `搁置不存在：${name}`);
  rmSync(dir, { recursive: true, force: true });
}

export async function getShelves(repoPath: string): Promise<ShelfList> {
  return { shelves: listShelves(shelvesDirOf(repoPath)) };
}

/** shelf 操作分派：save（重名 → INVALID_QUERY）；restore/drop（不存在 → INVALID_REF）；返回刷新列表 */
export async function applyShelfAction(repoPath: string, action: ShelfAction): Promise<ShelfList> {
  switch (action.action) {
    case 'save':
      await saveShelf(repoPath, action.name);
      break;
    case 'restore':
      await restoreShelf(repoPath, action.name);
      break;
    case 'drop':
      await dropShelf(repoPath, action.name);
      break;
  }
  return getShelves(repoPath);
}

/**
 * 导入补丁为搁置（ImportIntoShelfAction 语义）：已有补丁全文 → 以同名搁置保存（仅 tracked 变更 ——
 * 补丁本身即 diff 全文，无未跟踪文件伴随）；重名 → INVALID_QUERY（沿 save 约定，用户可先改名补丁）。
 * 返回刷新后的搁置列表。
 */
export async function importPatchIntoShelf(repoPath: string, patchName: string): Promise<ShelfList> {
  const dir = shelfDirOf(repoPath, patchName);
  if (existsSync(dir)) throw new ServiceError('INVALID_QUERY', `搁置已存在：${patchName}`);
  const patch = readPatchText(repoPath, patchName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'patch.diff'), patch, 'utf8');
  return getShelves(repoPath);
}
