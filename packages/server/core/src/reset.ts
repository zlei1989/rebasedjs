/** reset 原语：重置当前分支到指定 ref（git reset --<mode> <ref>）。
 *  mode 直传（soft/mixed/hard 由契约层枚举保证），ref 作为参数数组元素传递，防注入。 */
import { runGit } from './exec';

/** 重置当前分支到 ref：git reset --<mode> <ref>；mode 直传（soft/mixed/hard 由契约层枚举保证） */
export async function resetToRef(cwd: string, ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void> {
  await runGit(['reset', `--${mode}`, ref], { cwd });
}
