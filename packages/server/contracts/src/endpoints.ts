/**
 * 端点入参 schema：路由/服务层用 zod 校验 HTTP 查询与请求体，解析结果即类型。
 * 查询参数走字符串，故数值用 coerce 宽容转换；布尔不用 coerce（'false' 会被当成 true），见 diffQuerySchema.staged。
 */
import { z } from 'zod';
import { CONFIG_KEYS } from './domain';

export const openRepoBodySchema = z.object({ path: z.string().min(1) });
export type OpenRepoBody = z.infer<typeof openRepoBodySchema>;

export const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  author: z.string().optional(),
  path: z.string().optional(),
});
export type LogQuery = z.infer<typeof logQuerySchema>;

export const diffQuerySchema = z.object({
  file: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
  // 查询串布尔：z.coerce.boolean() 会把 'false' 当成 true（Boolean('false')），
  // 故显式枚举 'true'/'false' 转换；同时兼容内部调用直接传 boolean
  staged: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).default(false),
});
export type DiffQuery = z.infer<typeof diffQuerySchema>;

export const settingsPatchSchema = z.object({
  logInEditor: z.boolean().optional(),
  recentRepoIds: z.array(z.string()).optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

/** 配置写请求体：键限白名单；值为字符串（布尔类键由调用方传 'true'/'false' 等 git 原样接受） */
export const configPutBodySchema = z.object({
  key: z.enum(CONFIG_KEYS),
  value: z.string().min(1).max(500),
});
export type ConfigPutBody = z.infer<typeof configPutBodySchema>;

/** 暂存区文件级操作：stage=加入暂存（git add）；unstage=移出暂存（git restore --staged）；discard=放弃修改（按条目状态分派 restore/clean） */
export const stagingBodySchema = z.object({
  action: z.enum(['stage', 'unstage', 'discard']),
  paths: z.array(z.string().min(1)).min(1),
});
export type StagingBody = z.infer<typeof stagingBodySchema>;

/** hunk 级操作：hunks 为 GET diff/patch 返回全文的 hunk 索引（0-based，按出现顺序） */
export const hunkStagingBodySchema = z.object({
  action: z.enum(['stage', 'unstage', 'discard']),
  file: z.string().min(1),
  hunks: z.array(z.number().int().min(0)).min(1),
});
export type HunkStagingBody = z.infer<typeof hunkStagingBodySchema>;

/** 提交请求体：message 必填；amend 改上次提交；signOff 追加 Signed-off-by；noVerify 跳过 hooks */
export const commitBodySchema = z.object({
  message: z.string().min(1),
  amend: z.boolean().optional(),
  signOff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
});
export type CommitBody = z.infer<typeof commitBodySchema>;

/** 分支写操作（判别联合）：create 可带 startPoint；delete 的 force 对应 git branch -D；rename 改名；setUpstream 设置上游 */
export const branchActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().min(1), startPoint: z.string().optional() }),
  z.object({ action: z.literal('delete'), name: z.string().min(1), force: z.boolean().optional() }),
  z.object({ action: z.literal('rename'), oldName: z.string().min(1), newName: z.string().min(1) }),
  z.object({ action: z.literal('setUpstream'), name: z.string().min(1), upstream: z.string().min(1) }),
]);
export type BranchAction = z.infer<typeof branchActionSchema>;

/** 检出操作：branch=既有分支；newBranch=新建并检出（可带 startPoint）；detach=detached 检出标签/提交 */
export const checkoutActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('branch'), name: z.string().min(1) }),
  z.object({ action: z.literal('newBranch'), name: z.string().min(1), startPoint: z.string().optional() }),
  z.object({ action: z.literal('detach'), ref: z.string().min(1) }),
]);
export type CheckoutAction = z.infer<typeof checkoutActionSchema>;

/** Reset 请求体：ref 为目标引用（提交哈希/分支/HEAD~n 表达式）；mode 三选（对照 Java GitNewResetDialog：soft 仅移 HEAD、mixed 重置暂存区、hard 连工作区一起重置） */
export const resetBodySchema = z.object({
  ref: z.string().min(1),
  mode: z.enum(['soft', 'mixed', 'hard']),
});
export type ResetBody = z.infer<typeof resetBodySchema>;

