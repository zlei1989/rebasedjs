/** 跨端领域类型：服务层返回、UI 层消费的唯一形状来源。 */

export interface RepoInfo {
  id: string;
  path: string;
  name: string;
  openedAt: string;
}

/** 工作区变更条目（code 为 porcelain v2 XY 码，?? = 未跟踪，!! = 已忽略） */
export interface ChangeEntry {
  path: string;
  code: string;
  renameFrom?: string;
}

export interface RepoStatus {
  branch: string | null;
  upstream: string | null;
  /** HEAD 提交哈希：干净提交也会变化，是 events 推送（repo.state-changed）检测提交/检出的关键信号 */
  headHash: string | null;
  ahead: number;
  behind: number;
  entries: ChangeEntry[];
}

/** 提交节点：graph 为原始边列（--graph 前缀），布局算法在计划 2 的 ui/graph-layout 处理 */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  dateIso: string;
  refs: string[];
  message: string;
  graph: string;
}

export interface LogPage {
  commits: CommitInfo[];
  hasMore: boolean;
}

/** 单文件 diff：text 为 unified diff 全文（P1 不做 hunk 结构化） */
export interface DiffFile {
  path: string;
  text: string;
}

/** 单文件两侧全文（Monaco DiffEditor 用）：before=旧版本、after=新版本 */
export interface FileVersions {
  before: string;
  after: string;
}

/** 三版本对比（HEAD / 暂存区 / 工作区）：GitStageCompareThreeVersionsAction 语义——三侧全文一次取出 */
export interface FileThreeVersions {
  head: string;
  staged: string;
  working: string;
}

export interface SettingsState {
  logInEditor: boolean;
  recentRepoIds: string[];
}

export interface LogEvent {
  type: 'log.line';
  payload: CommitInfo;
}

export interface DiffEvent {
  type: 'diff.chunk';
  payload: { text: string };
}

/** git 配置白名单键：读写在契约层收敛，避免任意配置写风险
 *  （commit.gpgsign/user.signingkey/commit.template 由 git commit 原生消费——签名/模板链路随键配置生效） */
