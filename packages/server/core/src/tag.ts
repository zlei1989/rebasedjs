/**
 * tag 原语：列表、创建（轻量/附注）、删除、推送。
 * push 的状态分类沿用 pushBranch 模式（'Everything up-to-date' 双流探测 / stderr 固定英文特征），
 * 并以 P3-A 的 120s 传输超时兜底（防网络停滞类挂起，见 remote.ts 同款注释）。
 */
import { GitExitError, runGit } from './exec';

export interface CoreTag {
  name: string;
  hash: string;
  subject: string | null;
  annotated: boolean;
}

/** 传输操作统一超时兜底（与 remote.ts 同源策略）：120s */
const TRANSFER_TIMEOUT_MS = 120_000;

/**
 * 标签列表：git for-each-ref --format=%(refname:short)%00%(objectname)%00%(subject)%00%(objecttype) refs/tags。
 * 记录为 "<name>\0<hash>\0<subject>\0<type>\n"（NUL 分隔字段、行分隔记录）；
 * annotated = objecttype==='tag'（轻量为 'commit'，hash 即被指向提交）；
 * subject 为空（无消息的附注标签 / 空消息提交）归一为 null。
 */
export async function listTags(cwd: string): Promise<CoreTag[]> {
  const { stdout } = await runGit(
    ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(subject)%00%(objecttype)', 'refs/tags'],
    { cwd },
  );
  const tags: CoreTag[] = [];
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const fields = line.split('\0');
    if (fields.length < 4) continue;
    const [name, hash, subject, objectType] = fields;
    tags.push({ name, hash, subject: subject === '' ? null : subject, annotated: objectType === 'tag' });
  }
  return tags;
}

/** 创建标签：message 存在 → -a -m <message>（附注标签），否则轻量标签；ref 省略时指向 HEAD */
export async function createTag(cwd: string, opts: { name: string; ref?: string; message?: string }): Promise<void> {
  const args = ['tag'];
  if (opts.message !== undefined) args.push('-a');
  args.push(opts.name);
  if (opts.message !== undefined) args.push('-m', opts.message);
  if (opts.ref !== undefined) args.push(opts.ref);
  await runGit(args, { cwd });
}

/** 删除标签：git tag -d <name>；标签不存在由 git 报错透出（api 层预检） */
export async function deleteTag(cwd: string, name: string): Promise<void> {
  await runGit(['tag', '-d', name], { cwd });
}

/**
 * 推送标签：git push [remote] refs/tags/<name>（显式全 ref，杜绝分支/标签同名歧义）。
 * - 'up-to-date'：'Everything up-to-date'（版本间落 stdout/stderr 不一，两处都查）；
 * - 'rejected'：stderr 含 'rejected' 且 'already exists'（对端已有同名不同指向）；
 * - 其余失败（无远程、认证失败等）原样抛 GitExitError。
 */
export async function pushTag(
  cwd: string,
  opts: { name: string; remote?: string; extraConfig?: string[] },
): Promise<{ status: 'pushed' | 'rejected' | 'up-to-date' }> {
  const args = ['push'];
  if (opts.remote !== undefined) args.push(opts.remote);
  args.push(`refs/tags/${opts.name}`);
  try {
    const { stdout, stderr } = await runGit(args, {
      cwd,
      extraConfig: opts.extraConfig,
      timeoutMs: TRANSFER_TIMEOUT_MS,
    });
    return { status: stdout.includes('Everything up-to-date') || stderr.includes('Everything up-to-date') ? 'up-to-date' : 'pushed' };
  } catch (err) {
    if (err instanceof GitExitError && err.stderr.includes('rejected') && err.stderr.includes('already exists')) {
      return { status: 'rejected' };
    }
    throw err;
  }
}
