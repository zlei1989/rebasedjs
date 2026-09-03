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

/** git 配置白名单键：读写在契约层收敛，避免任意配置写风险 */
export const CONFIG_KEYS = [
  'user.name',
  'user.email',
  'core.autocrlf',
  'pull.rebase',
  'commit.gpgsign',
  'user.signingkey',
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

/** 冲突条目：stages 为存在的阶段编号（1=base 共同祖先，2=ours 当前分支，3=theirs 合并来源）；组合即冲突类型（[2,3]=双方修改，[1,2,3]=双方修改有祖先，[2]=双方新增…） */
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

/** 合并结果：success=合并完成（含 squash/no-commit 未产提交）；conflicts=进入合并态待解决；up-to-date=已是最新 */
export interface MergeOutcome {
  status: 'success' | 'conflicts' | 'up-to-date';
  conflicts: ConflictEntry[];
}
