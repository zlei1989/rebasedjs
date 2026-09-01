# Rebased.js 架构重构设计

- **日期**：2026-09-01
- **状态**：待评审
- **范围**：以 TypeScript + React 重写 [Rebased](https://github.com/DetachHead/rebased)（基于 IntelliJ 平台的 Git 客户端），在 `rebasedjs` 工作区建立 monorepo：界面与接口分离、服务端/客户端分离、服务端两层抽象（功能服务层 + 框架层），框架层同时支撑 Next.js 与 Koa.js 两个下游应用。
- **参照系**：`D:\zhanglei1120\Github\rebased`（Java/Kotlin 源码）作为功能与交互的**唯一参照**，不做逐行翻译；IntelliJ 平台本身被 Web/React 平台取代。

---

## 1. 背景与目标

### 1.1 现状

- `rebasedjs` 工作区为 pnpm monorepo 骨架：`packages/web`（Next.js 16 + React 19 + antd）、`packages/api`（空壳）、`packages/ui`（空目录）。工作树残留旧 tiegongji 项目的配置与 `server.ts`，需清理。
- 目标产品：**Rebased.js —— 可视化 Git 客户端**，功能对齐 Java 版 Rebased（第 2 节验证）。

### 1.2 目标

1. **TS + React 全栈重写**，界面与接口分离。
2. **monorepo 分离服务端与客户端**，包边界即分层边界。
3. **服务端两层抽象**：
   - **功能服务层**（`api`）：一个功能一个文件，框架无关，可脱离 HTTP 直接测试；
   - **框架层**：两个薄下游应用 —— Next.js 应用与 Koa.js 应用，路由里面引用功能服务层。
4. **重心在 api + ui**：两个下游应用只做最简组装（校验 → 调服务 → 错误映射），不承载业务逻辑。
5. 功能面**完整覆盖** Java 版 Rebased（第 2 节为覆盖验证结论）。

### 1.3 非目标

- 不重写 IntelliJ 平台通用 IDE 能力（Java 语言支持、调试器、数据库 grid、书签、结构视图等）。
- 不实现 Java 版没有的功能（如 git bisect 界面）。
- v1 不做多用户/远程托管模式；两个应用均为**本地优先**（localhost 直连本地仓库）。

---

## 2. 参考面验证：Rebased（Java 版）产品构成

以下结论来自对 `D:\zhanglei1120\Github\rebased` 的源码核查（证据链见附录 A）。

### 2.1 产品打包插件清单（`REBASED_BUNDLED_PLUGINS`）

平台默认插件（bookmarks / grid / navbar / recentFiles / structureView / images / aether-dependency-resolver / libraries-misc）＋：

| 插件 | 内容 | rebased.js 落点 |
|------|------|-----------------|
| `intellij.vcs.git`（git4idea） | 全部 Git 功能（781 个源文件逐一核对） | 功能服务层核心 |
| `intellij.vcs.git.commit.modal` | 新版模态提交界面 | `commit.ts` + 提交组件 |
| `intellij.vcs.github` | GitHub 集成（PR/克隆/Gist/认证） | `github.ts` |
| `intellij.vcs.gitlab` | GitLab 集成（Merge Request/Snippet） | `gitlab.ts` |
| `intellij.terminal` | 内置终端 | 可选（P4，xterm.js） |
| `intellij.textmate.plugin` | 语法高亮 | 由 Monaco/CodeMirror 语法高亮替代 |

平台核心（非插件，随产品附带且与 Git 客户端强相关）：编辑器与 diff/merge 查看器、VCS Log UI、Local Changes（changelists）、Shelf、补丁、3-way 冲突解决、Committed Changes 浏览器、Git 输出控制台、本地历史（Local History）、Search Everywhere。

### 2.2 Rebased 独家改动

1. **Log 位置偏好**（"Show the log in the editor window"）：上游既有设置（`VcsLogBundle.properties` 第 27 行），Rebased 改默认值——`VcsLogApplicationSettings.kt:146` 的 `var showInEditor = true` 证实默认开启 → 映射为 `settings.ts` 的 UI 布局偏好。
2. **禁用 `.idea` 目录**（"Store project settings in the project root directory"）：`IdeBundle.properties` 第 3343 行上方注释 `# rebased-exclusive strings:` 表明该设置是 **Rebased 独家新增**（非上游既有）→ TS 版无 `.idea` 概念，映射为"仓库级设置集中存储于应用配置目录"的存储策略。
3. **更新策略**（`RebasedUpdateStrategy.kt`）与品牌化（`RebasedApplicationInfo.xml`）→ 与功能无关。

### 2.3 明确不做

- IDE 通用插件：grid（数据网格）、bookmarks、navbar、structureView、images、aether-dependency-resolver（其"最近项目"能力由 `repo.ts` 的最近仓库覆盖）。
- git-features-trainer（仓库中存在该插件目录，但 Rebased 打包清单与 build-scripts 中均无引用 → 不覆盖）。
- git bisect 界面（上游无此功能）。

---

## 3. 总体架构

### 3.1 分层总览

```text
┌──────────────────────────────────────────────────────────┐
│  apps/（框架层 — 两个薄下游应用，只做组装）                   │
│   web-next（Next.js）          web-koa（Koa.js）           │
│   页面壳 + 路由转调服务层        路由/中间件 + 静态托管 SPA    │
└────────────────┬─────────────────────┬────────────────────┘
                 │ 路由里面引用功能服务层
┌────────────────▼─────────────────────▼────────────────────┐
│  packages/server（服务端核心，零框架依赖）                    │
│   api        功能服务层：一个功能一个文件                  │
│   core       git CLI 引擎封装（流式原语、进程管理）        │
│   contracts  契约：zod schema + 类型 + 事件（跨端共享）    │
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  packages/client（客户端核心，框架无关 React）                │
│   ui         纯展示组件（基础 + 组合，不调接口）           │
│   client     数据层：SWR hooks + SSE 订阅 hooks          │
└──────────────────────────────────────────────────────────┘
```

### 3.2 目录结构

```text
rebasedjs/
├── apps/
│   ├── web-next/          # 下游应用①：Next.js 16（App Router）
│   │   ├── app/           # 页面壳（layout、route 页面；主体为 client components）
│   │   └── app/api/       # API Routes + Server Actions：校验→调 api→错误映射
│   └── web-koa/           # 下游应用②：Koa.js
│       ├── src/routes/    # 路由：同样三件套（校验→调 api→错误映射）
│       ├── src/middleware/# 错误处理、body 解析、SSE 流、静态资源
│       └── public/        # 同一套 SPA 构建产物（Vite 打包 ui + client）
├── packages/
│   ├── server/
│   │   ├── core/      # Git 引擎：git CLI 封装
│   │   ├── api/       # 功能服务层：src/ 下一个功能一个文件
│   │   └── contracts/ # 契约：REST 端点、zod schema、SSE 事件、领域类型、错误码
│   └── client/
│       ├── ui/        # 基础组件 + 组合组件，纯数据驱动
│       └── client/    # SWR hooks + SSE 订阅 hooks
├── docs/                  # 设计文档与功能清单
└── eslint.shared.ts       # 共享规则 + 分层边界规则
```

包名（npm scope）：`@rebased/web-next`、`@rebased/web-koa`、`@rebased/api`、`@rebased/core`、`@rebased/contracts`、`@rebased/ui`、`@rebased/client`。

### 3.3 依赖方向（单向，eslint 硬约束）

```text
web-next  ──→ api / ui / client / contracts
web-koa   ──→ api / contracts（无 UI 依赖；静态托管 Vite 构建的 SPA）
client ──→ contracts
ui    ──→ contracts（仅类型；禁止 import client / api）
api   ──→ core / contracts
core  ──→ 无（node 内置 + 系统 git CLI）
```

> 注：web-koa 对 ui/client 为**构建期依赖**（Vite 将两者打进 SPA 产物，运行时只静态托管），因此不计入运行时依赖方向。

**边界规则**（`eslint.shared.ts` 以 `no-restricted-imports` 实现，违反即 CI 失败）：

- `api`、`core` 禁止 import `next`、`koa`、`react`、`react-dom`；
- `ui` 禁止 import `client`、`api`、`apps/*`；
- `client` 禁止 import `apps/*`；
- `apps/*` 之间禁止互相 import。

### 3.4 关键取舍

1. **ui 必须是纯客户端 React**（禁用 RSC 专属 API），因为同一套组件要被 Next.js（SSR 壳 + client components）与 Koa 托管的 Vite SPA 共享。Next.js 应用保留 SSR 页面壳（layout、加载骨架），组件树主体以 client components 挂载。
2. **契约包放 `packages/server/contracts` 但允许客户端引用**（逻辑上跨端共享；eslint 仅对 server 侧包施加"禁框架"约束）。
3. 清理旧遗留：删除 `packages/web/server.ts`（tiegongji 遗留）、旧 `@tiegongji/*` 依赖与 Electron 相关配置；`AGENT.md` 随骨架落地一并更新。

---

## 4. 分层设计

### 4.1 core —— Git 引擎（系统 git CLI 封装）

**职责**：只做"与 git 进程打交道"这一件事，不掺业务。是 `api` 的唯一能力来源。

| 模块 | 内容 |
|------|------|
| `exec.ts` | spawn 执行 git：永远传参数数组（杜绝 shell 注入）、强制 `--no-pager -c core.pager=cat`、`LC_ALL=C`、超时/取消（`AbortSignal` → 杀进程树，Windows 用 `taskkill /T`）、退出码与 stderr 结构化（`GitExitError`） |
| `repo.ts` | 仓库发现（向上找 `.git`）、`init`/`clone`、worktree 信息 |
| `status.ts` | `status --porcelain=v2 -z --branch` 解析 |
| `log.ts` | 流式 `log --graph`：自定义 `--format` 分隔符 + NUL 分隔，逐条产出 `GraphLine` 事件（边/节点/标签/HEAD 装饰），分页 `--skip`、过滤（author/date/message/path）、`--follow` |
| `diff.ts` | 大 diff 流式输出（chunk 事件），`-z` 解析文件名 |
| `blame.ts` / `refs.ts` / `stash.ts` / `credential.ts` | 对应 CLI 原语的薄封装（credential helper 桥接后置） |

**性能与正确性要点**：

- 全部解析走 `-z`（NUL 分隔）或自定义分隔符，文件名含空格/换行/中文均安全；
- log 图流式 + 前端虚拟滚动，支撑大仓库（Linux 内核级）；
- 测试用**真实 git CLI + 临时仓库 fixture**（init → 造提交 → 造分支/冲突），不 mock git；纯解析函数补单测。

**为什么不用 simple-git**：流式能力弱、长命令可控性差；自封装 `spawn` 直接可控。

### 4.2 api —— 功能服务层（一个功能一个文件）

**统一函数约定**：

- 入参：`repoPath: string` 显式传入 + 领域参数（**无 HTTP 对象、无隐藏全局状态**，天然支持多仓库并发）；
- 返回：`contracts` 定义的领域类型；
- 流式功能（log、大 diff、长操作进度）：返回 `AsyncIterable<契约事件>`，由框架层转 SSE；
- 长操作接受可选 `{ signal }` 支持取消；
- 错误：统一 `ServiceError { code, message, context?, cause? }`，`message` 为可直接展示的中文；**不抛 HTTP 概念**；
- 文件之间仅通过 `index.ts` 公共出口互调，禁止深层相对 import。

**完整功能清单（验证版，36 个功能文件 + errors.ts）**：

| 文件 | 功能与关键操作 | Java 侧证据 | 阶段 |
|------|----------------|-------------|------|
| `repo.ts` | 打开/验证/初始化/克隆、最近仓库、仓库元信息 | `GitRepositoryImpl`、`GitCloneUtils`、平台 `RecentProjectsManager` | P1 |
| `status.ts` | 工作区状态、未跟踪、忽略状态、分支/上游信息 | `GitUntrackedFilesHolder`、`GitIgnoredFilesHolder` | P1 |
| `log.ts` | 提交图（流式）、过滤、分页、提交详情、新标签页打开、在控制台显示 log | `GitLogProvider`、VCS Log UI、`GitExternalLogTabsProperties`、`ShowGitLogCommandAction` | P1 |
| `diff.ts` | 工作区/暂存/提交间 diff、流式、hunk 应用/回退、与分支比较 | `GitShowDiffWithBranchPanel`、`GitCompareWithBranchAction`、`GitStageDiffAction` | P1 |
| `settings.ts` | 应用设置：最近仓库、UI 偏好、**log 位置**、仓库级设置集中存储、git 可执行文件检测/引导、GPG 配置、SSH 配置 | `GitVcsPanel`、`GitExecutableSelectorPanel`、`GitGpgConfigDialog`、`SSHConnectionSettings` | P1 |
| `errors.ts` | `ServiceError` + 错误码表 | — | P1 |
| `operation.ts` | 进行中操作状态（merge/rebase/cherry-pick 检测）、进度事件、操作锁、**中止操作** | `GitFreezingProcess`、`GitMergeRebaseWidget`、`GitAbortOperationAction` | P2 |
| `reset.ts` | Reset：mixed/soft/hard、日志右键"Reset Current Branch to Here"、**Undo Commit**（撤销最近提交） | `GitResetAction`、`GitNewResetDialog`、`GitUncommitAction` | P2 |
| `staging.ts` | 暂存区：add/**取消暂存**/放弃修改（hunk 级）、三版本对比（注：与 `reset.ts` 的 Reset HEAD 不同） | `GitStageAllAction`、`StagingAreaOperation`、`GitStageCompareThreeVersionsAction` | P2 |
| `changelist.ts` | 变更列表：创建/切换/移动变更/默认列表 | 平台 changelists（`ChangeListManager`） | P2 |
| `commit.ts` | 提交、amend、**modal 提交 UX**、sign-off、GPG 签名、commit template、跳过 hooks、commit & push、push up to commit、add commit to remote branch、amend 历史提交、reword、CRLF 提示 | `GitCheckinEnvironment`、插件 `intellij.git.commit.modal`、`commit\signing`（`GpgAgentConfigurationAction`）、`GitSkipHooksCommitHandlerFactory`、`GitPushUpToCommitAction`、`GitAmendSpecificCommitSquasher`、`GitCrlfDialog` | P2 |
| `branch.ts` | 分支：创建/删除/重命名/上游/合并状态、保护分支、最近检出、已合并查找、force-push 后修复、checkout with rebase、**清理已合并/过时分支** | `GitNewBranchDialog`、`GitProtectedBranchProvider`、`GitRecentCheckoutBranches`、`FindMergedLocalBranchesAction`、`GitForcePushedBranchUpdateAction`、`CleanupBranchesAction` | P2 |
| `checkout.ts` | 检出：分支/标签/提交/文件、新建分支检出、detached | `GitCheckoutAction`、`GitCheckoutAsNewBranch`、`GitCheckoutFromInputAction` | P2 |
| `merge.ts` | 合并 + 冲突状态 + 合并方向/策略 | `GitMergeDialog`、`GitMergeOption`、`MergeDirectionModel` | P2 |
| `stash.ts` | 贮藏：save/pop/apply/drop、un-stash 对话框、stash as branch | `GitStashDialog`、`GitUnstashAsDialog`、`GitStashBranchComponent` | P2 |
| `conflict.ts` | 冲突列表、标记已解决、3-way 合并状态查询 | `GitConflictsPanel`、`MergeConflictResolveUtil`、`GitResolvedConflictsFilesHolder` | P2 |
| `config.ts` | git 配置读写（user.name/email、remote、core 等） | `GitConfig`、`GitConfigUtil` | P2 |
| `auth.ts` | 凭据：HTTPS 认证对话框、credential helper、token 存储（供 github/gitlab 复用） | `GitHttpAuthService`、`GitHttpLoginDialog`、github authentication | P2 |
| `rebase.ts` | rebase onto、**交互式**（pick/reword/squash/fixup/drop）、auto-squash、fixup/squash by subject、continue/abort、rebase 冲突 | `GitRebaseDialog`、`GitInteractiveRebaseDialog`、`GitAutoSquashCommitAction`、`GitCommitSquashBySubjectAction` | P3 |
| `cherry-pick.ts` | 摘樱桃、continue | `GitCherryPickProcess`、`GitCherryPickContinueAction` | P3 |
| `revert.ts` | 还原提交 | `GitRevertProcess`、`GitRevertAction` | P3 |
| `tag.ts` | 标签：创建/删除/推送 | `GitPushTagsAction`、`GitTagHolder` | P3 |
| `remote.ts` | 远程：添加/删除/编辑、fetch/pull/push、fetch spec、rejected push 处理、shallow clone、unshallow | `GitConfigureRemotesDialog`、`GitFetchSpec`、`GitRejectedPushUpdateDialog`、`GitUnshallowRepositoryAction` | P3 |
| `update.ts` | Update Project：pull + merge/rebase 策略选择、修复跟踪分支 | `GitUpdateOptionsDialog`、`GitUpdateSession`、`GitPostUpdateHandler`、`FixTrackedBranchDialog` | P3 |
| `blame.ts` | 溯源/注释 | `GitAnnotationProvider`、`GitAnnotationService` | P3 |
| `history.ts` | 文件历史（含重命名跟随） | `GitFileHistory`、`GitHistoryTraverser` | P3 |
| `committed.ts` | Committed Changes 浏览器：按文件浏览已提交变更 | 平台 `changes\committed`（`CommittedChangesBrowser`）、`GitCommittedChangeListProvider` | P3 |
| `search.ts` | 提交内容搜索（grep/pickaxe）、Search Everywhere 提交/分支搜索 | `GitSearchUtils`、`GitSearchEverywhereContributor` | P3 |
| `patch.ts` | 补丁：创建/应用/已保存补丁 | 平台 patch 包、`GitStageCreatePatchActionProvider` | P3 |
| `shelf.ts` | Shelf 搁置：保存/恢复/删除 | 平台 `com/intellij/vcs/shelf` | P3 |
| `console.ts` | Git 输出控制台：git 命令输出展示 | `GitCommandOutputConsolePrinter`、`GitConsoleFoldingImpl` | P3 |
| `ignore.ts` | .gitignore：创建/编辑/模板、exclude | `GitIgnoreFileActionGroup`、`DefaultGitExcludeAction`（GitExcludeActions.kt）、ignore/lang | P3 |
| `github.ts` | GitHub：账户/token 认证、克隆、分享项目、PR（列表/详情/时间线/评论/审查 approve/request changes/diff 视图/三种合并策略/AI 描述）、**Gist 创建**。注：Java 侧无 Issues/通知的用户可见 UI（仅 API 加载器），不覆盖 | `github-core`（accounts/pullrequest/ui、`GithubCreateGistDialog`） | P3 |
| `gitlab.ts` | GitLab：账户认证、Merge Request 创建/列表/详情/diff 视图/评论/审查 approve/request changes/合并、**Snippet 创建** | `gitlab-core`（mergerequest、snippets、ui\review） | P4 |
| `worktree.ts` | 工作树：创建/打开/清理/删除 | `GitWorkingTreeDialog`、`workingTrees/ui` | P4 |
| `submodule.ts` | 子模块：状态/更新 | `GitSubmoduleUpdater`、`GitSubmodule`、`GitModulesFileReader` | P4 |
| `browse.ts` | 浏览仓库历史快照（browse repo at revision） | `GitBrowseRepoAtRevisionAction` | P4 |

可选后置（明确标注非核心）：`terminal.ts`（内置终端，xterm.js）、`local-history.ts`（本地历史，平台能力，非 git 功能）。

**错误码表**（`errors.ts`）：

| code | HTTP 映射 | 场景 |
|------|-----------|------|
| `REPO_NOT_FOUND` | 404 | 仓库不存在/未注册 |
| `NOT_A_GIT_REPO` | 400 | 路径不是 git 仓库 |
| `INVALID_REF` | 400 | 分支/标签/提交不存在 |
| `INVALID_QUERY` | 400 | 查询参数不合法 |
| `CONFLICT` | 409 | 存在未解决冲突 |
| `AUTH_FAILED` | 401 | 凭据失败 |
| `RATE_LIMITED` | 429 | GitHub/GitLab API 限流 |
| `HOOK_FAILED` | 422 | pre-commit 等钩子失败 |
| `STALE_LOCK` | 409 | index.lock 被占用 |
| `OPERATION_IN_PROGRESS` | 409 | 已有进行中操作（rebase 中等） |
| `GIT_ERROR` | 500 | git 命令失败（带 stderr 上下文） |
| `CANCELLED` | —（客户端断开连接，无响应可发） | 客户端取消/服务器主动终止长操作 |

### 4.3 contracts —— 跨端契约

- **领域类型**：`RepoStatus`、`CommitNode`/`GraphLine`、`DiffFile`/`DiffChunk`、`BranchRef`、`TagRef`、`StashEntry`、`Changelist`、`Conflict`、`Worktree`、`Submodule`、GitHub/GitLab 领域类型（`PullRequest`、`MergeRequest` 等）等全部定义于此。
- **端点契约**：每个端点一个 zod schema（query/body/响应/SSE 事件）。
- **路由约定**：仓库用 **repoId** 标识（`settings` 注册 `{id, path}` 映射，不暴露文件系统路径，未来可挂鉴权）。
- **错误形状**：`{ error: { code, message, context? } }`；`httpStatusFor(code)` 纯函数放本包，两个框架应用共用同一张映射表。
- **SSE 事件格式**：`{ type, payload }`，事件类型全部由本包定义。

**P1 端点清单**（后续阶段按功能文件同模式扩展）：

```text
GET    /api/repos                        最近仓库列表
POST   /api/repos/open      {path} → {repoId}
GET    /api/repos/:repoId/status
GET    /api/repos/:repoId/log?limit=50&before=…&author=…
GET    /api/repos/:repoId/diff?file=…&from=…&to=…     （SSE 流式）
GET    /api/repos/:repoId/events                       （SSE：状态变更 + 长操作进度）
GET    /api/settings                       应用设置
PUT    /api/settings                       更新设置
```

**命名模式**（后续端点遵循）：`GET/POST/PUT/DELETE /api/repos/:repoId/<功能>/…`；写操作用 POST（语义如 `POST /api/repos/:repoId/staging` + `{action}`），长操作返回 `{operationId}` 并用 `/events` 推送进度。

### 4.4 client —— 客户端数据层

- SWR hooks：`useRecentRepos`、`useRepoStatus`、`useLogPage`、`useDiff`、`useSettings` …（按 contracts 端点一一对应）；
- 订阅 hooks：`useRepoEvents(repoId)`（SSE 订阅：状态变更、操作进度）；
- 类型全部来自 `contracts`；框架无关（SWR 在 Next client components 与 Vite SPA 均可运行）；
- 禁止持有业务逻辑（不聚合、不转换业务数据，只做取数与缓存）。

### 4.5 ui —— 纯展示组件层

**规则**：props 驱动；**不 import client、api**；不发起任何接口调用；样式 antd + Tailwind（遵循 AGENT.md 风格约束）。

| 类别 | 组件 |
|------|------|
| 基础 | `CommitGraph`（虚拟滚动 + 增量）、`DiffView`（unified/side-by-side）、`MergeView`（3-way 冲突解决）、`FileTree`、`VirtualList`、`GraphCanvas`、`OperationStatus`（进行中操作条）、`Editor`（Monaco，diff/commit message/冲突编辑共用，语法高亮替代 TextMate） |
| 组合 | `RepoPage`、`LogPage`、`DiffPage`、`StatusPage`（Local Changes + 暂存区）、`CommitDialog`（modal 提交）、`ResetDialog`（Reset/Undo Commit）、`BranchPanel`、`MergeDialog`、`RebaseDialog`（交互式）、`StashPanel`、`TagPanel`、`RemotePanel`、`PushDialog`/`PullDialog`/`UpdateProjectDialog`、`BlameView`、`HistoryPanel`、`CommittedChangesPanel`、`SearchPanel`、`ConflictsPanel`、`PatchPanel`、`ShelfPanel`、`WorktreePanel`、`SubmodulePanel`、`IgnoreDialog`、`GitHubPanel`（PR 列表/详情/时间线/审查）、`GitLabPanel`、`GitConsole`、`QuickActionsMenu`（聚合各功能快捷入口）、`SettingsPage` |

#### 4.5.1 ui 重构逻辑：UI 来源判定

Java 版 UI 构成三类，处置方式不同（判定原则：**算法移植、结构参照、风格对齐，不搬渲染代码**）：

| Java 侧资产 | 技术形态 | rebased.js 落点 | 复用方式 |
|------------|---------|----------------|---------|
| 通用控件（表格/树/表单/对话框/工具栏/弹窗/标签页） | Swing（JBTable/JBTree/JBPopup/JBDialog）+ Jewel（Compose Multiplatform 组件库，`platform/jewel`、`platform/compose` 模块） | antd（Table/Tree/Form/Modal/Menu/Tabs/Popover 等）+ Tailwind | **不移植**：Swing/Compose 渲染模型与 React DOM 不通，代码无法复用；antd 覆盖通用控件需求 |
| 编辑器（语法高亮/diff/annotation gutter/inlay） | IntelliJ 自研编辑器（平台核心） | Monaco（DiffEditor、Monarch 语法高亮、gutter 扩展、虚拟滚动） | **不移植**：Monaco 具备对应能力，且替代 TextMate 插件的语法高亮职责 |
| **VCS Log 图布局算法** | `platform/vcs-log/graph` + `graph-api`：`GraphLayoutBuilder`、`EdgePrintElementImpl`、`PrintElementGeneratorImpl`、`GraphColorGetterByHead/Node`、`BfsUtil`/`DfsUtil`、`LinearBekController` 等 + 7 组 testData（layoutBuilder/edgesInRow/graphBuilder/containingBranches…） | `ui` 内独立布局模块 `graph-layout/`（`CommitGraph` 的布局引擎，纯函数） | **算法级移植**（唯一建议代码级复用的资产）：TS 重写算法，**将 Java testData 转为 vitest 夹具做行为等价测试**；源码 Apache-2.0（见 `LICENSE.txt`），移植时保留版权声明 |
| Git 专属复杂组件（交互式 rebase 编辑器、分支树/仪表盘、暂存区三版本对比、冲突面板、提交对话框、Committed Changes 浏览器） | git4idea Swing 组件（`GitRebaseCommitsTableView/Model`、`BranchesTreeModel`、`GitStage*`、`GitConflictsPanel`、`GitCheckinEnvironment` 等） | 自研 React 组件 + antd 组合 | **信息架构参照**：对话框字段结构、状态机、树模型分组维度逐项对照（见 4.5.2），不搬代码 |
| 视觉风格（Darcula/IntelliJ LAF） | 平台 LAF 资源 | antd 主题变量 + Tailwind 设计令牌 | 风格参照：深色主题为默认，不强求像素级复刻 |

#### 4.5.2 关键组件的落点映射（信息架构参照表）

| Java 组件 | rebased.js 落点 | 必须对照的结构 |
|-----------|----------------|---------------|
| VCS Log 表 + graph/graph-api | `CommitGraph` + `graph-layout/` | lane 分配、edge routing、分支着色算法 |
| `GitRebaseCommitsTableView/Model` + `GitInteractiveRebaseDialog` | `RebaseDialog`（交互式提交列表） | entry 状态机（pick/reword/squash/fixup/drop）、上移/下移约束、冲突标记 |
| `GitMergeDialog` + `GitOptionsPanel` | `MergeDialog` | 合并方向、merge 策略选项、commit 选项 |
| `BranchesTreeModel`（popup/dashboard） | `BranchPanel` | 分组维度（本地/远程/最近检出/标签）、过滤逻辑、合并状态图标 |
| `GitStage*`（暂存区 + 三版本对比） | `StatusPage` 暂存区 | 三版本模型（本地/暂存/HEAD）、hunk 展开、整文件暂存 |
| `GitConflictsPanel` + 平台 3-way merge | `ConflictsPanel` + `MergeView` | 冲突文件分组、左右 diff + 底部合并结果面板 |
| CommitDialog（modal） | `CommitDialog` | changelist 选择、amend/sign-off/GPG 选项、提交范围 |
| `CommittedChangesBrowser` | `CommittedChangesPanel` | 按目录树浏览已提交变更的结构 |
| `GitBranchesTreePopupOnBackend` / `GitQuickActionsToolbarPopup` | `QuickActionsMenu` | 操作聚合方式（当前仓库可执行操作全集） |

#### 4.5.3 组件分层

```text
ui/src/
├── base/        # 无 git 语义的通用展示件：VirtualList、GraphCanvas、FileTree、MonacoEditor、
│                #   DiffView、ThreeWayMergeView、EmptyState、OperationStatus
├── domain/      # 有 git 语义的领域组件：CommitGraph、InteractiveRebaseTable、BranchTree、
│                #   StagingArea、ConflictList、DiffFileView、CommitForm…
├── composite/   # 页面/对话框级组合：LogPage、DiffPage、StatusPage、CommitDialog、MergeDialog…
└── graph-layout/# 自 vcs-log/graph 移植的布局算法（纯函数，不 import React）
```

依赖方向：`composite → domain → base`；`graph-layout` 仅被 `CommitGraph` 使用；**base/domain/composite 均不发起接口调用**（数据由 props 传入）。

#### 4.5.4 判定结论

1. **基础 UI 组件（antd）满足要求**——通用控件面无需从 Java 版移植；
2. **Rebased 的 Java UI 组件代码不适合直接使用**——Swing/Jewel 渲染模型与 React 不通；
3. **必须从 Rebased 拿走的资产有两类**：图布局算法（代码级移植 + testData 行为等价验证，Apache-2.0 保留声明）与各功能面板的信息架构（4.5.2 对照表）；深色视觉风格作为可选项对齐。

### 4.6 框架层：web-next 与 web-koa

**共同模式**：每个路由只做三件事 —— **zod 校验 → 调 api → 错误映射**。`AsyncIterable → SSE` 序列化是 `contracts` 的纯函数，apps 内零逻辑重复。

**web-next**（Next.js 16，App Router）：

- `app/layout.tsx`：SSR 壳（antd ConfigProvider、全局 chrome、加载骨架）；
- 页面主体：client components 组装 ui + client；
- `app/api/repos/…/route.ts`：每个端点一个 Route Handler，薄封装调服务层；SSE 用 `ReadableStream.from(asyncIterable)`；
- Server Actions 仅作为表单类操作的便捷封装，REST 为主（保证与 web-koa 对称）。

**web-koa**（Koa.js）：

- `src/routes/repos.ts`：同一份端点清单（koa-router）；
- `src/middleware/`：错误处理、body 解析、SSE 流、`koa-static` 托管 `public/`；
- `public/`：**同一套 ui + client 的 Vite SPA 构建产物**。

两个应用均本地运行（localhost，本地优先访问仓库）：`web-next` 用 `next dev/build/start`；`web-koa` 用 tsx + Vite。

---

## 5. 通信与流式约定

| 场景 | 机制 |
|------|------|
| 常规读写 | REST（zod 校验，JSON） |
| log 图增量、大 diff、长操作进度、仓库状态变更 | SSE（`{type, payload}` 事件流），事件类型由 contracts 定义 |
| 大结果集 | 分页（`limit`/`before` 游标） |
| 取消 | 客户端断开 SSE 连接 → 框架层 AbortSignal → 服务层取消 git 进程 |

事件类型（首批）：`log.line`、`diff.chunk`、`operation.progress`、`operation.state-changed`、`repo.state-changed`。

---

## 6. 测试与质量

| 层 | 测试 |
|----|------|
| core | 真实 git CLI + 临时仓库 fixture（造提交/分支/冲突/重命名）；解析函数单测 |
| api | fixture 仓库集成测试，不经 HTTP 直接调服务（框架无关的可测试性红利） |
| contracts | zod 解析、`httpStatusFor` 映射、SSE 序列化单测 |
| ui | Testing Library + 交互测试 |
| client | mock fetch / mock SSE 测试 |
| apps | 只测路由装配（zod 校验 + 错误映射），不重复测服务逻辑 |

质量门（根命令，与 AGENT.md 一致）：`pnpm typecheck`（project references 全链类型）→ `pnpm format` → `pnpm test`。eslint 边界规则违反即失败。

---

## 7. 落地顺序

1. **骨架**：清理旧 `packages/web` 遗留（server.ts、Electron、@tiegongji/*）→ 建 7 包结构 + workspace/tsconfig project references/eslint 边界规则 → 更新 `AGENT.md`。
2. **contracts**：领域类型 + P1 端点 schema + 错误码表。
3. **core**：`exec`/`repo`/`status`/`log`/`diff` 原语 + 集成测试。
4. **api**：`repo` `status` `log` `diff` `settings` `errors` + 测试。
5. **web-next**：壳 + 路由 + Log 图（含 `graph-layout` 算法移植与 testData 行为等价夹具）+ Diff 视图（P1 首个可见产品）。
6. **web-koa**：同样路由 + Vite SPA 构建链。
7. P2–P4 按清单逐项增量（每个功能 = api 一个文件 + 契约 + 两端路由 + ui 组件，各自独立子项目）。

---

## 8. 风险

| 风险 | 缓解 |
|------|------|
| git CLI 平台差异（Windows 路径/CRLF/杀进程树） | core 统一处理 + 三平台 CI 跑集成测试 |
| 大仓库 log 图性能 | 流式解析 + 虚拟滚动 + 分页游标 |
| 两个下游应用路由重复 | 契约（schema/错误映射/SSE 序列化）集中放 contracts，apps 只留装配 |
| GitHub/GitLab API 限流与鉴权复杂度 | auth.ts 集中 token 管理；`RATE_LIMITED` 统一错误 |
| credential helper 依赖系统 git 配置 | 引擎层原样调用系统 git（helper 由 git 进程自身处理），auth.ts 只做兜底 HTTPS 对话框 |
| 图布局算法移植行为偏差 | 仅移植纯算法模块（`graph-layout/`），Java testData 转 vitest 夹具做行为等价测试；保留 Apache-2.0 版权声明 |

---

## 附录 A：覆盖验证证据链

1. **打包插件清单**：`platform/build-scripts/src/org/jetbrains/intellij/build/BaseIdeaProperties.kt` 中 `REBASED_BUNDLED_PLUGINS = DEFAULT_BUNDLED_PLUGINS + [intellij.vcs.git, intellij.vcs.git.commit.modal, intellij.vcs.github, intellij.vcs.gitlab, intellij.terminal, intellij.textmate.plugin]`；`build/src/org/jetbrains/intellij/build/RebasedProperties.kt` 第 73 行使用该常量；`DEFAULT_BUNDLED_PLUGINS` 定义于 `productLayout/ProductModulesLayout.kt` 第 23 行。
2. **git4idea 功能面**：逐一核对 `plugins/git4idea/backend/src/` 下 781 个源文件（533 个 .kt + 248 个 .java，按 actions/branch/ref/tag/workingTree/addCommit/index/ignore/log/rebase/merge/stash/reset/remote/hosting/workingTrees/annotate/applyChanges/history/update/checkin/commands/config/conflicts/search 等域目录归类），第 4.2 节功能清单中的"Java 侧证据"列即引用这些类名。
3. **平台 VCS 面**：`platform/vcs-impl/src` 的 `com/intellij/openapi/vcs/changes/{shelf,patch,savedPatches}`、`com/intellij/vcs/shelf`、`com/intellij/openapi/vcs/history` 等包证实 changelists/Shelf/补丁/历史 UI 属平台层。
4. **Rebased 独家特性**：`IdeBundle.properties` 第 3343 行（Store project settings in the project root directory）上方注释 `# rebased-exclusive strings:` 表明该设置为 Rebased 独家新增；`VcsLogBundle.properties` 第 27 行（Show the log in the editor window）为上游既有设置，`VcsLogApplicationSettings.kt:146` 的 `var showInEditor = true` 证实 Rebased 将其默认开启；fork 独有源码仅 `RebasedUpdateStrategy.kt` 与品牌资源。
5. **GitHub/GitLab 功能面**：`plugins/github/github-core/src/org/jetbrains/plugins/github/`（accounts/pullrequest/ui 包树）与 `plugins/gitlab/gitlab-core/src/org/jetbrains/plugins/gitlab/`（mergerequest、snippets 包）证实 PR/MR/认证/Gist/Snippet 功能域；github 的 issue/notification 包仅剩无 UI 消费方的内部加载器（`GithubIssuesLoadingHelper` 等），故不列为用户功能。
6. **UI 技术栈与可移植资产**：平台含 `platform/jewel`（JetBrains Jewel，Compose Multiplatform 组件库）与 `platform/compose` 模块，git4idea UI 为 Swing 组件——渲染模型与 React DOM 不通，故 4.5.1 判定"不移植代码"；唯一代码级移植资产为 `platform/vcs-log/graph` + `graph-api` 的图布局算法（`GraphLayoutBuilder`/`EdgePrintElementImpl`/`PrintElementGeneratorImpl` 等 30+ 个类 + 7 组 testData），源码为 Apache-2.0（`LICENSE.txt` 第 8-9 行），移植保留版权声明。

> 注：本地检出为浅克隆（git log 仅 1 条提交）且 git 索引为空，证据以工作树源码为准；`git4idea` 的 `frontend/rt/shared/terminal/localHistory` 模块均为支撑性代码（UI 桥、运行时、语法高亮），功能面已归入正文；`intellij.terminal` 与 `intellij.textmate.plugin` 的插件源码不在本检出（`git4idea\terminal` 仅为 git 终端桥接模块），其功能面按上游公开文档归纳。