export const CONFIG_KEYS = [
  'user.name',
  'user.email',
  'core.autocrlf',
  'pull.rebase',
  'commit.gpgsign',
  'user.signingkey',
  'commit.template',
  'fetch.prune',
  'init.defaultBranch',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/** 单个配置键视图：value 为生效值（local>global>system 合并结果），localValue 为仓库级值；未设置均为 null */
export interface GitConfigEntry {
  key: ConfigKey;
  value: string | null;
  localValue: string | null;
}

/** 仓库 git 配置视图：固定覆盖 CONFIG_KEYS 全量键 */
export interface GitConfigView {
  entries: GitConfigEntry[];
}

/** 进行中操作种类 */
export type OperationKind = 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert';

/** 进行中操作状态：kind 为 none 时无其他字段；rebase 时 step/total 为进度（第 step/total 步） */
export interface OperationState {
  kind: OperationKind;
  step?: number;
  total?: number;
}

/** 分支条目：remote=true 为远程跟踪分支；current 仅本地分支可能为 true；mergedIntoHead 表示已合并入当前 HEAD */
export interface BranchRef {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hash: string;
  mergedIntoHead: boolean;
  lastCommitIso: string;
}

/** 分支列表视图 */
export interface BranchList {
  branches: BranchRef[];
}

/** 冲突条目：stages 为存在的阶段编号（1=base 共同祖先，2=ours 当前分支，3=theirs 合并来源）；组合即冲突类型（[1,2,3]=双方修改，[2,3]=双方新增，[1,2]=对方删除/我方修改，[1,3]=我方删除/对方修改） */
export interface ConflictEntry {
  path: string;
  stages: number[];
}
export interface ConflictList {
  conflicts: ConflictEntry[];
}

/** 冲突三版本内容：某阶段不存在为 null（如删除方） */
export interface ConflictContents {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

/** 贮藏条目：index 为 stash@{n} 序号（列表顺序即 git stash list 顺序）；hash 为贮藏提交哈希 */
export interface StashEntry {
  index: number;
  hash: string;
  message: string;
  dateIso: string;
}
export interface StashList {
  stashes: StashEntry[];
}
/** 贮藏差异：patch 为 git stash show -p 的 unified 补丁全文（空差异为 ''） */
export interface StashDiff {
  index: number;
  patch: string;
}

/** 变更列表（应用层簿记，git 无原生概念）：id 为生成的主键；isDefault 接收未分配路径 */
export interface Changelist {
  id: string;
  name: string;
  isDefault: boolean;
}
/** 变更列表视图：assignments 为 路径 → listId（仅含 status 现存路径，读取时已修剪失效条目） */
export interface ChangelistView {
  lists: Changelist[];
  assignments: Record<string, string>;
}

/** 合并结果：success=合并完成（含 squash/no-commit 未产提交）；conflicts=进入合并态待解决；up-to-date=已是最新 */
export interface MergeOutcome {
  status: 'success' | 'conflicts' | 'up-to-date';
  conflicts: ConflictEntry[];
}

/** 变基结果：success=变基完成；conflicts=进入变基冲突态待解决；up-to-date=已是最新 */
export interface RebaseOutcome {
  status: 'success' | 'conflicts' | 'up-to-date';
}

/** 摘樱桃/还原（cherry-pick/revert）结果：success=完成；conflicts=进入冲突态待解决 */
export interface PickOutcome {
  status: 'success' | 'conflicts';
}

/** 交互式变基 todo 条目：hash 为提交完整哈希；subject 为提交主题首行 */
export interface TodoEntry {
  hash: string;
  subject: string;
}

/** amend 目标候选（GitCommitDialog「Amend <subject>」下拉语义）：未发布（任一远程不可达）的非合并非 HEAD 提交；与 TodoEntry 同形 */
export type AmendTarget = TodoEntry;

/** 交互式变基 todo 动作：对应 git rebase -i 的可用命令 */
export type RebaseTodoAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';

/** 标签条目：annotated=true 为附注标签；subject 为附注信息首行（轻量标签为 null） */
export interface TagEntry {
  name: string;
  hash: string;
  subject: string | null;
  annotated: boolean;
}

/** 标签列表视图 */
export interface TagList {
  tags: TagEntry[];
}

/** 账户条目（掩码视图）：token 本体永不下行；tokenPreview 为前 4 位 + '***'（便于用户辨认自己贴的是哪个 token） */
export interface AccountEntry {
  host: string;
  account: string;
  tokenPreview: string;
}
export interface AccountList {
  accounts: AccountEntry[];
}

/** 远程条目 */
export interface RemoteInfo { name: string; fetchUrl: string; pushUrl: string; }
export interface RemoteList { remotes: RemoteInfo[]; shallow: boolean; }
/** fetch 结果：updatedRefs 为发生移动的引用（完整 refname，如 refs/remotes/origin/main）；shallow 表示 fetch 后仓库是否浅克隆（识别徽标用） */
export interface FetchResult { updatedRefs: string[]; shallow: boolean; }
/** pull/update 结果：up-to-date | updated | conflicts（合并冲突时附冲突列表由调用方查 conflicts 端点） */
export interface PullOutcome { status: 'up-to-date' | 'updated' | 'conflicts'; }
/** push 结果：pushed | rejected | up-to-date；rejected 时 hint 为中文引导 */
export interface PushOutcome { status: 'pushed' | 'rejected' | 'up-to-date'; hint?: string; }
/** Update Project 结果 = fetch + pull 的组合视图 */
export interface UpdateOutcome { fetched: string[]; pull: PullOutcome; }
/** force-push 后修复（GitForcePushedBranchUpdateAction 语义）：status updated=重置完成 / success=重放完成 / conflicts=重放冲突态；
 *  applied 为被重放的本地独有提交哈希（旧→新；updated 时为空） */
export interface ForcePushedUpdateOutcome { status: 'updated' | 'success' | 'conflicts'; applied: string[]; }
/** commit & push 组合执行器结果：commit 已落盘 + push 业务结果（pushed/rejected/up-to-date） */
export interface CommitAndPushOutcome { commit: { hash: string }; push: PushOutcome; }
/** CRLF 提示（GitCrlfDialog 语义）：warning=true 时即将提交的暂存文件含 CRLF 且 core.autocrlf 未建议配置、相关文件无 text/crlf gitattribute 覆盖；
 *  files 为涉事文件相对路径列表（提示语展示用） */
export interface CrlfWarning { warning: boolean; files: string[]; }
/** git 可执行文件信息（GitExecutableSelectorPanel 语义）：exec=查找途径（Web 服务进程统一 'git'——PATH 查找）；
 *  version=git --version 输出（失败 null）；ok 标识可执行（检测到且版本可解析） */
export interface GitExecutableInfo { exec: string; version: string | null; ok: boolean; }

/** 溯源行（line-porcelain 逐字段）：lineno 为最终文件行号（1-based） */
export interface BlameLine {
  lineno: number;
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  /** 日期为 ISO 字符串（git %aI 同口径的作者时区偏移墙钟；ui 的 formatCommitDate 直接截取字符串字段） */
  dateIso: string;
  content: string;
  /** 该行在责任提交版本中的源行号（源自块头 orig 字段）；在无位移编辑/重命名场景恰等同于前一次提交中的行号，插入/位移编辑时可能指向无关行——精确映射留待增强；无则 null——如文件首创建 */
  previousLineno: number | null;
  /** 责任提交的父哈希（批量 no-walk 解析；根提交为空数组）——diff 导航与根提交降级用 */
  parents: string[];
}

/** 文件历史条目（git log --follow 序，最新在前） */
export interface FileHistoryEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** 日期为 ISO 字符串（git %aI，带作者时区偏移；blame 同口径——ui 的 formatCommitDate 直接截取字符串字段） */
  dateIso: string;
  /** 父提交哈希（%P 解析）；根提交为空数组——双击 diff 导航据此降级为 root=1 */
  parents: string[];
}

/** 历史快照树条目：mode 为 git 8 进制模式串（120000=符号链接）；type 为 blob/commit（commit=子模块 gitlink） */
export interface BrowseEntry {
  mode: string;
  type: 'blob' | 'commit';
  hash: string;
  path: string;
}
/** 历史快照树：entries 为 ls-tree -r 平铺（目录节点按 path 前缀聚合，由 UI 层负责） */
export interface BrowseTree {
  rev: string;
  entries: BrowseEntry[];
}
/** 历史快照文件内容：binary=true 表示检出含 NUL 字节（二进制/大文件），content 为可读文本（二进制时为空串语义，仅展示提示） */
export interface BrowseContent {
  content: string;
  binary: boolean;
}

/** git name-status 变更状态码：A 新增 / M 修改 / D 删除 / R 重命名 / C 复制 / T 类型变更（typechange——如普通文件→符号链接，git --name-status 真实输出） */
export type CommittedFileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

/** Committed Changes 条目：一个提交及其变更文件（name-status 解析） */
export interface CommittedEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** 日期为 ISO 字符串（git %aI，带作者时区偏移；blame 同口径——ui 的 formatCommitDate 直接截取字符串字段） */
  dateIso: string;
  /** 父提交哈希（git %P，空格分隔解析）；根提交为空数组——容器打开根提交 diff 时据此降级为提示 */
  parents: string[];
  files: { path: string; status: CommittedFileStatus; renameFrom?: string }[];
}
/** Committed Changes 分页视图：hasMore 表示存在后续页 */
export interface CommittedPage { entries: CommittedEntry[]; hasMore: boolean; }

