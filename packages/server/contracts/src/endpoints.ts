/**
 * 端点入参 schema：路由/服务层用 zod 校验 HTTP 查询与请求体，解析结果即类型。
 * 查询参数走字符串，故数值用 coerce 宽容转换；布尔不用 coerce（'false' 会被当成 true），见 diffQuerySchema.staged。
 */
import { z } from 'zod';
import { CONFIG_KEYS } from './domain';

export const openRepoBodySchema = z.object({ path: z.string().min(1) });
export type OpenRepoBody = z.infer<typeof openRepoBodySchema>;

/** 初始化仓库：path 为索引目录（git init 的目录参数，不存在时创建） */
export const initRepoBodySchema = z.object({ path: z.string().min(1) });
export type InitRepoBody = z.infer<typeof initRepoBodySchema>;

/** 克隆仓库：url 为远端地址（https/ssh/本地路径）；targetDir 为落盘目录（父目录须存在，git clone 语义） */
export const cloneRepoBodySchema = z.object({ url: z.string().min(1), targetDir: z.string().min(1) });
export type CloneRepoBody = z.infer<typeof cloneRepoBodySchema>;

export const logQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  skip: z.coerce.number().int().min(0).default(0),
  author: z.string().optional(),
  path: z.string().optional(),
  /** range 过滤（如 'src..main'，git log <range> 语义——分支对比视图用） */
  range: z.string().optional(),
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

/** 三版本对比查询：file 必填（HEAD / 暂存区 / 工作区 三侧全文，GitStageCompareThreeVersionsAction 语义） */
export const threeWayQuerySchema = z.object({ file: z.string().min(1) });
export type ThreeWayQuery = z.infer<typeof threeWayQuerySchema>;

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

/** 提交请求体：message 必填；amend 改上次提交；signOff 追加 Signed-off-by；noVerify 跳过 hooks；
 *  crlfFix = CRLF 提示（GitCrlfDialog 修复并提交）：先写 core.autocrlf 建议值再提交 */
export const commitBodySchema = z.object({
  message: z.string().min(1),
  amend: z.boolean().optional(),
  signOff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
  crlfFix: z.boolean().optional(),
});
export type CommitBody = z.infer<typeof commitBodySchema>;

/** amend 指定历史提交（GitCommitDialog「Amend <subject>」下拉语义 #41 功能点）：targetHash 目标提交；message 为重写后的提交信息（reword） */
export const amendSpecificBodySchema = z.object({
  targetHash: z.string().min(1),
  message: z.string().min(1),
});
export type AmendSpecificBody = z.infer<typeof amendSpecificBodySchema>;

/** auto-squash（GitCommitFixupBySubjectAction/GitCommitSquashBySubjectAction 语义）：hash 目标提交；
 *  action 决定提交信息前缀（fixup! / squash!）——服务端构造并以 rebase -i --autosquash 折入 */
export const autosquashBodySchema = z.object({
  hash: z.string().min(1),
  action: z.enum(['fixup', 'squash']),
});
export type AutosquashBody = z.infer<typeof autosquashBodySchema>;

/** 单提交编辑直通（GitSingleCommitEditingAction 语义）：reword 重写提交信息（message 必填）、drop 删除提交、
 *  squash/fixup 并入父提交；经交互式变基执行 */
export const commitEditBodySchema = z.object({
  hash: z.string().min(1),
  action: z.enum(['reword', 'drop', 'squash', 'fixup']),
  message: z.string().optional(),
});
export type CommitEditBody = z.infer<typeof commitEditBodySchema>;

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

