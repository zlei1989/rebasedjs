/**
 * patch 功能：仓库级 diff 全文存档（configDir/patches/<repoId>/<name>.patch），
 * 列表/创建/应用/删除。应用走 check 先行两段原语（失败零变更），stderr 首行映射为 INVALID_QUERY。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { GitExitError, checkApplyPatch, runGit } from '@rebased/core';
import {
  ServiceError,
  type PatchApplyBody,
  type PatchCreateBody,
  type PatchDeleteBody,
  type PatchEntry,
  type PatchList,
  type RepoStatus,
} from '@rebased/contracts';
import type { AppConfig } from './lib/config-store';
import { getConfigDir, loadConfig } from './lib/config-store';
import { getRepoStatus } from './status';

/** repoPath → repoId：经 config.repos 注册表反查（沿 changelist 先例）；未注册 → REPO_NOT_FOUND（防御） */
function repoIdOf(config: AppConfig, repoPath: string): string {
  const repo = config.repos.find((r) => r.path === repoPath);
  if (!repo) {
    throw new ServiceError('REPO_NOT_FOUND', `仓库不存在或未打开：${repoPath}`, { context: { path: repoPath } });
  }
  return repo.id;
}

/** 补丁存档目录：<configDir>/patches/<repoId>/ */
function patchesDirOf(repoPath: string): string {
  return join(getConfigDir(), 'patches', repoIdOf(loadConfig(), repoPath));
}

/** name → 存档文件路径；name 未限制正则（仅 apply/delete body），含路径逃逸一律按不存在处理 */
function patchFileOf(dir: string, name: string): string {
  const base = resolve(dir);
  const file = resolve(join(base, `${name}.patch`));
  if (!file.startsWith(base + sep)) throw new ServiceError('INVALID_REF', `补丁不存在：${name}`);
  return file;
}

/** 存档目录列表：名称去掉 .patch 后缀，按名称排序（createdAtIso 取文件 mtime） */
function listPatches(dir: string): PatchEntry[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.patch'))
    .map((d) => {
      const stat = statSync(join(dir, d.name));
      return { name: d.name.slice(0, -'.patch'.length), size: stat.size, createdAtIso: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * 创建数据源（控制器裁定）：
 * - from/to 均缺省 → 工作区模式：staged=false → `git diff HEAD`（HEAD→工作树全量，含暂存）；staged=true → `git diff --cached`；
 * - 单侧给出 → 缺侧默认为 HEAD（`git diff HEAD <to>` / `git diff <from> HEAD`）；
 * - 两侧给出 → `git diff <from> <to>`；
 * - paths 给出（无 from/to，契约 refine 保证）→ 在对应模式后追加文件集路径（`-- <paths>`）。
 */
function buildCreateDiffArgs(body: PatchCreateBody): string[] {
  const args = ['diff', '--no-ext-diff'];
  if (body.from === undefined && body.to === undefined) {
    args.push(body.staged ? '--cached' : 'HEAD');
  } else if (body.from === undefined) {
    args.push('HEAD', body.to!);
  } else if (body.to === undefined) {
    args.push(body.from, 'HEAD');
  } else {
    args.push(body.from, body.to);
  }
  if (body.paths !== undefined) args.push('--', ...body.paths);
  return args;
}

export async function getPatches(repoPath: string): Promise<PatchList> {
  return { patches: listPatches(patchesDirOf(repoPath)) };
}

/** 创建补丁：diff 全文写入 <name>.patch（空 diff 照常创建 0 字节文件；同名覆盖更新），返回刷新列表 */
export async function createPatch(repoPath: string, body: PatchCreateBody): Promise<PatchList> {
  const dir = patchesDirOf(repoPath);
  const { stdout } = await runGit(buildCreateDiffArgs(body), { cwd: repoPath });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${body.name}.patch`), stdout, 'utf8');
  return getPatches(repoPath);
}

/** check+apply 补丁文本，失败映射 INVALID_QUERY '补丁无法应用：<stderr 首行>'（shelf restore 复用同一映射） */
export async function applyPatchText(repoPath: string, text: string): Promise<void> {
  try {
    await checkApplyPatch(repoPath, text, {});
  } catch (err) {
    if (err instanceof GitExitError) {
      const firstLine = err.stderr.trim().split('\n')[0] ?? '';
      throw new ServiceError('INVALID_QUERY', `补丁无法应用：${firstLine}`, {
        cause: err,
        context: { stderr: err.stderr },
      });
    }
    throw err;
  }
}

/** 应用补丁到工作区（check 先行）；不存在 → INVALID_REF；成功返回刷新状态 */
export async function applyPatchService(repoPath: string, body: PatchApplyBody): Promise<RepoStatus> {
  const file = patchFileOf(patchesDirOf(repoPath), body.name);
  if (!existsSync(file)) throw new ServiceError('INVALID_REF', `补丁不存在：${body.name}`);
  const patch = readFileSync(file, 'utf8');
  // 空/纯空白补丁无可应用变更（git apply 会以 exit 128 失败）——与 shelf restore 同判定，跳过 check/apply 直接成功
  if (patch.trim().length > 0) {
    await applyPatchText(repoPath, patch);
  }
  return getRepoStatus(repoPath);
}

/** 删除补丁：不存在 → INVALID_REF；成功返回刷新列表 */
export async function deletePatch(repoPath: string, body: PatchDeleteBody): Promise<PatchList> {
  const file = patchFileOf(patchesDirOf(repoPath), body.name);
  if (!existsSync(file)) throw new ServiceError('INVALID_REF', `补丁不存在：${body.name}`);
  rmSync(file);
  return getPatches(repoPath);
}

/** 读补丁全文（Import into Shelf 数据源）：不存在 → INVALID_REF */
export function readPatchText(repoPath: string, name: string): string {
  const file = patchFileOf(patchesDirOf(repoPath), name);
  if (!existsSync(file)) throw new ServiceError('INVALID_REF', `补丁不存在：${name}`);
  return readFileSync(file, 'utf8');
}
