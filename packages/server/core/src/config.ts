/** config 原语：git config 单键读取（生效值 + 仓库级值）与仓库级写入。 */
import { GitExitError, runGit } from './exec';

/** 单键配置读取结果：value 为生效值（合并所有作用域），localValue 为仓库级值；未设置为 null */
export interface CoreConfigEntry {
  key: string;
  value: string | null;
  localValue: string | null;
}

/** 读单个配置键；未设置（git 退出码 1）返回 null，其他退出码继续抛。
 *  local=true 时只读仓库级（--local）作用域，否则取合并所有作用域的生效值。 */
async function readOneKey(cwd: string, key: string, local: boolean): Promise<string | null> {
  const args = local ? ['config', '--local', '--get', key] : ['config', '--get', key];
  try {
    const { stdout } = await runGit(args, { cwd });
    return stdout.replace(/\r?\n$/, '');
  } catch (e) {
    if (e instanceof GitExitError && e.exitCode === 1) return null; // 键未设置
    throw e;
  }
}

/** 批量读取配置键：value 为生效值，localValue 为仓库级值；逐键并行查询。 */
export async function getGitConfigEntries(cwd: string, keys: string[]): Promise<CoreConfigEntry[]> {
  return Promise.all(
    keys.map(async (key) => {
      const [value, localValue] = await Promise.all([
        readOneKey(cwd, key, false),
        readOneKey(cwd, key, true),
      ]);
      return { key, value, localValue };
    }),
  );
}

/** 写仓库级配置值。 */
export async function setGitConfigLocal(cwd: string, key: string, value: string): Promise<void> {
  await runGit(['config', '--local', key, value], { cwd });
}
