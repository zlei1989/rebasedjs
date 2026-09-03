/** operation 原语：检测仓库中正在进行的 git 操作（merge/rebase/cherry-pick/revert）并支持中止。
 *  检测依据 gitDir 内的标记文件/目录，而非猜 `.git` 目录（worktree 安全）。 */
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runGit } from './exec';

export interface CoreOperation {
  kind: 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert';
  step?: number;
  total?: number;
}

/** 文件是否存在（access 模式，避免 readFile 的内容开销与竞态差异） */
async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** 读进度数字文件（trim 后 parseInt）；读不到或不是数字则省略进度字段 */
async function readProgress(gitDir: string, dir: string, stepFile: string, totalFile: string): Promise<Pick<CoreOperation, 'step' | 'total'>> {
  try {
    const step = parseInt((await readFile(join(gitDir, dir, stepFile), 'utf8')).trim(), 10);
    const total = parseInt((await readFile(join(gitDir, dir, totalFile), 'utf8')).trim(), 10);
    return Number.isNaN(step) || Number.isNaN(total) ? {} : { step, total };
  } catch {
    return {};
  }
}

/** 检测正在进行的操作。优先级 rebase > merge > cherry-pick > revert：
 *  rebase 冲突时 cherry-pick/merge 标记可能并存，rebase 优先返回。
 *  rebase-merge（交互式）用 msgnum/end 给进度；rebase-apply（am/apply）用 next/last，读不到则省略。 */
export async function getOperationState(cwd: string): Promise<CoreOperation> {
  const { stdout } = await runGit(['rev-parse', '--absolute-git-dir'], { cwd });
  const gitDir = stdout.trim();

  if (await exists(join(gitDir, 'rebase-merge'))) {
    return { kind: 'rebase', ...(await readProgress(gitDir, 'rebase-merge', 'msgnum', 'end')) };
  }
  if (await exists(join(gitDir, 'rebase-apply'))) {
    return { kind: 'rebase', ...(await readProgress(gitDir, 'rebase-apply', 'next', 'last')) };
  }
  if (await exists(join(gitDir, 'MERGE_HEAD'))) return { kind: 'merge' };
  if (await exists(join(gitDir, 'CHERRY_PICK_HEAD'))) return { kind: 'cherry-pick' };
  if (await exists(join(gitDir, 'REVERT_HEAD'))) return { kind: 'revert' };
  return { kind: 'none' };
}

/** 中止正在进行的操作：kind 映射到对应命令的 --abort。 */
export async function abortGitOperation(cwd: string, kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert'): Promise<void> {
  await runGit([kind, '--abort'], { cwd });
}
