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
import { currentBranchName } from './branch';
import { checkoutBranch, checkoutNewBranch } from './checkout';
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

/**
 * 提交信息编辑器 shim（auto-squash 的 squash! 步骤用）：git 调消息编辑器时把消息文件路径作末参传入，
 * 本脚本以 env REBASED_MESSAGE_FILE 指向的「已备消息」覆盖写入——结果提交信息 = 目标提交原信息
 * （GitSquashedCommitsMessage.prettySquash 语义：去 autosquash 前缀、保原文；fixup! 步骤无需编辑器）。
 */
const MESSAGE_SHIM_SOURCE = `import { readFileSync, writeFileSync } from 'node:fs';

const messagePath = process.argv[process.argv.length - 1];
const preparedPath = process.env.REBASED_MESSAGE_FILE;

if (preparedPath === undefined || preparedPath === '') {
  throw new Error('REBASED_MESSAGE_FILE 未设置，无法获取已备好的提交信息');
}
if (messagePath === undefined) {
  throw new Error('消息文件路径未作为末参传入');
}

writeFileSync(messagePath, readFileSync(preparedPath, 'utf8'));
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
 * env：注入到 git 子进程的额外环境变量（交互式变基的 GIT_SEQUENCE_EDITOR/REBASED_TODO_FILE、
 * auto-squash 的 GIT_EDITOR/REBASED_MESSAGE_FILE）；固定注入 -c core.editor=true ——
 * 交互式 todo 含 reword/squash 步骤时会开消息编辑器，服务端无 TTY 必败（P2-E 教训，同 merge.ts continueMerge 手法）；
 * GIT_EDITOR env 优先级高于 core.editor，调用方注入的编辑器 shim 生效。
 */
export async function rebaseWithStatus(cwd: string, args: string[], env: Record<string, string>): Promise<CoreRebaseResult> {
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
 * message 提供时（reword 单提交编辑）：同目录落消息 shim 与 REBASED_MESSAGE_FILE，注入 GIT_EDITOR——
 * 消息编辑器打开即被覆写为新提交信息（无 TTY 下的 reword；GIT_EDITOR 优先级高于 -c core.editor=true）。
 * shim 源一并落盘到同一临时目录（见 SHIM_SOURCE 头注释：绕过打包器对 import.meta.url 的破坏）。
 * 冲突判定同 rebaseOnto；完成后清理临时目录（成功/冲突/异常均清理）。
 */
export async function runInteractiveRebase(
  cwd: string,
  opts: { base: string; entries: { hash: string; action: string }[]; message?: string },
): Promise<CoreRebaseResult> {
  const todoDir = await mkdtemp(join(tmpdir(), 'rebased-todo-'));
  const todoFile = join(todoDir, 'todo');
  const shimFile = join(todoDir, 'git-sequence-editor.mjs');
  try {
    const lines = opts.entries.map((entry) => `${entry.action} ${entry.hash}`).join('\n');
    await writeFile(todoFile, `${lines}\n`, 'utf8');
    await writeFile(shimFile, SHIM_SOURCE, 'utf8');
    const editor = `${quoteForSh(process.execPath)} ${quoteForSh(shimFile)}`;
    const env: Record<string, string> = {
      GIT_SEQUENCE_EDITOR: editor,
      REBASED_TODO_FILE: todoFile,
    };
    if (opts.message !== undefined) {
      const messageFile = join(todoDir, 'message');
      const messageShim = join(todoDir, 'git-message-editor.mjs');
      await writeFile(messageFile, opts.message, 'utf8');
      await writeFile(messageShim, MESSAGE_SHIM_SOURCE, 'utf8');
      env.GIT_EDITOR = `${quoteForSh(process.execPath)} ${quoteForSh(messageShim)}`;
      env.REBASED_MESSAGE_FILE = messageFile;
    }
    return await rebaseWithStatus(cwd, ['rebase', '-i', opts.base], env);
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

/** 跳过冲突中的变基提交：git rebase --skip（GitRebaseResumeMode.SKIP 语义——丢弃当前提交，继续后续） */
export async function skipRebase(cwd: string): Promise<void> {
  await runGit(['-c', 'core.editor=true', 'rebase', '--skip'], { cwd });
}

/** <rev> 是否有父（rev-parse --verify --quiet <rev>^ exit 1 = 无，即根提交）；其余失败原样上抛 */
async function revHasParent(cwd: string, rev: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `${rev}^`], { cwd });
    return true;
  } catch (e) {
    if (e instanceof GitExitError && e.exitCode === 1) return false;
    throw e;
  }
}

/** 全量历史（--root 基的 todo 数据源）：git log --reverse --format=%H%x00%s（HEAD 祖先，旧→新） */
async function historyOldToNew(cwd: string): Promise<{ hash: string; subject: string }[]> {
  const { stdout } = await runGit(['log', '--reverse', '--format=%H%x00%s'], { cwd });
  const commits: { hash: string; subject: string }[] = [];
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const sep = line.indexOf('\0');
    if (sep === -1) continue;
    commits.push({ hash: line.slice(0, sep), subject: line.slice(sep + 1) });
  }
  return commits;
}

/**
 * 单提交编辑直通（GitSingleCommitEditingAction 语义：Reword/Squash/Fixup/Drop 提交）： * - reword：base=<hash>^，todo 首行 reword + GIT_EDITOR 消息 shim 写入新信息（message 必填）；
 * - drop：base=<hash>^，todo 该行 drop；
 * - squash/fixup（并入父提交）：base=<父>^（父为根提交时 --root），todo = [pick 父, squash|fixup hash, pick 其余...]；
 *   squash 的消息编辑器走 git 默认（合并信息；未注入 message 保持默认交互语义的确定性落盘）。
 * 根提交 reword/drop（--root）、根提交的 squash/fixup（无父 → 上层预检拒绝）。
 * 冲突 → 'conflicts'（rebase 冲突态交冲突页）。
 */
export async function editCommitAction(
  cwd: string,
  opts: { hash: string; action: 'reword' | 'drop' | 'squash' | 'fixup'; message?: string },
): Promise<CoreRebaseResult> {
  const hashHasParent = await revHasParent(cwd, opts.hash);
  let base: string;
  if (opts.action === 'squash' || opts.action === 'fixup') {
    if (hashHasParent) {
      base = (await revHasParent(cwd, `${opts.hash}^`)) ? `${opts.hash}^^` : '--root';
    } else {
      throw new Error('根提交无父提交，不可 squash/fixup');
    }
  } else {
    base = hashHasParent ? `${opts.hash}^` : '--root';
  }
  const commits = base === '--root' ? await historyOldToNew(cwd) : await listTodoCommits(cwd, base);
  const entries: { hash: string; action: string }[] = [];
  for (const c of commits) {
    entries.push(c.hash === opts.hash ? { hash: c.hash, action: opts.action } : { hash: c.hash, action: 'pick' });
  }
  return runInteractiveRebase(cwd, {
    base,
    entries,
    ...(opts.action === 'reword' ? { message: opts.message } : {}),
  });
}

/**
 * auto-squash（GitCommitFixupBySubjectAction / GitCommitSquashBySubjectAction 语义）：
 * 1) 以暂存内容创建提交，信息 = `<action>! <目标提交subject>`（服务端构造——GitBundle 的
 *    "fixup! " / "squash! " 前缀）；无暂存内容由 git 报错透出（"nothing to commit"）。
 * 2) `git rebase -i --autosquash <目标^>`（根提交目标 → --root）：GIT_SEQUENCE_EDITOR=true 接受
 *    git 自动排好的默认 todo（autosquash 把 fixup!/squash! 提交移到同主题目标之后并折入）；
 *    squash! 步骤开消息编辑器 → GIT_EDITOR 指向 shim 以目标提交 %B 覆写（prettySquash 语义：
 *    结果信息 = 目标提交原文）；fixup! 不动编辑器（结果信息 = 目标提交原文）。
 * 失败语义同 rebaseWithStatus：冲突 → 'conflicts'（rebase 冲突态交冲突页）。
 */
export async function autosquashCommit(
  cwd: string,
  opts: { hash: string; action: 'fixup' | 'squash' },
): Promise<CoreRebaseResult> {
  const { stdout: subjectOut } = await runGit(['log', '-1', '--format=%s', opts.hash], { cwd });
  await runGit(['commit', '-m', `${opts.action}! ${subjectOut.trim()}`], { cwd });
  // 根提交判定：目标无父 → --root（todo 从根起）
  const base = await isRootTarget(cwd, opts.hash)
    ? '--root'
    : `${opts.hash}^`;
  if (opts.action === 'squash') {
    const { stdout: messageOut } = await runGit(['log', '-1', '--format=%B', opts.hash], { cwd });
    const dir = await mkdtemp(join(tmpdir(), 'rebased-msg-'));
    try {
      const messageFile = join(dir, 'message');
      const shimFile = join(dir, 'git-message-editor.mjs');
      await writeFile(messageFile, messageOut, 'utf8');
      await writeFile(shimFile, MESSAGE_SHIM_SOURCE, 'utf8');
      const editor = `${quoteForSh(process.execPath)} ${quoteForSh(shimFile)}`;
      return await rebaseWithStatus(cwd, ['rebase', '-i', '--autosquash', base], {
        GIT_SEQUENCE_EDITOR: 'true',
        GIT_EDITOR: editor,
        REBASED_MESSAGE_FILE: messageFile,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return rebaseWithStatus(cwd, ['rebase', '-i', '--autosquash', base], { GIT_SEQUENCE_EDITOR: 'true' });
}

/** 根提交判定：<rev>^ 解析失败（--verify --quiet exit 1）即无父（根提交）；其余失败原样上抛（仅本层内部对已校验哈希调用） */
async function isRootTarget(cwd: string, hash: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `${hash}^`], { cwd });
    return false;
  } catch (e) {
    if (e instanceof GitExitError && e.exitCode === 1) return true;
    throw e;
  }
}

/**
 * 检出并变基（GitCheckoutWithRebaseAction 语义：branches.checkout.and.rebase.onto.current）：
 * 记录当前分支 → 检出目标分支（本地分支直接检出；isRemote 时 [localName 缺省剥 origin/ 前缀] 新建本地分支检出）→
 * 变基到变基前所在分支（rebase onto current）。
 * 冲突 → rebase 冲突态（交冲突页 continue/abort/skip 流）；无进行中操作由调用方预检；
 * 目标为当前分支由调用方拒绝（本条原语不做判定，git rebase 自查会空转）。
 */
export async function checkoutWithRebase(
  cwd: string,
  opts: { branch: string; isRemote: boolean; localName?: string },
): Promise<{ status: 'success' | 'conflicts' }> {
  const current = await currentBranchName(cwd);
  if (current === null) {
    throw new Error('分离头指针状态下不可检出并变基（请先检出分支）');
  }
  if (opts.isRemote) {
    // 远程分支：新建本地分支（缺省剥远程名前缀，如 origin/main → main）并检出（起点 = 远程跟踪引用；git 同时设上游）
    await checkoutNewBranch(cwd, opts.localName ?? opts.branch.replace(/^[^/]+\//, ''), opts.branch);
  } else {
    await checkoutBranch(cwd, opts.branch);
  }
  const result = await rebaseWithStatus(cwd, ['rebase', current], {});
  return { status: result.status === 'conflicts' ? 'conflicts' : 'success' };
}
