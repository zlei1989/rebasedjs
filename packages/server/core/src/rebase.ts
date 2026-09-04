/**
 * rebase 原语：onto 变基、交互式变基（sequence-editor shim）、todo 数据源、继续变基。
 * 冲突判定同 P2-E：operation 原语见 rebase 态（rebase-merge/rebase-apply，含 step/total），
 * 或 ls-files -u 有未合并条目；其余非 0 退出原样抛 GitExitError。
 * 交互式 todo 的「程序化编辑」经 GIT_SEQUENCE_EDITOR 指向同目录 git-sequence-editor.mjs shim 实现
 * （机制与引号约定见该文件头注释）。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listConflictedPaths } from './conflict';
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';

export interface CoreRebaseResult {
  status: 'success' | 'conflicts' | 'up-to-date';
}

/** shim 绝对路径：git 经 sh -c 调用编辑器，路径必须可执行且可被 sh 解析（见文件头） */
const SEQUENCE_EDITOR_SHIM = fileURLToPath(new URL('./git-sequence-editor.mjs', import.meta.url));

/** HEAD 哈希（无提交的空仓库返回 null，与 remote.ts 的私有 headHash 同款语义） */
async function headHash(cwd: string): Promise<string | null> {
  try {
    return (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
  } catch {
    return null;
  }
}

/** 冲突判定：rebase 操作态（含 rebase-merge 的 msgnum/end 进度）或 ls-files -u 未合并条目 */
async function hasRebaseConflicts(cwd: string): Promise<boolean> {
  const op = await getOperationState(cwd);
  if (op.kind === 'rebase') return true;
  return (await listConflictedPaths(cwd)).length > 0;
}

/**
 * 执行一次 rebase 并分类结果：非 0 退出且冲突判定成立 → 'conflicts'（状态留给调用方处理），
 * 其余非 0 退出原样透出；退出码 0 时以 HEAD 前后对比区分 'success' / 'up-to-date'。
 * env：注入到 git 子进程的额外环境变量（交互式变基的 GIT_SEQUENCE_EDITOR/REBASED_TODO_FILE）；
 * 固定注入 -c core.editor=true —— 交互式 todo 含 reword/squash 步骤时会开消息编辑器，
 * 服务端无 TTY 必败（P2-E 教训，同 merge.ts continueMerge 手法）。
 */
async function rebaseWithStatus(cwd: string, args: string[], env: Record<string, string>): Promise<CoreRebaseResult> {
  const before = await headHash(cwd);
  try {
    await runGit(args, { cwd, env, extraConfig: ['core.editor=true'] });
  } catch (err) {
    if (err instanceof GitExitError && (await hasRebaseConflicts(cwd))) return { status: 'conflicts' };
    throw err;
  }
  return { status: (await headHash(cwd)) === before ? 'up-to-date' : 'success' };
}

/** rebase onto：git rebase <onto> [branch]；冲突/up-to-date 判定见 rebaseWithStatus */
export async function rebaseOnto(cwd: string, opts: { onto: string; branch?: string }): Promise<CoreRebaseResult> {
  const args = ['rebase', opts.onto];
  if (opts.branch !== undefined) args.push(opts.branch);
  return rebaseWithStatus(cwd, args, {});
}

/**
 * 交互式变基 todo 数据源：git log --reverse --format=%H%x00%s <base>..HEAD。
 * 每条记录为 "<hash>\0<subject>\n"（NUL 分隔字段、行分隔记录；subject 为单行首主题，不含 \n）；
 * 反序（旧→新）与 git 的 todo 执行顺序一致；base 无效由 git 报错透出。
 */
export async function listTodoCommits(cwd: string, base: string): Promise<{ hash: string; subject: string }[]> {
  const { stdout } = await runGit(['log', '--reverse', '--format=%H%x00%s', `${base}..HEAD`], { cwd });
  const commits: { hash: string; subject: string }[] = [];
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const sep = line.indexOf('\0');
    // 缺 NUL 分隔符（git 控制格式下不可触发，防御性）→ 跳过该行，行为与 tag.ts 的字段守卫一致
    if (sep === -1) continue;
    commits.push({ hash: line.slice(0, sep), subject: line.slice(sep + 1) });
  }
  return commits;
}

/** sh 双引号包裹：git 以 `sh -c '<编辑器命令> "$@"'` 执行编辑器（见 shim 头注释），
 *  命令串本身须为合法 sh；bash 双引号内仅 $ ` " \ 四类字符需转义 */
function quoteForSh(value: string): string {
  return `"${value.replace(/["\\$`]/g, (ch) => `\\${ch}`)}"`;
}

/**
 * 交互式变基：entries 经 api 层校验后写入临时 todo 文件，再以
 * env GIT_SEQUENCE_EDITOR=<已引号包裹的 node+shim 路径> 与 REBASED_TODO_FILE=<临时文件>
 * 执行 git rebase -i <base>；shim 以 git 传入的 todo 路径（末参）覆写已备 todo——实现程序化编辑。
 * 冲突判定同 rebaseOnto；完成后清理临时 todo 文件（成功/冲突/异常均清理）。
 */
export async function runInteractiveRebase(
  cwd: string,
  opts: { base: string; entries: { hash: string; action: string }[] },
): Promise<CoreRebaseResult> {
  const todoDir = await mkdtemp(join(tmpdir(), 'rebased-todo-'));
  const todoFile = join(todoDir, 'todo');
  try {
    const lines = opts.entries.map((entry) => `${entry.action} ${entry.hash}`).join('\n');
    await writeFile(todoFile, `${lines}\n`, 'utf8');
    const editor = `${quoteForSh(process.execPath)} ${quoteForSh(SEQUENCE_EDITOR_SHIM)}`;
    return await rebaseWithStatus(cwd, ['rebase', '-i', opts.base], {
      GIT_SEQUENCE_EDITOR: editor,
      REBASED_TODO_FILE: todoFile,
    });
  } finally {
    await rm(todoDir, { recursive: true, force: true });
  }
}

/**
 * 继续变基：git -c core.editor=true rebase --continue。
 * 无 rebase 态由 git 报错透出（api 层预检）；-c core.editor=true 为无 TTY 编辑器防护——
 * 继续时若剩余 todo 含 reword 步骤会开消息编辑器（P2-E 教训，同 merge.ts continueMerge 手法）。
 */
export async function continueRebase(cwd: string): Promise<void> {
  await runGit(['-c', 'core.editor=true', 'rebase', '--continue'], { cwd });
}
