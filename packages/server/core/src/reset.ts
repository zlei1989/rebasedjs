/** reset 原语：重置当前分支到指定 ref（git reset --<mode> <ref>）。
 *  mode 直传（soft/mixed/hard 由契约层枚举保证），ref 作为参数数组元素传递，防注入。 */
import { GitExitError, runGit } from './exec';

/** 重置当前分支到 ref：git reset --<mode> <ref>；mode 直传（soft/mixed/hard 由契约层枚举保证） */
export async function resetToRef(cwd: string, ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  await runGit(['reset', `--${mode}`, ref], { cwd });
}

/** 校验 ref 是否解析为提交：git rev-parse --verify --quiet <ref>^{commit}；exitCode 1（不存在/非提交）→ false，其它失败上抛 */
export async function verifyCommitish(cwd: string, ref: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd });
    return true;
  } catch (e) {
    if (e instanceof GitExitError && e.exitCode === 1) return false;
    throw e;
  }
}
