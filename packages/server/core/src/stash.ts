/**
 * stash 原语：贮藏列表/保存/应用/弹出/删除/转分支。
 * 列表用 NUL 分隔字段安全解析；stash@{n} 引用写作单参数，数组传参无注入面。
 */
import { runGit } from './exec';

export interface CoreStash {
  index: number;
  hash: string;
  message: string;
  dateIso: string;
}

/** 贮藏列表：git stash list --format=%H%x00%gs%x00%cI（NUL 分隔字段安全解析）；无贮藏返回 []（git 输出为空串） */
export async function listStashes(cwd: string): Promise<CoreStash[]> {
  const { stdout } = await runGit(['stash', 'list', '--format=%H%x00%gs%x00%cI'], { cwd });
  const out = stdout.trimEnd();
  if (out === '') return [];
  // 每行 <hash>\x00<gs 消息>\x00<dateIso>；%gs 来自用户提交信息，NUL 分隔保证安全解析
  return out.split('\n').map((line, index) => {
    const [hash, message, dateIso] = line.split('\x00');
    return { index, hash, message, dateIso };
  });
}

/** 保存贮藏：git stash push [-u] [-m message]；无改动时 git 输出 'No local changes to save'（退出码 0）——api 层据此映射 INVALID_QUERY，core 原样透传 */
export async function saveStash(cwd: string, opts: { message?: string; includeUntracked?: boolean }): Promise<void> {
  const args = ['stash', 'push'];
  if (opts.includeUntracked) args.push('-u');
  if (opts.message !== undefined) args.push('-m', opts.message);
  await runGit(args, { cwd });
}

export async function applyStash(cwd: string, index: number): Promise<void> {
  await runGit(['stash', 'apply', `stash@{${index}}`], { cwd });
}

export async function popStash(cwd: string, index: number): Promise<void> {
  await runGit(['stash', 'pop', `stash@{${index}}`], { cwd });
}

export async function dropStash(cwd: string, index: number): Promise<void> {
  await runGit(['stash', 'drop', `stash@{${index}}`], { cwd });
}

/** 贮藏转为新分支：git stash branch <name> stash@{n}（成功即应用并删除该贮藏） */
export async function stashToBranch(cwd: string, index: number, name: string): Promise<void> {
  await runGit(['stash', 'branch', name, `stash@{${index}}`], { cwd });
}