/** 搜索命中：grep 命中为提交；pickaxe 命中同 */
export interface SearchResult {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  /** 日期为 ISO 字符串（git %aI，带作者时区偏移；blame 同口径——ui 的 formatCommitDate 直接截取字符串字段） */
  dateIso: string;
}
/** 搜索模式：grep=提交信息全文（--grep）；pickaxe=内容增量（-S） */
export type SearchMode = 'grep' | 'pickaxe';

/** patch 条目：name 为 patch 名；size 为字节数；createdAtIso 为创建时间 */
export interface PatchEntry { name: string; size: number; createdAtIso: string; }
/** patch 列表视图 */
export interface PatchList { patches: PatchEntry[]; }
/** shelf 条目：name 为 shelf 名；untrackedCount 为未跟踪文件数 */
export interface ShelfEntry { name: string; createdAtIso: string; untrackedCount: number; }
/** shelf 列表视图 */
export interface ShelfList { shelves: ShelfEntry[]; }
/** 控制台命令执行记录：exitCode 退出码；durationMs 耗时毫秒；stderrTail 错误输出尾部；atIso 执行时间 */
export interface ConsoleEntry { id: number; args: string[]; exitCode: number; durationMs: number; stderrTail: string; atIso: string; }
/** 忽略配置视图：gitignore 与 exclude 两文件全文 */
export interface IgnoreContents { gitignore: string; exclude: string; }
/** 忽略规则模板：id 标识；name 展示名；content 模板内容 */
export interface IgnoreTemplate { id: string; name: string; content: string; }

