/**
 * merge 原语：发起合并与继续合并。
 * 状态判定不猜 stderr 文本：仅 up-to-date 依赖 LC_ALL=C 固定的英文 stdout；
 * 冲突以 MERGE_HEAD 标记文件为准（复用 operation 原语），其余非 0 退出原样抛 GitExitError。
 */
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';

export interface CoreMergeResult {
  status: 'success' | 'conflicts' | 'up-to-date';
  /** git 原始输出（诊断/展示用） */
  stdout: string;
}

/** 文件是否存在（access 模式，与 operation.ts 同款手法） */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 合并 branch 到当前分支：选项映射 --no-ff/--squash/--no-commit/-m。
 * 状态判定算法：stdout 含 'Already up to date'（LC_ALL=C 固定英文）→ up-to-date；
 * 退出码非 0 且存在 MERGE_HEAD → conflicts；退出码非 0 且无 MERGE_HEAD → 原样抛 GitExitError；
 * 退出码 0 → success（squash/no-commit 时 git 不产提交也返回 0）。
 */
export async function mergeBranch(
  cwd: string,
  opts: { branch: string; noFf?: boolean; squash?: boolean; noCommit?: boolean; message?: string },
): Promise<CoreMergeResult> {
  const args = ['merge'];
  if (opts.noFf) args.push('--no-ff');
  if (opts.squash) args.push('--squash');
  if (opts.noCommit) args.push('--no-commit');
  if (opts.message !== undefined) args.push('-m', opts.message);
  args.push(opts.branch);

  try {
    const { stdout } = await runGit(args, { cwd });
    if (stdout.includes('Already up to date')) return { status: 'up-to-date', stdout };
    return { status: 'success', stdout };
  } catch (err) {
    // 冲突时 git 非 0 退出但留下 MERGE_HEAD；分支不存在等失败无此标记，原样透出
    if (err instanceof GitExitError && (await getOperationState(cwd)).kind === 'merge') {
      return { status: 'conflicts', stdout: err.stdout };
    }
    throw err;
  }
}

/**
 * 继续合并：有 MERGE_HEAD → git merge --continue。
 * squash 场景无 MERGE_HEAD（--continue 不适用）但 git 留下 SQUASH_MSG/MERGE_MSG：
 * 退化为 git commit --no-edit 完成提交（默认信息由 git 取 SQUASH_MSG/MERGE_MSG）。
 * 两者皆无（无进行中合并）时仍走 --continue，由 git 报错透出（api 层有预检）。
 * 编辑器防护：服务端无 TTY，merge --continue 内部 git commit 会开编辑器导致
 * "Terminal is dumb" 失败——以 -c core.editor=true 强制空编辑器（同 exec.ts 注入 -c 的手法）。
 */
export async function continueMerge(cwd: string): Promise<void> {
  if ((await getOperationState(cwd)).kind !== 'merge') {
    const { stdout } = await runGit(['rev-parse', '--absolute-git-dir'], { cwd });
    const gitDir = stdout.trim();
    if ((await exists(join(gitDir, 'SQUASH_MSG'))) || (await exists(join(gitDir, 'MERGE_MSG')))) {
      // --no-edit：信息文件已备好，跳过编辑器
      await runGit(['commit', '--no-edit'], { cwd });
      return;
    }
  }
  await runGit(['-c', 'core.editor=true', 'merge', '--continue'], { cwd });
}
