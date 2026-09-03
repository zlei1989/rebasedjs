/**
 * conflict 原语：未合并路径列表、三阶段内容读取、整侧采纳与标记解决。
 * 解析策略：ls-files -u -z（NUL 分隔，路径任意字符安全）；不存在阶段靠
 * LC_ALL=C 固定的英文 stderr 特征判定（不猜其他文本），其余错误原样抛出。
 */
import { GitExitError, runGit } from './exec';

export interface CoreConflict {
  path: string;
  /** 升序去重的冲突阶段号（1=base，2=ours，3=theirs） */
  stages: number[];
}

/**
 * 未合并路径列表：git ls-files -u -z。
 * -z 下每条记录为 "<mode> <hash> <stage>\t<path>\0"（path 可含任意字符）；
 * 同 path 的多条记录（每个阶段一条）聚合为单个 CoreConflict，stages 升序去重。
 */
export async function listConflictedPaths(cwd: string): Promise<CoreConflict[]> {
  const { stdout } = await runGit(['ls-files', '-u', '-z'], { cwd });
  const byPath = new Map<string, Set<number>>();
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
    // 以首个 \t 切开元信息与路径，其后整段皆为 path（-z 无引用转义，path 含 \t 也安全）
    const tab = record.indexOf('\t');
    const stage = Number(record.slice(0, tab).split(' ')[2]);
    const path = record.slice(tab + 1);
    const stages = byPath.get(path);
    if (stages === undefined) byPath.set(path, new Set([stage]));
    else stages.add(stage);
  }
  return [...byPath.entries()].map(([path, stages]) => ({
    path,
    stages: [...stages].sort((a, b) => a - b),
  }));
}

/**
 * 读某冲突阶段的完整内容：git show :<stage>:<path>。
 * 阶段不存在（双方新增冲突无 base、路径本身不存在等）→ null：
 * 判定依据为 GitExitError 的 stderr 含 LC_ALL=C 下固定的 'does not exist' /
 * 'exists on disk' / 'but not at stage' 特征串；其余错误（非 git 仓库等）原样抛出。
 */
export async function readStageContent(cwd: string, path: string, stage: 1 | 2 | 3): Promise<string | null> {
  try {
    const { stdout } = await runGit(['show', `:${stage}:${path}`], { cwd });
    return stdout;
  } catch (err) {
    if (
      err instanceof GitExitError &&
      (err.stderr.includes('does not exist') ||
        err.stderr.includes('exists on disk') ||
        err.stderr.includes('but not at stage'))
    ) {
      return null;
    }
    throw err;
  }
}

/** 整侧采纳：git checkout --ours/--theirs -- path（仅写工作区，需再 markResolved 入库） */
export async function checkoutConflictSide(cwd: string, path: string, side: 'ours' | 'theirs'): Promise<void> {
  await runGit(['checkout', `--${side}`, '--', path], { cwd });
}

/** 标记已解决：git add -- path（当前工作区内容入库，冲突条目消除） */
export async function markResolved(cwd: string, path: string): Promise<void> {
  await runGit(['add', '--', path], { cwd });
}

/** 以删除解决删除/修改冲突：git rm -- path（同时删工作区文件并暂存删除，无需再 markResolved） */
export async function deleteConflictFile(cwd: string, path: string): Promise<void> {
  await runGit(['rm', '--', path], { cwd });
}