/** 贮藏操作（判别联合）：save 保存当前工作区（includeUntracked 对应 -u；keepIndex 对应 --keep-index）；apply/pop/drop 按 index；branch 把贮藏转为新分支（git stash branch） */
export const stashActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), message: z.string().optional(), includeUntracked: z.boolean().optional(), keepIndex: z.boolean().optional() }),
  z.object({ action: z.literal('apply'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('pop'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('drop'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('branch'), index: z.number().int().min(0), name: z.string().min(1) }),
]);
export type StashAction = z.infer<typeof stashActionSchema>;

/** Unstash As：把贮藏应用（apply，不 drop）到已有分支——先检出目标分支再应用（GitUnstashAsDialog 语义） */
export const stashUnstashAsBodySchema = z.object({ index: z.number().int().min(0), branch: z.string().min(1) });
export type StashUnstashAsBody = z.infer<typeof stashUnstashAsBodySchema>;

/** 贮藏索引路径参数：非负整数（stash@{n} 序号） */
export const stashIndexSchema = z.object({ index: z.coerce.number().int().min(0) });
export type StashIndex = z.infer<typeof stashIndexSchema>;

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

/** push 请求体：forceWithLease 为安全强推（--force-with-lease）；setUpstream 对应 -u；
 *  hash = Push up to Commit（GitPushUpToCommitAction 语义：refspec <hash>:<当前分支>——远端分支推到该提交，与 setUpstream 互斥） */
export const pushBodySchema = z
  .object({
    remote: z.string().optional(),
    branch: z.string().optional(),
    hash: z.string().min(1).optional(),
    forceWithLease: z.boolean().optional(),
    setUpstream: z.boolean().optional(),
  })
  .refine((b) => b.hash === undefined || b.setUpstream !== true, {
    message: 'Push up to Commit 不支持 setUpstream（-u 只能设分支引用）',
  });
export type PushBody = z.infer<typeof pushBodySchema>;

/** commit & push 组合执行器载荷：提交体 + 可选推送体（push 缺省=当前分支上游——GitCommitAndPushExecutor 语义） */
export const commitAndPushBodySchema = commitBodySchema.extend({
  push: pushBodySchema.optional(),
});
export type CommitAndPushBody = z.infer<typeof commitAndPushBodySchema>;

/** Update Project 请求体：strategy 决定 fetch 后的合并方式（merge | rebase） */
export const updateBodySchema = z.object({ strategy: z.enum(['merge', 'rebase']) });
export type UpdateBody = z.infer<typeof updateBodySchema>;

/** rebase 请求体：onto 为变基目标（提交/分支/HEAD~n 表达式）；branch 缺省为当前分支 */
export const rebaseBodySchema = z.object({ onto: z.string().min(1), branch: z.string().optional() });
export type RebaseBody = z.infer<typeof rebaseBodySchema>;

/** 交互式变基 todo 查询：base 为待编辑提交区间的基线（base..HEAD 全量重演） */
export const rebaseTodoQuerySchema = z.object({ base: z.string().min(1) });

/** 交互式变基请求体：entries 为按顺序编辑后的 todo 全量清单（至少 1 条）；action 枚举同 todo 可用命令 */
export const interactiveRebaseBodySchema = z.object({
  base: z.string().min(1),
  entries: z.array(z.object({
    hash: z.string().min(1),
    action: z.enum(['pick', 'reword', 'squash', 'fixup', 'drop']),
  })).min(1),
});
export type InteractiveRebaseBody = z.infer<typeof interactiveRebaseBodySchema>;

/** 摘樱桃/还原请求体：hashes 为提交哈希列表（至少 1 个） */
export const pickBodySchema = z.object({ hashes: z.array(z.string().min(1)).min(1) });
export type PickBody = z.infer<typeof pickBodySchema>; // cherry-pick 与 revert 共用

/** 标签写操作（判别联合）：create 可带 ref（默认 HEAD）与 message（附注标签）；delete 删除本地；push 推送单个；pushAll 推送全部；deleteRemote 删除远程 */
export const tagActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().min(1), ref: z.string().optional(), message: z.string().optional() }),
  z.object({ action: z.literal('delete'), name: z.string().min(1) }),
  z.object({ action: z.literal('push'), name: z.string().min(1), remote: z.string().optional() }),
  z.object({ action: z.literal('pushAll'), remote: z.string().optional() }),
  z.object({ action: z.literal('deleteRemote'), name: z.string().min(1), remote: z.string().optional() }),
]);
export type TagAction = z.infer<typeof tagActionSchema>;

/** 溯源查询：file 必填（相对仓库根路径）；rev 可选（指定版本溯源——Annotate Revision 语义） */
export const blameQuerySchema = z.object({ file: z.string().min(1), rev: z.string().optional() });
export type BlameQuery = z.infer<typeof blameQuerySchema>;