/** GitHub 远程仓库引用：remoteUrl 为 git 配置 push 原始 URL（parseGithubRemoteUrl 的输入源） */
export interface GitHubRepoRef { owner: string; name: string; remoteUrl: string; }
/** GitHub 域可用性：detected=false 仅当仓库无 GitHub 形态远程或解析异常（此时无 repo/account 字段）；有远程但未配置令牌时 detected=true 且无 account 字段，有令牌时附 account */
export interface GitHubStatus { detected: boolean; repo?: GitHubRepoRef; account?: string; }
/** PR 摘要：state 为打开/关闭（GitHub API 的 open 状态含合并后待关的已合并 PR，merged 单独标识） */
export interface GitHubPrSummary { number: number; title: string; author: string; state: 'open' | 'closed'; merged: boolean; baseRef: string; headRef: string; createdAtIso: string; updatedAtIso: string; }
export interface GitHubPrList { prs: GitHubPrSummary[]; }
/** PR 详情：继承 summary 全部字段；reviewDecision 为最近一次 review 的分组决定 */
export interface GitHubPrDetail extends GitHubPrSummary { body: string; mergeable: boolean; reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE'; commentsCount: number; additions: number; deletions: number; }
/** 时间线条目：kind=review 时 reviewState 为 review 决定（comment 无） */
export interface GitHubTimelineEntry { id: number; author: string; atIso: string; body: string; kind: 'comment' | 'review'; reviewState?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; }
export interface GitHubTimeline { entries: GitHubTimelineEntry[]; }
/** PR 文件变更：patch 为文件级 diff 全文（GitHub API 可能缺省 → ''） */
export interface GitHubPrFile { path: string; status: 'added' | 'modified' | 'removed' | 'renamed'; additions: number; deletions: number; patch: string; }
export interface GitHubPrFiles { files: GitHubPrFile[]; }
/** 行级评审评论：side=LEFT 旧侧/RIGHT 新侧（本产品仅新侧录入，旧侧评论原样呈现）；line 为该侧文件行号（评论必须锚定，null 兜底丢弃该条） */
export interface GitHubReviewComment {
  id: number;
  path: string;
  line: number | null;
  side: 'LEFT' | 'RIGHT';
  author: string;
  atIso: string;
  body: string;
}
/** 行级评审评论列表（按 id 升序——GitHub 返回创建序） */
export interface GitHubReviewComments { comments: GitHubReviewComment[]; }
/** 合并结果：merged=false 时 message 为拒绝原因（如 merge conflict） */
export interface GitHubPrMergeResult { merged: boolean; message: string; }
/** PR 检出结果：branchName 为本地分支名（pr-N） */
export interface GitHubPrCheckoutResult { branchName: string; }

/** GitLab 远程仓库引用：owner 为全路径（可含子组，如 group/sub）；remoteUrl 为 git 配置 push 原始 URL（parseGitlabRemoteUrl 的输入源） */
export interface GitLabRepoRef { owner: string; name: string; remoteUrl: string; }
/** GitLab 域可用性：detected=false 仅当仓库无 GitLab 形态远程或解析异常（此时无 repo/account 字段）；有远程但未配置令牌时 detected=true 且无 account 字段，有令牌时附 account */
export interface GitLabStatus { detected: boolean; repo?: GitLabRepoRef; account?: string; }
/** MR 摘要：state 为打开/关闭/已合并/已锁定 */
export interface GitLabMrSummary { iid: number; title: string; author: string; state: 'opened' | 'closed' | 'merged' | 'locked'; sourceBranch: string; targetBranch: string; createdAtIso: string; updatedAtIso: string; }
export interface GitLabMrList { mrs: GitLabMrSummary[]; }
/** MR 详情：继承 summary 全部字段；reviewState 为最近一次 review 的分组决定（未审为 NONE） */
export interface GitLabMrDetail extends GitLabMrSummary { body: string; mergeable: boolean; reviewState: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE'; commentsCount: number; additions: number; deletions: number; }
/** 时间线条目：kind=review 时 reviewState 为 review 决定（comment 无） */
export interface GitLabTimelineEntry { id: number; author: string; atIso: string; body: string; kind: 'comment' | 'review'; reviewState?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; }
export interface GitLabTimeline { entries: GitLabTimelineEntry[]; }
/** MR 文件变更：diff 为文件级 diff 全文（GitLab API diff 字段） */
export interface GitLabMrFile { path: string; status: 'added' | 'modified' | 'removed' | 'renamed'; additions: number; deletions: number; diff: string; }
export interface GitLabMrFiles { files: GitLabMrFile[]; }
/** 行级讨论注记：newPath/newLine 为 position 锚点（无位置/陈旧讨论为 null——纯文本讨论不入行级线程） */
export interface GitLabDiscussionNote {
  id: number;
  author: string;
  atIso: string;
  body: string;
  newPath: string | null;
  newLine: number | null;
}
/** 行级讨论注记列表（按 id 升序） */
export interface GitLabDiscussions { notes: GitLabDiscussionNote[]; }
/** 合并结果：merged=false 时 message 为拒绝原因（如 merge conflict） */
export interface GitLabMrMergeResult { merged: boolean; message: string; }
/** MR 检出结果：branchName 为本地分支名（mr-N） */
export interface GitLabMrCheckoutResult { branchName: string; }

/** worktree 条目：branch 为绑定分支（分离 HEAD 时为 null）；detached 标记分离 HEAD；head 为 HEAD 提交哈希 */
export interface WorktreeEntry { path: string; branch: string | null; detached: boolean; head: string; }
/** worktree 列表视图 */
export interface WorktreeList { worktrees: WorktreeEntry[]; }
/** submodule 条目：status 四值（uninitialized=未初始化 / checked-out=按期望检出 / different-commit=检出提交与期望漂移 / conflict=冲突）；branch 为期望分支名；commitSha 为当前检出提交 */
export interface SubmoduleEntry { name: string; path: string; url: string; branch?: string; status: 'uninitialized' | 'checked-out' | 'different-commit' | 'conflict'; commitSha?: string; }
/** submodule 列表视图 */
export interface SubmoduleList { submodules: SubmoduleEntry[]; }
