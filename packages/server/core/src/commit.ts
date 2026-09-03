/** 提交原语：提交暂存区内容并返回新提交哈希。 */
import { runGit } from './exec';

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