/** 文件历史查询：file 必填（git log --follow 跟随重命名） */
export const historyQuerySchema = z.object({ file: z.string().min(1) });

/** 历史快照浏览（BrowsePanel）查询：rev 为任意 tree-ish（提交/分支/标签） */
export const browseQuerySchema = z.object({ rev: z.string().min(1) });

/** 历史快照文件内容查询：rev 为 tree-ish；file 为该版本内相对路径（必填） */
export const browseContentQuerySchema = z.object({ rev: z.string().min(1), file: z.string().min(1) });
export type BrowseContentQuery = z.infer<typeof browseContentQuerySchema>;

/** Committed Changes 分页查询：limit≤200、skip 游标（沿用 log 端点先例） */
export const committedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});
export type CommittedPageQuery = z.infer<typeof committedQuerySchema>;

/** 提交搜索查询：q 必填；mode 默认 grep；limit≤100 */
export const searchQuerySchema = z.object({
  q: z.string().min(1),
  mode: z.enum(['grep', 'pickaxe']).default('grep'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const patchCreateBodySchema = z
  .object({
    name: z.string().min(1).regex(/^[\w.-]+$/),
    from: z.string().optional(), to: z.string().optional(), staged: z.boolean().optional(),
    /** 指定文件集（StatusPage「Create Patch from changes」语义）：仅工作区/staged 模式生效，与 from/to 互斥 */
    paths: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((b) => b.paths === undefined || (b.from === undefined && b.to === undefined), {
    message: 'paths 与 from/to 互斥',
  });
export type PatchCreateBody = z.infer<typeof patchCreateBodySchema>;
export const patchApplyBodySchema = z.object({ name: z.string().min(1) });
export type PatchApplyBody = z.infer<typeof patchApplyBodySchema>;
export const patchDeleteBodySchema = z.object({ name: z.string().min(1) });
export type PatchDeleteBody = z.infer<typeof patchDeleteBodySchema>;
/** 导入补丁为搁置：路径参数 name（ImportIntoShelfAction 语义——补丁全文以同名搁置存档） */
export const patchImportShelfSchema = z.object({ name: z.string().min(1) });
export type PatchImportShelf = z.infer<typeof patchImportShelfSchema>;
export const shelfActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), name: z.string().min(1).regex(/^[\w.-]+$/) }),
  z.object({ action: z.literal('restore'), name: z.string().min(1) }),
  z.object({ action: z.literal('drop'), name: z.string().min(1) }),
]);
export type ShelfAction = z.infer<typeof shelfActionSchema>;
export const consoleQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });
export type ConsoleQuery = z.infer<typeof consoleQuerySchema>;
export const ignorePutBodySchema = z.object({ target: z.enum(['gitignore', 'exclude']), content: z.string().max(200_000) });
export type IgnorePutBody = z.infer<typeof ignorePutBodySchema>;
export const ignoreAddBodySchema = z.object({ path: z.string().min(1) });
export type IgnoreAddBody = z.infer<typeof ignoreAddBodySchema>;

/** GitHub PR 列表查询：state=all 为打开+关闭全量；缺省 open（沿用查询参数走字符串的惯例，但 enum 无需 coerce） */
export const githubPrQuerySchema = z.object({ state: z.enum(['open', 'closed', 'all']).default('open') });
export type GitHubPrQuery = z.infer<typeof githubPrQuerySchema>;
/** PR 编号路径参数：正整数（PR 编号无 0/负数），字符串数字被 coerce */
export const githubPrNumberSchema = z.object({ number: z.coerce.number().int().positive() });
export type GitHubPrNumber = z.infer<typeof githubPrNumberSchema>;
/** PR 评论请求体：body 非空且 ≤10_000 字符（GitHub API 上限） */
export const githubCommentBodySchema = z.object({ body: z.string().min(1).max(10_000) });
export type GitHubCommentBody = z.infer<typeof githubCommentBodySchema>;
/** PR review 请求体：event 三选；body 可选（与 event 无组合约束，放宽校验）且 ≤10_000 */
export const githubReviewBodySchema = z.object({ event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']), body: z.string().max(10_000).optional() });
export type GitHubReviewBody = z.infer<typeof githubReviewBodySchema>;
/** PR 合并请求体：method 对应 GitHub API merge_method（merge/squash/rebase） */
export const githubMergeBodySchema = z.object({ method: z.enum(['merge', 'squash', 'rebase']) });
export type GitHubMergeBody = z.infer<typeof githubMergeBodySchema>;

/** 行级评审评论请求体：path 文件相对路径；line 该侧文件行号（正整数）；side 默认 RIGHT（新侧锚定是本产品录入口径，LEFT 仅供测试/兼容）；body 非空且 ≤10_000 */
export const githubReviewCommentBodySchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  side: z.enum(['LEFT', 'RIGHT']).default('RIGHT'),
  body: z.string().min(1).max(10_000),
});
export type GitHubReviewCommentBody = z.infer<typeof githubReviewCommentBodySchema>;

