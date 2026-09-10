/** 标签功能：列表 + 写操作分派（create/delete/push/pushAll/deleteRemote）。
 * 预检语义与远程 CRUD 对齐：create 重名 → INVALID_QUERY；delete/push 不存在 → INVALID_REF；
 * 传输操作复用 remote.ts 的 withAuth 认证回路（无 token 时注入为空，等价于原样推送）。 */
import { createTag, defaultRemoteName, deleteRemoteTag, deleteTag, listTags, pushAllTags, pushTag } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { TagAction, TagList } from '@rebased/contracts';
import { withAuth } from './remote';

/** 标签列表：core 形状与契约一致，直接包一层视图 */
export async function getTags(repoPath: string): Promise<TagList> {
  return { tags: await listTags(repoPath) };
}

/** 解析本次传输的远程名：显式给定则原样用（存在性由 withAuth 预检为 INVALID_REF）；
 *  缺省按 defaultRemoteName（分支上游 → origin → 唯一远程），解析不到给可读 INVALID_QUERY——
 *  UI 的推送/删除远程一律不传 remote，不能让 git 落到「refspec 当仓库地址」的报错（D-26/D-27）。 */
async function resolveRemote(repoPath: string, requested: string | undefined, name: string): Promise<string> {
  if (requested !== undefined) return requested;
  const remote = await defaultRemoteName(repoPath);
  if (remote === undefined) {
    throw new ServiceError('INVALID_QUERY', '仓库未配置远程，无法执行标签传输操作', { context: { name } });
  }
  return remote;
}

/** 标签写操作分派：预检后执行 core 原语，操作完成后返回刷新列表 */
export async function applyTagAction(repoPath: string, action: TagAction): Promise<TagList> {
  const names = new Set((await listTags(repoPath)).map((t) => t.name));
  switch (action.action) {
    case 'create':
      if (names.has(action.name)) {
        throw new ServiceError('INVALID_QUERY', `标签已存在：${action.name}`, { context: { name: action.name } });
      }
      await createTag(repoPath, { name: action.name, ref: action.ref, message: action.message });
      break;
    case 'delete':
      if (!names.has(action.name)) {
        throw new ServiceError('INVALID_REF', `标签不存在：${action.name}`, { context: { name: action.name } });
      }
      await deleteTag(repoPath, action.name);
      break;
    case 'push': {
      if (!names.has(action.name)) {
        throw new ServiceError('INVALID_REF', `标签不存在：${action.name}`, { context: { name: action.name } });
      }
      // 远程名缺省时先解析（与 deleteRemote 同源）：不点名远程时 git 会把 refspec 当仓库地址
      // （当前分支无上游的仓库必现「'refs/tags/x' does not appear to be a git repository」——D-26/D-27）；
      // 解析结果同时交给 withAuth 以正确注入认证；推送三态（pushed/up-to-date/rejected）对端点仅以刷新列表表达，非错误
      const remote = await resolveRemote(repoPath, action.remote, action.name);
      await withAuth(repoPath, remote, (extraConfig) =>
        pushTag(repoPath, { name: action.name, remote, extraConfig }),
      );
      break;
    }
    case 'pushAll': {
      // 推送全部本地标签（不预检单个标签；无远程时 resolveRemote 给可读报错）
      const remote = await resolveRemote(repoPath, action.remote, '全部标签');
      await withAuth(repoPath, remote, (extraConfig) => pushAllTags(repoPath, { remote, extraConfig }));
      break;
    }
    case 'deleteRemote': {
      // 删除远程标签：必须点名远程（缺省按 defaultRemoteName 解析：分支上游 → origin → 唯一远程）。
      // 无显式远程时 git 会把 `:refs/tags/x` 当仓库地址解析（D-26），故此处先解析再交给 withAuth（认证注入也需远程名）。
      const remote = await resolveRemote(repoPath, action.remote, action.name);
      await withAuth(repoPath, remote, (extraConfig) =>
        deleteRemoteTag(repoPath, { name: action.name, remote, extraConfig }),
      );
      break;
    }
  }
  return getTags(repoPath);
}
