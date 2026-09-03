/** checkout 原语：检出既有分支 / 新建并检出 / detached 检出。git 失败统一以 GitExitError 透出。 */
import { runGit } from './exec';

export async function checkoutBranch(cwd: string, name: string): Promise<void> {
  await runGit(['checkout', name], { cwd });
}

export async function checkoutNewBranch(cwd: string, name: string, startPoint?: string): Promise<void> {
  const args = ['checkout', '-b', name];
  if (startPoint !== undefined) args.push(startPoint);
  await runGit(args, { cwd });
}

/** detached 检出（标签/提交哈希）：git checkout <ref> 即 detached；stderr 的 detached 提示不算错误 */
export async function checkoutDetached(cwd: string, ref: string): Promise<void> {
  await runGit(['checkout', ref], { cwd });
}