/** MR 行级讨论请求体：path 文件相对路径；line 新侧行号（GitLab position.new_line）；body 非空且 ≤10_000 */
export const gitlabDiscussionBodySchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  body: z.string().min(1).max(10_000),
});
export type GitLabDiscussionBody = z.infer<typeof gitlabDiscussionBodySchema>;

/** GitLab MR 列表查询：state=all 为全量；缺省 opened（查询参数走字符串，enum 无需 coerce） */
export const gitlabMrQuerySchema = z.object({ state: z.enum(['opened', 'closed', 'merged', 'locked', 'all']).default('opened') });
export type GitLabMrQuery = z.infer<typeof gitlabMrQuerySchema>;
/** MR iid 路径参数：正整数（iid 无 0/负数），字符串数字被 coerce */
export const gitlabMrIidSchema = z.object({ iid: z.coerce.number().int().positive() });
export type GitLabMrIid = z.infer<typeof gitlabMrIidSchema>;
/** 创建 MR 请求体：sourceBranch/targetBranch/title 必填；title ≤255（GitLab 标题上限）；description 可选且 ≤20_000（GitLab 描述上限） */
export const gitlabMrCreateBodySchema = z.object({ sourceBranch: z.string().min(1), targetBranch: z.string().min(1), title: z.string().min(1).max(255), description: z.string().max(20_000).optional() });
export type GitLabMrCreateBody = z.infer<typeof gitlabMrCreateBodySchema>;
/** MR 评论请求体：body 非空且 ≤10_000 字符（GitLab API 上限） */
export const gitlabCommentBodySchema = z.object({ body: z.string().min(1).max(10_000) });
export type GitLabCommentBody = z.infer<typeof gitlabCommentBodySchema>;
/** MR review 请求体：event 三选；body 可选（与 event 无组合约束，放宽校验）且 ≤10_000 */
export const gitlabReviewBodySchema = z.object({ event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']), body: z.string().max(10_000).optional() });
export type GitLabReviewBody = z.infer<typeof gitlabReviewBodySchema>;
/** MR 合并请求体：squash 对应 squash 合并，可选 */
export const gitlabMergeBodySchema = z.object({ squash: z.boolean().optional() });
export type GitLabMergeBody = z.infer<typeof gitlabMergeBodySchema>;

/** worktree 创建请求体：path 必填；branch 检出既有分支、newBranch 新建并检出（二者互斥归服务层校验，schema 只测形状） */
export const worktreeCreateBodySchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1).optional(),
  newBranch: z.string().min(1).optional(),
});
export type WorktreeCreateBody = z.infer<typeof worktreeCreateBodySchema>;
/** worktree 删除请求体：force 对应 git worktree remove --force（有未合并检出时强删） */
export const worktreeRemoveBodySchema = z.object({ path: z.string().min(1), force: z.boolean().optional() });
export type WorktreeRemoveBody = z.infer<typeof worktreeRemoveBodySchema>;
/** submodule 更新请求体：name 指定子模块（缺省全量）；recursive 递归更新子模块的子模块 */
export const submoduleUpdateBodySchema = z.object({ name: z.string().min(1).optional(), recursive: z.boolean().optional() });
export type SubmoduleUpdateBody = z.infer<typeof submoduleUpdateBodySchema>;
