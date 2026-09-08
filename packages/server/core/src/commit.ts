/** 提交原语：提交暂存区内容并返回新提交哈希。 */
import { GitExitError, runGit } from './exec';
import { listTodoCommits, runInteractiveRebase } from './rebase';

/** 提交暂存区：message 经 -m 单参数传入（参数数组无 shell，多行安全）；
 *  返回新提交哈希（rev-parse HEAD）。 */
export async function commitStaged(
  cwd: string,
  opts: { message: string; amend?: boolean; signOff?: boolean; noVerify?: boolean },
): Promise<string> {
  const args = ['commit'];
  if (opts.amend) args.push('--amend');
  if (opts.signOff) args.push('--signoff');
  if (opts.noVerify) args.push('--no-verify');
  args.push('-m', opts.message);
  await runGit(args, { cwd });
  const { stdout } = await runGit(['rev-parse', 'HEAD'], { cwd });
  return stdout.trim();
}

/** HEAD 哈希：无提交的空仓库返回 null（与 remote.ts 的私有 headHash 同款语义） */
export async function headCommit(cwd: string): Promise<string | null> {
  try {
    return (await runGit(['rev-parse', 'HEAD'], { cwd })).stdout.trim();
  } catch {
    return null;
  }
}

/** 祖先判定：git merge-base --is-ancestor <ancestor> <descendant>（exit 0=是，1=否；无效引用原样上抛） */
export async function isAncestorCommit(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await runGit(['merge-base', '--is-ancestor', ancestor, descendant], { cwd });
    return true;
  } catch (e) {
    if (e instanceof GitExitError && e.exitCode === 1) return false;
    throw e;
  }
}

/** 根提交判定：<rev>^ 解析失败（--verify --quiet exit 1）即无父（根提交）；其余失败原样上抛（仅本层内部对已校验哈希调用） */
async function isRootCommit(cwd: string, hash: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `${hash}^`], { cwd });
    return false;
  } catch (e) {
    if (e instanceof GitExitError && e.exitCode === 1) return true;
    throw e;
  }
}

/**
 * amend 目标候选（GitCommitDialog「Amend <subject>」下拉语义，GitAmendCommitService 对照）：
 * 当前分支 HEAD 祖先但任一远程不可达（未发布——--not --remotes）的提交，新→旧（最近在前）；
 * 排除 HEAD（HEAD 走常规 amend）；HEAD 为合并提交或走查到首个合并提交即止（stopAtFirstMergeCommit，
 * 不含该合并）；上限 20（COMMITS_LIMIT）。
 */
export async function listAmendTargets(cwd: string): Promise<{ hash: string; subject: string }[]> {
  // HEAD 为正选集：--not --remotes 反转后续 (无正集时 git log 输出为空——见实证)
  const { stdout } = await runGit(['log', '--format=%H%x00%P%x00%s', 'HEAD', '--not', '--remotes', '--max-count=100'], { cwd });
  const targets: { hash: string; subject: string }[] = [];
  let first = true;
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const [hash, parents, subject] = line.split('\0');
    if (hash === undefined || parents === undefined || subject === undefined) continue;
    // 合并判定：%P 空格分隔的多父（正常提交单父；根提交空）——merge commit 才有 ≥2 父
    const parentCount = parents.trim() === '' ? 0 : parents.trim().split(' ').length;
    // 首条即 HEAD：排除；HEAD 为合并提交 → 无可 amend 目标（Java stopAtFirstMergeCommit 走查止于 HEAD）
    if (first) {
      first = false;
      if (parentCount > 1) return [];
      continue;
    }
    // 合并提交：停止（到首个合并为止，不含）
    if (parentCount > 1) break;
    if (targets.length >= 20) break;
    targets.push({ hash, subject });
  }
  return targets;
}

/** amend 指定提交结果：success=重写完成（hash 为新 HEAD）；conflicts=进入变基冲突态待解决 */
export interface CoreAmendSpecificResult {
  status: 'success' | 'conflicts';
  hash?: string;
}

/**
 * amend 指定历史提交（GitAmendSpecificCommitSquasher 语义的 git 原生等价）：
 * 1) 先在 HEAD 上创建 amend 提交（git commit --allow-empty -m <message>——暂存内容进入，无暂存也允许空提交，
 *    与 Java 的 "--allow-empty" 一致；message 即为重写后的提交信息）；
 * 2) 交互式变基把该提交 fixup -C 折入目标提交（fixup -C：结果提交信息取 amend 提交的 message——
 *    干净且不触发消息编辑器；序列编辑经 runInteractiveRebase 的 shim 程序化完成）；
 *    目标与 amend 之间的提交原样 replays（与 Java InMemoryRebase 的 range 语义一致）；
 * 3) 冲突 → rebase 冲突态（交由冲突页 continue/abort 流）。
 * 目标校验（有效提交/非 HEAD/HEAD 祖先）由 api 层预检。
 */
export async function amendSpecificCommit(
  cwd: string,
  opts: { targetHash: string; message: string },
): Promise<CoreAmendSpecificResult> {
  await runGit(['commit', '--allow-empty', '-m', opts.message], { cwd });
  const amendHash = await headCommit(cwd);
  if (amendHash === null) throw new Error('amend 提交创建后无 HEAD');
  const root = await isRootCommit(cwd, opts.targetHash);
  // 目标..HEAD（旧→新）；根提交目标时取全量历史（base='--root'）
  const commits = root
    ? await runAllHistoryOldToNew(cwd)
    : await listTodoCommits(cwd, `${opts.targetHash}^`);
  const entries: { hash: string; action: string }[] = [];
  for (const c of commits) {
    if (c.hash === opts.targetHash) {
      entries.push({ hash: c.hash, action: 'pick' });
      // amend 提交折入目标：fixup -C 结果消息 = amend 提交的 message（新提交信息，reword 语义）
      entries.push({ hash: amendHash, action: `fixup -C ${amendHash}` });
    } else if (c.hash !== amendHash) {
      entries.push({ hash: c.hash, action: 'pick' });
    }
  }
  const result = await runInteractiveRebase(cwd, { base: root ? '--root' : `${opts.targetHash}^`, entries });
  // conflicts → 变基冲突态（交冲突页）；up-to-date 防御：执行 todo 后 HEAD 必然移动（amend 提交被折入），此处按失败上抛
  if (result.status === 'conflicts') return { status: 'conflicts' };
  if (result.status === 'up-to-date') throw new Error(`amend 指定提交未生效：${opts.targetHash}`);
  return { status: 'success', hash: (await headCommit(cwd)) ?? undefined };
}

/** 全量历史（根提交 amend 目标的数据源）：git log --reverse --format=%H%x00%s（HEAD 祖先，旧→新） */
async function runAllHistoryOldToNew(cwd: string): Promise<{ hash: string; subject: string }[]> {
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
