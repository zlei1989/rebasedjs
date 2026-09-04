/**
 * rebase 原语：onto 变基、交互式变基（sequence-editor shim）、todo 数据源、继续变基。
 * 冲突判定同 P2-E：operation 原语见 rebase 态（rebase-merge/rebase-apply，含 step/total），
 * 或 ls-files -u 有未合并条目；其余非 0 退出原样抛 GitExitError。
 * 交互式 todo 的「程序化编辑」经 GIT_SEQUENCE_EDITOR 指向 shim 脚本实现：
 * git 以 `sh -c '<编辑器命令> "$@"' <编辑器命令> <todo路径>` 调用编辑器（见 SHIM_SOURCE 头注释），
 * shim 读取 env REBASED_TODO_FILE 指向的「已备 todo」并覆盖写入 git 传入的 todo 路径。
 * shim 文件内容以字符串常量内嵌（本模块为运行时唯一真源），执行时落盘到临时目录——
 * 不再经 import.meta.url 解析包内文件路径（webpack 打包会把 new URL(..., import.meta.url)
 * 资产化为跨 realm URL 对象，fileURLToPath 拒绝，web-next 整站 API 500；见 Task 8 冒烟修复）。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listConflictedPaths } from './conflict';
import { GitExitError, runGit } from './exec';
import { getOperationState } from './operation';

/**
 * shim 脚本源（零依赖，仅 node 内置模块）：
 * git 经过 sh -c 把 todo 路径作为末参传给编辑器命令，本脚本读取 process.argv 末参（todo 路径），
 * 把 process.env.REBASED_TODO_FILE 指向的「服务端已备好」的 todo 内容覆盖写入——todo 编辑完全程序化，无需交互。
 * 失败语义：REBASED_TODO_FILE 未设置或读写失败时以非零退出——git 将中止变基且不留下
 * rebase 状态，上层按 GitExitError 原样透出（api 层预检已保证参数合法，此处属于防御）。
 */
const SHIM_SOURCE = `import { readFileSync, writeFileSync } from 'node:fs';

const todoPath = process.argv[process.argv.length - 1];
const preparedPath = process.env.REBASED_TODO_FILE;

if (preparedPath === undefined || preparedPath === '') {
  throw new Error('REBASED_TODO_FILE 未设置，无法获取已备好的 todo 内容');
}
if (todoPath === undefined) {
  throw new Error('todo 路径未作为末参传入');
}

writeFileSync(todoPath, readFileSync(preparedPath, 'utf8'));
`;

export interface CoreRebaseResult {
  status: 'success' | 'conflicts' | 'up-to-date';
}

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
 * shim 源一并落盘到同一临时目录（见 SHIM_SOURCE 头注释：绕过打包器对 import.meta.url 的破坏）。
 * 冲突判定同 rebaseOnto；完成后清理临时目录（成功/冲突/异常均清理）。
 */
export async function runInteractiveRebase(
  cwd: string,
  opts: { base: string; entries: { hash: string; action: string }[] },
): Promise<CoreRebaseResult> {
  const todoDir = await mkdtemp(join(tmpdir(), 'rebased-todo-'));
  const todoFile = join(todoDir, 'todo');
  const shimFile = join(todoDir, 'git-sequence-editor.mjs');
  try {
    const lines = opts.entries.map((entry) => `${entry.action} ${entry.hash}`).join('\n');
    await writeFile(todoFile, `${lines}\n`, 'utf8');
    await writeFile(shimFile, SHIM_SOURCE, 'utf8');
    const editor = `${quoteForSh(process.execPath)} ${quoteForSh(shimFile)}`;
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
