/**
 * tag 原语：列表、创建（轻量/附注）、删除、推送。
 * push 的状态分类沿用 pushBranch 模式（'Everything up-to-date' 双流探测 / stderr 固定英文特征），
 * 并以 P3-A 的 120s 传输超时兜底（防网络停滞类挂起，见 remote.ts 同款注释）。
 */
import { GitExitError, runGit } from './exec';
import { defaultRemoteName } from './remote';

export interface CoreTag {
  name: string;
  hash: string;
  subject: string | null;
  annotated: boolean;
}

/** 传输操作统一超时兜底（与 remote.ts 同源策略）：120s */
const TRANSFER_TIMEOUT_MS = 120_000;

/** 解析缺省远程名；解析不到时抛可读中文错误（避免落到 git 的「refspec 当仓库地址」报错） */
async function requireDefaultRemote(cwd: string, what: string): Promise<string> {
  const remote = await defaultRemoteName(cwd);
  if (remote === undefined) {
    throw new Error(`仓库未配置远程，无法${what}`);
  }
  return remote;
}

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
  // remote 缺省时按 defaultRemoteName 解析：不点名远程时 git 会把 refspec 当仓库地址
  // （`fatal: 'refs/tags/x' does not appear to be a git repository`，当前分支无上游时必现——D-26/D-27）
  const remote = opts.remote ?? (await requireDefaultRemote(cwd, `推送标签 ${opts.name}`));
  const args = ['push', remote, `refs/tags/${opts.name}`];
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

/**
 * 推送全部标签：git push [remote] --tags。
 * 状态分类与 pushTag 同源（'Everything up-to-date' 双流探测；rejected 特征含 'already exists'）。
 */
export async function pushAllTags(
  cwd: string,
  opts: { remote?: string; extraConfig?: string[] },
): Promise<{ status: 'pushed' | 'rejected' | 'up-to-date' }> {
  const remote = opts.remote ?? (await requireDefaultRemote(cwd, '推送全部标签'));
  const args = ['push', remote, '--tags'];
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

/**
 * 删除远程标签：git push <remote> --delete refs/tags/<name>（push 空 ref 即删除对端标签）。
 * remote 缺省时按 defaultRemoteName 解析（分支上游 → origin → 唯一远程），解析不到则给可读报错——
 * 不能让 git 把 `:refs/tags/<name>` 当仓库地址（D-26：报成 `ssh: connect to host  port 22`）。
 * 远程不存在/认证失败原样抛 GitExitError（api 层 withAuth 认证回路处理）。
 */
export async function deleteRemoteTag(
  cwd: string,
  opts: { name: string; remote?: string; extraConfig?: string[] },
): Promise<void> {
  const remote = opts.remote ?? (await requireDefaultRemote(cwd, `删除远程标签 ${opts.name}`));
  await runGit(['push', remote, '--delete', `refs/tags/${opts.name}`], {
    cwd,
    extraConfig: opts.extraConfig,
    timeoutMs: TRANSFER_TIMEOUT_MS,
  });
}
