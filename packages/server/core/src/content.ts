/** 文件内容原语：工作区直读、指定 rev 经 git show、'' 表示暂存区。
 *  仅面向文本文件（P1 约定）；二进制文件返回原始字节转 utf8，上层按需处理。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './exec';

export async function readFileAtRev(repoPath: string, opts: { file: string; rev?: string }): Promise<string> {
  if (opts.rev === undefined) {
    return readFileSync(join(repoPath, opts.file), 'utf8');
  }
  const { stdout } = await runGit(['show', `${opts.rev}:${opts.file}`], { cwd: repoPath });
  return stdout;
}