/** 合并请求体：对照 Java GitMergeDialog 选项（no-ff 禁用快进、squash 压缩、no-commit 不自动提交、message 合并信息） */
export const mergeBodySchema = z.object({
  branch: z.string().min(1),
  noFf: z.boolean().optional(),
  squash: z.boolean().optional(),
  noCommit: z.boolean().optional(),
  message: z.string().optional(),
});
export type MergeBody = z.infer<typeof mergeBodySchema>;

/** 冲突解决：ours/theirs 整侧采纳；manual 由 MergeView 保存合并结果全文；delete 以删除解决删除/修改冲突（对照 Java GitConflictsPanel 的采纳即删除映射） */
export const resolveConflictBodySchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('ours'), path: z.string().min(1) }),
  z.object({ strategy: z.literal('theirs'), path: z.string().min(1) }),
  z.object({ strategy: z.literal('manual'), path: z.string().min(1), content: z.string() }),
  z.object({ strategy: z.literal('delete'), path: z.string().min(1) }),
]);
export type ResolveConflictBody = z.infer<typeof resolveConflictBodySchema>;

/** 贮藏操作（判别联合）：save 保存当前工作区（includeUntracked 对应 -u）；apply/pop/drop 按 index；branch 把贮藏转为新分支（git stash branch） */
export const stashActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), message: z.string().optional(), includeUntracked: z.boolean().optional() }),
  z.object({ action: z.literal('apply'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('pop'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('drop'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('branch'), index: z.number().int().min(0), name: z.string().min(1) }),
]);
export type StashAction = z.infer<typeof stashActionSchema>;

/** 变更列表操作（判别联合）：move 把 paths 移入 targetId；delete 的文件归入默认列表；默认列表不可删除（api 层拒绝） */
export const changelistActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().min(1) }),
  z.object({ action: z.literal('rename'), id: z.string().min(1), name: z.string().min(1) }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
  z.object({ action: z.literal('setDefault'), id: z.string().min(1) }),
  z.object({ action: z.literal('move'), paths: z.array(z.string().min(1)).min(1), targetId: z.string().min(1) }),
]);
export type ChangelistAction = z.infer<typeof changelistActionSchema>;

/** 冲突内容查询：path 必填 */
export const conflictContentsQuerySchema = z.object({ path: z.string().min(1) });
export type ConflictContentsQuery = z.infer<typeof conflictContentsQuerySchema>;

/** 添加/覆盖账户：host 为主机名（如 github.com、gitlab.example.com）；token 写入端一次性接收，之后只读掩码 */
export const accountBodySchema = z.object({
  host: z.string().min(1),
  account: z.string().min(1),
  token: z.string().min(1),
});
export type AccountBody = z.infer<typeof accountBodySchema>;

/** 删除账户 */
export const accountDeleteBodySchema = z.object({
  host: z.string().min(1),
  account: z.string().min(1),
});
export type AccountDeleteBody = z.infer<typeof accountDeleteBodySchema>;

/** 远程写操作（判别联合）：add 新增；remove 删除；setUrl 同时改写 fetch/push URL */
export const remoteActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: z.string().min(1), url: z.string().min(1) }),
  z.object({ action: z.literal('remove'), name: z.string().min(1) }),
  z.object({ action: z.literal('setUrl'), name: z.string().min(1), url: z.string().min(1) }),
]);
export type RemoteAction = z.infer<typeof remoteActionSchema>;

/** fetch 请求体：remote 缺省表示全部远程 */
export const fetchBodySchema = z.object({ remote: z.string().optional() });
export type FetchBody = z.infer<typeof fetchBodySchema>;

/** pull 请求体：remote 缺省取当前分支上游；rebase 对应 git pull --rebase */
export const pullBodySchema = z.object({ remote: z.string().optional(), rebase: z.boolean().optional() });
export type PullBody = z.infer<typeof pullBodySchema>;

/** push 请求体：forceWithLease 为安全强推（--force-with-lease）；setUpstream 对应 -u */
export const pushBodySchema = z.object({
  remote: z.string().optional(),
  branch: z.string().optional(),
  forceWithLease: z.boolean().optional(),
  setUpstream: z.boolean().optional(),
});
export type PushBody = z.infer<typeof pushBodySchema>;

/** Update Project 请求体：strategy 决定 fetch 后的合并方式（merge | rebase） */
export const updateBodySchema = z.object({ strategy: z.enum(['merge', 'rebase']) });
export type UpdateBody = z.infer<typeof updateBodySchema>;
