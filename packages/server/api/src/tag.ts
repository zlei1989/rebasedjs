/** 标签功能：列表 + 写操作分派（create/delete/push/pushAll/deleteRemote）。
 * 预检语义与远程 CRUD 对齐：create 重名 → INVALID_QUERY；delete/push 不存在 → INVALID_REF；
 * 传输操作复用 remote.ts 的 withAuth 认证回路（无 token 时注入为空，等价于原样推送）。 */
import { createTag, deleteRemoteTag, deleteTag, listTags, pushAllTags, pushTag } from '@rebased/core';
import { ServiceError } from '@rebased/contracts';
import type { TagAction, TagList } from '@rebased/contracts';
import { withAuth } from './remote';

/** 标签列表：core 形状与契约一致，直接包一层视图 */
export async function getTags(repoPath: string): Promise<TagList> {
  return { tags: await listTags(repoPath) };
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
    case 'push':
      if (!names.has(action.name)) {
        throw new ServiceError('INVALID_REF', `标签不存在：${action.name}`, { context: { name: action.name } });
      }
      // 推送结果三态（pushed/up-to-date/rejected）对端点仅以刷新列表表达，非错误
      await withAuth(repoPath, action.remote, (extraConfig) =>
        pushTag(repoPath, { name: action.name, remote: action.remote, extraConfig }),
      );
      break;
    case 'pushAll':
      // 推送全部本地标签（不预检单个标签；无远程由 git 报错透出）
      await withAuth(repoPath, action.remote, (extraConfig) =>
        pushAllTags(repoPath, { remote: action.remote, extraConfig }),
      );
      break;
    case 'deleteRemote':
      // 删除远程标签：push 空 ref（同样经认证回路；远程名缺省 origin 语义由调用方给定）
      await withAuth(repoPath, action.remote, (extraConfig) =>
        deleteRemoteTag(repoPath, { name: action.name, remote: action.remote, extraConfig }),
      );
      break;
  }
  return getTags(repoPath);
}
