/**
 * refs 指纹快照原语：refs/heads + refs/remotes + refs/tags + refs/stash 的
 * refname→objectname 全量快照 + 聚合指纹 + 两快照 diff。
 * watcher（refs.changed 事件，Task 3）与 fetchRemote 的 updatedRefs（Task 2）共用本原语，
 * 保证「fetch 看到的引用移动」与「watcher 报出的引用变化」同源同判。
 */
import { createHash } from 'node:crypto';
import { runGit } from './exec';

export interface RefsSnapshot {
  /** 聚合指纹：refname+objectname 按 refname 排序拼接后取 sha1 前 16 位（顺序稳定） */
  fingerprint: string;
  /** refname → objectname 全量映射 */
  refs: Record<string, string>;
}

/** 指纹覆盖的引用命名空间（refs/stash 入列：贮藏变化也要产生指纹差） */
const REF_NAMESPACES = ['refs/heads', 'refs/remotes', 'refs/tags', 'refs/stash'];

/** 取当前 refs 快照：for-each-ref 一次取全部命名空间，NUL 分隔 refname/objectname（任意引用名安全） */
export async function takeRefsSnapshot(cwd: string): Promise<RefsSnapshot> {
  const { stdout } = await runGit(['for-each-ref', '--format=%(refname)%00%(objectname)', ...REF_NAMESPACES], { cwd });
  const refs: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    if (line === '') continue;
    const sep = line.indexOf('\0');
    refs[line.slice(0, sep)] = line.slice(sep + 1);
  }
  const hash = createHash('sha1');
  for (const name of Object.keys(refs).sort()) {
    hash.update(name).update('\0').update(refs[name]).update('\n');
  }
  return { fingerprint: hash.digest('hex').slice(0, 16), refs };
}

/** 两快照 diff：值变化 / 新增 / 删除的 refname 列表（排序返回，顺序稳定） */
export function diffRefsSnapshots(prev: RefsSnapshot, next: RefsSnapshot): string[] {
  const changed: string[] = [];
  for (const name of Object.keys(next.refs)) {
    if (prev.refs[name] !== next.refs[name]) changed.push(name);
  }
  for (const name of Object.keys(prev.refs)) {
    if (!(name in next.refs)) changed.push(name);
  }
  return changed.sort();
}
