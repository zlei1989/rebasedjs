/** 暂存区原语：stage / unstage / discard / clean / applyPatch。
 *  全部经 runGit 参数数组调用（防注入），路径一律置于 `--` 之后。 */
import { runGit } from './exec';

/** 把 paths 加入暂存区（git add --） */
export async function stagePaths(cwd: string, paths: string[]): Promise<void> {
  await runGit(['add', '--', ...paths], { cwd });
}

/** 把 paths 移出暂存区（git restore --staged --） */
export async function unstagePaths(cwd: string, paths: string[]): Promise<void> {
  await runGit(['restore', '--staged', '--', ...paths], { cwd });
}

/** 放弃工作区修改（git restore --worktree --，文件回到 index 版本） */
export async function discardPaths(cwd: string, paths: string[]): Promise<void> {
  await runGit(['restore', '--worktree', '--', ...paths], { cwd });
}

/** 删除未跟踪文件/目录（git clean -fd --，discard 对 ?? 条目的分派）；
 *  porcelain 将未跟踪目录折叠为 `?? dir/` 条目，-d 确保目录路径也可删除（对文件路径安全无副作用） */
export async function cleanUntracked(cwd: string, paths: string[]): Promise<void> {
  await runGit(['clean', '-fd', '--', ...paths], { cwd });
}

/** 应用 patch 文本：cached=--cached（作用于暂存区），reverse=-R（反向）。
 *  patch 经 runGit input 从 stdin 传入，内容任意字符安全。 */
export async function applyPatch(cwd: string, patch: string, opts: { cached?: boolean; reverse?: boolean }): Promise<void> {
  const args = ['apply', ...(opts.cached ? ['--cached'] : []), ...(opts.reverse ? ['-R'] : [])];
  await runGit(args, { cwd, input: patch });
}

/** check+apply 两段：先 git apply --check（失败即抛，不产生半程变更），通过才 apply。
 *  与 applyPatch 相同参数语义（cached/reverse），但保证失败时工作区零变更。 */
export async function checkApplyPatch(cwd: string, patch: string, opts: { cached?: boolean; reverse?: boolean }): Promise<void> {
  const args = ['apply', ...(opts.cached ? ['--cached'] : []), ...(opts.reverse ? ['-R'] : [])];
  await runGit([...args, '--check'], { cwd, input: patch });
  await runGit(args, { cwd, input: patch });
}
