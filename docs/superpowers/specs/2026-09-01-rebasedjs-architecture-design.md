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
- **首跑（P1 可见产品）明确不做**（文档化，避免误判为缺失；推迟项汇总见附录 C）：欢迎屏整体（RepoPage 取代；`FlatWelcomeFrame.kt:111-125`）；克隆/init 的 UI（P2 补最小字段 URL+Directory；`VcsCloneDialog.kt:33-131`）；log 过滤/搜索 UI 与分支折叠（P2 次优先补"文本即滤 + 分支过滤弹窗"；`VcsLogClassicFilterUi.kt:148-152`）；独立 StatusPage（状态在 LogPage 顶栏）与进行中操作状态前缀（P2 operation.ts；`GitBranchUtil.java:193-204`）；提交详情面板操作按钮（Java 面板内也没有，动作在右键菜单，属 P3）；自动 fetch、保护分支（P2/P3）与 GPG 签名状态（P2 commit.ts）。

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
│   │   ├── next.config.ts # transpilePackages：ui/client/contracts
│   │   ├── app/           # 页面壳（layout.tsx SSR 壳、page.tsx RepoPage、repos/[repoId]/page.tsx LogPage+DiffPage；主体为 client components）
│   │   └── app/api/       # API Routes + Server Actions：校验→调 api→错误映射
│   └── web-koa/           # 下游应用②：Koa.js
│       ├── src/app.ts    # koa 组装：路由 + 中间件 + 静态
│       ├── src/routes/    # 路由：同样三件套（校验→调 api→错误映射）
│       ├── src/middleware/# 错误处理、body 解析、SSE 流、静态资源
│       ├── index.html、src/main.tsx、vite.config.ts  # SPA：挂载同一套 ui/client，dev 代理 /api → Koa
│       └── public/        # 同一套 SPA 构建产物（Vite 打包 ui + client）
├── packages/
│   ├── server/
│   │   ├── core/      # Git 引擎：git CLI 封装
│   │   ├── api/       # 功能服务层：src/ 下一个功能一个文件
│   │   └── contracts/ # 契约：REST 端点、zod schema、SSE 事件、领域类型、错误码
│   └── client/
│       ├── ui/        # base/domain/composite 组件分层 + graph-layout/（纯函数布局引擎）
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
| `diff.ts` | 大 diff 流式输出（chunk 事件），`-z` 解析文件名；`readFileAtRev`（`git show <rev>:<file>` / 工作区读文件，供 Monaco 两侧全文） |
| `blame.ts` / `refs.ts` / `stash.ts` / `credential.ts` | 对应 CLI 原语的薄封装（credential helper 桥接后置） |

**性能与正确性要点**：

- 全部解析走 `-z`（NUL 分隔）或自定义分隔符，文件名含空格/换行/中文均安全；
- log 图流式 + 前端虚拟滚动，支撑大仓库（Linux 内核级）；
- 测试用**真实 git CLI + 临时仓库 fixture**（init → 造提交 → 造分支/冲突），不 mock git；纯解析函数补单测。
- 流式取消语义统一：`streamGit` 与 `runGit` 同为 aborted-flag 模式；close 时 aborted 一律 reject `GitExitError`(130)；消费者 break 时 try/finally 杀子进程并清理监听器；已中止 `signal` 预检。

**为什么不用 simple-git**：流式能力弱、长命令可控性差；自封装 `spawn` 直接可控。

### 4.2 api —— 功能服务层（一个功能一个文件）

**统一函数约定**：

- 入参：`repoPath: string` 显式传入 + 领域参数（**无 HTTP 对象、无隐藏全局状态**，天然支持多仓库并发）；
- 返回：`contracts` 定义的领域类型；
- 流式功能（log、大 diff、长操作进度）：返回 `AsyncIterable<契约事件>`，由框架层转 SSE；
- 长操作与流式功能接受可选 `{ signal }` 支持取消（`getLogPage`/`streamLogEvents`/`getFileDiff`/`streamDiffEvents` 直通 core）；
- 错误：统一 `ServiceError { code, message, context?, cause? }`，`message` 为可直接展示的中文；**不抛 HTTP 概念**；
- 文件之间仅通过 `index.ts` 公共出口互调，禁止深层相对 import。

**完整功能清单（验证版，37 个功能文件 + errors.ts）**：

| 文件 | 功能与关键操作 | Java 侧证据 | 阶段 |
|------|----------------|-------------|------|
| `repo.ts` | 打开/验证/初始化/克隆、最近仓库、仓库元信息 | `GitRepositoryImpl`、`GitCloneUtils`、平台 `RecentProjectsManager` | P1 |
| `status.ts` | 工作区状态、未跟踪、忽略状态、分支/上游信息 | `GitUntrackedFilesHolder`、`GitIgnoredFilesHolder` | P1 |
| `log.ts` | 提交图（流式）、过滤、分页、提交详情、新标签页打开、在控制台显示 log | `GitLogProvider`、VCS Log UI、`GitExternalLogTabsProperties`、`ShowGitLogCommandAction` | P1 |
| `diff.ts` | 工作区/暂存/提交间 diff、流式、hunk 应用/回退、与分支比较、`getFileVersions`（Monaco 两侧全文：staged→HEAD/暂存区、默认→HEAD/工作区、`from/to`→指定两版本，成对校验） | `GitShowDiffWithBranchPanel`、`GitCompareWithBranchAction`、`GitStageDiffAction` | P1 |
| `settings.ts` | 应用设置：最近仓库、UI 偏好、**log 位置**、仓库级设置集中存储、git 可执行文件检测/引导、GPG 配置、SSH 配置 | `GitVcsPanel`、`GitExecutableSelectorPanel`、`GitGpgConfigDialog`、`SSHConnectionSettings` | P1 |
| `errors.ts` | `ServiceError` + 错误码表 | — | P1 |
| `operation.ts` | 进行中操作状态（merge/rebase/cherry-pick 检测）、进度事件、操作锁、**中止操作** | `GitFreezingProcess`、`GitMergeRebaseWidget`、`GitAbortOperationAction` | P2 |
| `reset.ts` | Reset：mixed/soft/hard、日志"Reset Current Branch to Here"（**经 CommitDetailsPanel 按钮入口**，非右键菜单）、**Undo Commit**（撤销最近提交） | `GitResetAction`、`GitNewResetDialog`、`GitUncommitAction` | P2 |
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
| `events.ts` | 仓库状态事件流：轮询式 `watchRepoStatus`（每 2s `getStatus` + 深比较，变化才产事件，`signal` 可取消，框架无关可单测；与 P2 `operation.ts` 的进行中操作状态互补） | 平台 `DvcsStatusWidget` 事件驱动刷新 | P1 |

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

- **领域类型**：`RepoStatus`、`CommitNode`/`GraphLine`、`DiffFile`/`DiffChunk`/`FileVersions`、`BranchRef`、`TagRef`、`StashEntry`、`Changelist`、`Conflict`、`Worktree`、`Submodule`、GitHub/GitLab 领域类型（`PullRequest`、`MergeRequest` 等）等全部定义于此。
- **端点契约**：每个端点一个 zod schema（query/body/响应/SSE 事件）。
- **路由约定**：仓库用 **repoId** 标识（`settings` 注册 `{id, path}` 映射，不暴露文件系统路径，未来可挂鉴权）；路由层以 `getRepoById` 解析 repoPath 后调 api。
- **错误形状**：`{ error: { code, message, context? } }`；`httpStatusFor(code)` 纯函数放本包，两个框架应用共用同一张映射表。
- **SSE 事件格式**：`{ type, payload }`，事件类型全部由本包定义；`serializeSseEvent` 纯函数统一帧序列化，两应用共用。

**P1 端点清单**（首跑即此清单，两应用完全对称；后续阶段按功能文件同模式扩展）：

```text
GET    /api/repos                        最近仓库列表
POST   /api/repos/open      {path} → {repoId}
GET    /api/repos/:repoId/status
GET    /api/repos/:repoId/log?limit=…&skip=…&author=…&path=…
GET    /api/repos/:repoId/log/stream      （SSE：log.line 增量）
GET    /api/repos/:repoId/diff?file=…&from=…&to=…&staged=…
GET    /api/repos/:repoId/diff/stream     （SSE：diff.chunk 分块）
GET    /api/repos/:repoId/events          （SSE：repo.state-changed；长操作进度随 P2 operation.ts 接入）
GET    /api/settings                       应用设置
PUT    /api/settings                       更新设置
```

**命名模式**（后续端点遵循）：`GET/POST/PUT/DELETE /api/repos/:repoId/<功能>/…`；写操作用 POST（语义如 `POST /api/repos/:repoId/staging` + `{action}`），长操作返回 `{operationId}` 并用 `/events` 推送进度。

### 4.4 client —— 客户端数据层

| Hook | 类型 | 说明 |
|------|------|------|
| `useRecentRepos` / `useOpenRepo` | SWR / mutation | 最近仓库 + 打开 |
| `useRepoStatus` | SWR | 状态条数据 |
| `useLogPage` | SWR | log 首屏快照（`limit`/`skip` 游标） |
| `useLogStream` | SSE 订阅 | `log.line` 增量追加 |
| `useFileDiff` / `useDiffStream` | SWR / SSE | diff 全文 / 分块（UI 走全文路径） |
| `useRepoEvents` | SSE 订阅 | `repo.state-changed` → 触发 status/log 的 revalidate |
| `useSettings` | SWR + mutation | `logInEditor` 等 |

- 类型全部来自 `contracts`；框架无关（SWR 在 Next client components 与 Vite SPA 均可运行，同源 `/api`）；
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
│                #   MonacoDiffView（React.lazy 懒加载 monaco-editor）、DiffView、ThreeWayMergeView、
│                #   EmptyState、OperationStatus
├── domain/      # 有 git 语义的领域组件：CommitGraph、RepoStatusBar、DiffViewer（并排/行内 +
│                #   staged/工作区切换 + 忽略空白开关）、CommitDetailsPanel、InteractiveRebaseTable、
│                #   BranchTree、StagingArea、ConflictList、DiffFileView、CommitForm…
├── composite/   # 页面/对话框级组合：RepoPage、LogPage、DiffPage、StatusPage、CommitDialog、MergeDialog…
└── graph-layout/# 自 vcs-log/graph 移植的布局算法（纯函数，不 import React）
```

依赖方向：`composite → domain → base`；`graph-layout` 仅被 `CommitGraph` 使用；**base/domain/composite 均不发起接口调用**（数据由 props 传入）。

首跑页面流程：RepoPage 打开仓库 → `/repos/[repoId]` LogPage（顶栏 RepoStatusBar + CommitGraph + 右侧 CommitDetailsPanel）→ 点文件 → DiffPage。

#### 4.5.4 判定结论

1. **基础 UI 组件（antd）满足要求**——通用控件面无需从 Java 版移植；
2. **Rebased 的 Java UI 组件代码不适合直接使用**——Swing/Jewel 渲染模型与 React 不通；
3. **必须从 Rebased 拿走的资产有两类**：图布局算法（代码级移植 + testData 行为等价验证，Apache-2.0 保留声明）与各功能面板的信息架构（4.5.2 对照表）；深色视觉风格作为可选项对齐。

#### 4.5.5 CommitGraph 与 graph-layout（首跑规格）

**移植范围**（`platform/vcs-log/graph` 最小必需集，其余随迭代扩展）：

| Java 侧 | 职责 | 首跑 |
|---------|------|------|
| `GraphLayoutBuilder` + `GraphLayoutImpl` | lane 分配 + 行布局 | ✅ 移植 |
| `EdgePrintElementImpl` / `PrintElementGeneratorImpl` | 边路由（直连/折线/merge 展开行） | ✅ 移植 |
| `GraphColorGetterByHead` / `ByNode` | 分支着色（按 HEAD ref 名 hash → HSB 色板） | ✅ 移植 |
| `VisibleGraphImpl` + `RowsMapping` | 可见行映射（分页/增量行号对齐） | ✅ 移植 |
| `BfsUtil`/`DfsUtil`/`GraphUtil` | 图遍历工具 | ✅ 移植（子集） |
| `PermanentGraph`/过滤/折叠/虚线过滤边 | 缓存与高级视图 | ❌ 首跑不做 |

**模块接口**（纯函数，不 import React；移植方式与 testData 行为等价验证见 §4.5.1）：

```ts
// packages/client/ui/src/graph-layout/
export interface LayoutCommit { hash: string; parents: string[]; refs: string[] }
export interface LayoutRow { commit: LayoutCommit; lane: number; edges: EdgeSegment[]; color: string }
export function buildLayout(commits: LayoutCommit[]): LayoutRow[]
```

- 输入来自 `CommitInfo`（core 的 `graph` 文本字段不用于渲染，仅 debug 对照——渲染完全交给 layout 模块）
- SSE 增量：每批到达对当前窗口重算（O(n)），行号经 `RowsMapping` 对齐

**CommitGraph 渲染**：DOM 行（图列 + 提交信息列），图列用 SVG 单层 + 绝对定位；不用 canvas（配合虚拟滚动与选中态）；`VirtualList` 固定行高窗口渲染；SSE 增量 = 首屏 `getLogPage` 快照 + `useLogStream` 追加；行默认列 **Subject（图+refs chips）+ Author + Date**（Hash 列省；tag chips 默认关闭、分支 chips 开）；行悬停完整 hash、点击行 → 提交详情面板。

#### 4.5.6 首跑 UX 一致性对齐（证据见附录 B）

1. **提交详情面板字段集**：短 hash+复制、作者、日期（"{0} on {1} at {2}"）、加粗 subject、分支/标签 chips（两组、可复制）、父提交链接（`CommitDetailsPanel.kt:71-199`）；文件变更列表与签名状态不进（Java 面板内本来也没有）。
2. **CommitGraph 行默认列**：Subject + Author + Date；tag chips 默认关闭（`VcsLogApplicationSettings.kt:113`）。
3. **RepoPage 最近列表项**：显示名三级回退（`.idea/.name` → 目录名 → 路径；`RecentProjectsManagerBase.kt:1123-1184`）、路径副文本（user-home 相对化）、移除动作（带确认；`RemoveSelectedProjectsAction.kt:19-77`）、最近优先/去重/上限 50。
4. **DiffPage**：默认并排；忽略空白开关（默认不忽略，对齐 Java DEFAULT）。
5. **RepoStatusBar ahead/behind 形态**：彩色圆点徽标（蓝 incoming / 绿 outgoing）+ tooltip 计数，两者为 0 不显示——**Java 2025 版已无 ↑↓ 数字文本**，勿做旧版形态。
6. **默认值文档化**：logInEditor=true、word diff（BY_WORD）、行号开、sync scroll 开——全部与 Java 一致。

**两处前提修正**（实现约束）：状态条无 ↑↓ 文本；详情面板无操作按钮（动作在右键菜单，首跑不提供按钮与 Java 完全一致）。

### 4.6 框架层：web-next 与 web-koa

**共同模式**：每个路由只做三件事 —— **zod 校验（contracts schema）→ `getRepoById` 解析 repoPath → 调 api → `toServiceError` + `httpStatusFor` 错误映射**。`AsyncIterable → SSE` 序列化（`serializeSseEvent`）是 `contracts` 的纯函数，apps 内零逻辑重复；两应用端点清单完全对称（§4.3）。

**web-next**（Next.js 16，App Router）：

- `app/layout.tsx`：SSR 壳（antd ConfigProvider、深色主题默认、全局 chrome、加载骨架）；
- 页面主体：client components 组装 ui + client；
- `app/api/repos/…/route.ts`：每个端点一个 `GET/POST/PUT` Route Handler，薄封装调服务层；SSE 用 `ReadableStream.from(asyncIterable 映射 serializeSseEvent)`；客户端断开用 `request.signal` → AbortController → 停写并杀 git 进程；
- Server Actions 仅作为表单类操作的便捷封装，REST 为主（保证与 web-koa 对称）。

**web-koa**（Koa.js）：

- `src/routes/repos.ts`：同一份端点清单（koa-router）；SSE 写 `ctx.res` 并监听 `close` 取消；
- `src/middleware/`：错误处理、`@koa/bodyparser` body 解析、SSE 流、`koa-static` 托管 `public/`；
- `public/`：**同一套 ui + client 的 Vite SPA 构建产物**（SPA 路由 react-router，`/` 与 `/repos/:repoId` 与 web-next 路径一致）。

**运行形态**：两个应用均本地运行（localhost，本地优先访问仓库）。`web-next`：`next dev` → http://localhost:3030。`web-koa`：Koa API 服务 `tsx watch src/app.ts` → http://localhost:3031；dev 下 Vite dev server（localhost:5173）承载 SPA 页面并把 `/api` 代理到 3031（与 Koa 不同端口避免冲突）；生产 `vite build` → `koa-static` 在 3031 直接托管 `public/` + API。根 `pnpm dev` 并行起两个，端口被占用先杀占用进程（AGENT.md 既有约定）。

**依赖要点**：`web-next` 增 `next@16.2.7`、`react/react-dom@19`、`antd@6`、`@ant-design/icons`、`swr`、`monaco-editor`（懒加载）、`tailwindcss`、`zod`、`@rebased/{api,ui,client,contracts}`（workspace:*）；`web-koa` 增 `koa`、`@koa/router`、`@koa/bodyparser`、`koa-static`、`tsx`、`vite@7.3.6`（钉版）、`@vitejs/plugin-react`、`@rebased/{api,contracts}`（ui/client 为构建期依赖）；`ui` 增 `antd@6`、`@ant-design/icons`、`monaco-editor`；`client` 增 `swr`。依赖安装走 JD 镜像，`pnpm.overrides` 钉版 vite 7.3.6（既有配置，不新增钉版）。

---

## 5. 通信与流式约定

| 场景 | 机制 |
|------|------|
| 常规读写 | REST（zod 校验，JSON） |
| log 图增量、大 diff、长操作进度、仓库状态变更 | SSE（`{type, payload}` 事件流），事件类型由 contracts 定义 |
| 大结果集 | 分页（`limit`/`skip` 游标） |
| 取消 | 客户端断开 SSE 连接 → 框架层 AbortSignal → 服务层取消 git 进程 |

事件类型（首批）：`log.line`、`diff.chunk`、`operation.progress`、`operation.state-changed`、`repo.state-changed`。

---

## 6. 测试与质量

| 层 | 测试 |
|----|------|
| core | 真实 git CLI + 临时仓库 fixture（造提交/分支/冲突/重命名）；解析函数单测；取消语义三断言（exitCode 130 / 已中止预检 / break 杀进程） |
| api | fixture 仓库集成测试，不经 HTTP 直接调服务（框架无关的可测试性红利）；`events.ts` 事件流首事件与变化检测 |
| contracts | zod 解析、`httpStatusFor` 映射、SSE 序列化单测 |
| ui | Testing Library + 交互测试；`graph-layout` 用 Java testData 转制的行为等价夹具 |
| client | mock fetch / mock SSE 测试（revalidate 触发、增量追加） |
| apps | 只测路由装配（zod 校验 + 错误映射），不重复测服务逻辑；SSE 断开回归断言 git 进程被终止（不 mock api 层，真实 git fixture） |

质量门（根命令，与 AGENT.md 一致）：`pnpm typecheck`（project references 全链类型）→ `pnpm format` → `pnpm test`。eslint 边界规则违反即失败。

### 6.1 测试性能基线（防腐化）

> 2026-09-02 实测：全套 `pnpm test` 从 **1759s → 359s（4.9×）**。本节记录成本模型、机制与护栏——后续迭代新增测试时以此为准，防止性能腐化回退。

**基线数据**

| 包 | 优化前 | 优化后 | 关键手段 |
|----|--------|--------|----------|
| contracts | 3.1s | 1.2s | 无改动（已近地板） |
| core | 929.0s | 89.0s | 建仓 0 spawn + 夹具快照 + `maxWorkers: 4` 文件并行（原 `fileParallelism: false`） |
| api | 160.2s | 92.3s（单独跑） | 同上 + `maxWorkers: 8`；全量并发下受其他 git 包争用约为 159s |
| ui | 197.8s | 87.2s | 纯函数测试切 node 环境 |
| web-koa | 242.4s | 108.1s | 单文件 171 用例 → 11 文件并行 |
| web-next | 195.9s | 101.1s | 单文件 160 用例 → 10 文件并行 + sse flake 修复 |

**成本模型**：本机单次 git 进程 spawn ≈ **330ms**（msys2 git + 杀软开销；`rev-parse`/`status` 各 10 次均值）。全套数千次 spawn 曾贡献 20+ 分钟纯进程开销。测试性能的第一性优化 = 削减 spawn 数，其次才是并行度。

**机制（按收益排序）**

1. **建仓模板化**（core/api `src/testing/tmp-repo.ts`）：模块级用真实 `git init` 建一次模板仓库，`[user]` 段以 `writeFileSync` 直接追加 `.git/config`；之后每次 `createTmpRepo()` 仅 `cpSync` 复制（0 spawn）。模板目录随进程存续，残留交给系统临时目录清理。
2. **身份环境变量**（core/api `src/testing/setup.ts`）：注入 `GIT_AUTHOR_NAME/EMAIL`、`GIT_COMMITTER_NAME/EMAIL`（值 = `Test User` / `test@example.com`），夹具中所有 `git config user.name/email` 行删除。注意：**`git config --local --get` 不读环境变量**——断言 `localValue` 的用例必须显式写配置（web-next `rest.test.ts` 以本地包装 registerRepo 处理，见该文件注释）。
3. **夹具快照**（core/api `src/testing/fixture.ts` 的 `instantiateFixture(template)`）：同构夹具（三提交/冲突/裸远端 rig）在 `beforeAll` 用真实 git 各建一次模板，用例复制独立副本（互不污染，可任意修改）。模板目录放独立 `templateDirs`，由**文件级** `afterAll` 清理——若混入各 describe 共享的 `dirs`，首个 describe 的 afterAll 会提前删掉后续仍要用的模板。
4. **远程 rig 复制的 URL 修正**：repo 与 bare 两个目录都复制后，须文本替换 repo 的 origin URL 指向 bare 新副本。坑：gitconfig 值内反斜杠以 `\\` 转义存储，替换时两侧都要 `p.replace(/\\/g, '\\\\')`；`.gitmodules` 与 `.git/modules/<path>/config` 存的是正斜杠形式（`submodule add` 按入参原样写入），按正斜杠替换。
5. **并行度配置**（改动前读各包 `vitest.config.ts` 注释）：
   - core：`maxWorkers: 4` + 文件级并行。历史（15 worker 全并行）下 msys2 git 并发导致交互式 rebase 30s 超时与临时目录竞态；P0 把 spawn 数砍掉大半后，4 worker 连续 3 跑全绿。**若复现 flake，回退 `fileParallelism: false` 即可，其余优化不受影响**。
   - api：`maxWorkers: 8`（默认 nCPU 并发 × 每文件数十 spawn 会互相拖慢单次 spawn，并曾出现 forks worker 终止超时）。
   - core/api 均设 `hookTimeout: 120000`：模板 beforeAll 钩子串行执行数十次 spawn，默认 10s 必然超时。
   - 根 `package.json` test 脚本 `--workspace-concurrency=4`；如需继续压总时长，可实验 3 或 git 重包/轻包错峰（api 在全量并发下从 92s 恶化到 159s 即争用代价）。
6. **大套件拆分**：web-koa/web-next 按域一个 describe 一个文件（11/10 个），共享纯辅助函数放 `apps/*/src/testing/`（web-koa `integration.ts`、web-next `routes-helpers.ts`），文件级 server/环境生命周期各自持有。单文件套件无法并行，是墙钟上限。
7. **ui 纯函数测试**：`// @vitest-environment node` 文件头跳过 jsdom；`src/testing/setup.ts` 的 DOM 补丁（ResizeObserver/matchMedia）以 `typeof window !== 'undefined'` 守卫，node 环境下不执行。

**新增测试的规矩**

| ✅ 必须 | ❌ 禁止 |
|---------|---------|
| 建仓用 `createTmpRepo()` / `createTmpDir()` | 测试内直接 `git init`（裸仓库装置除外） |
| 同构夹具 beforeAll 建模板 + `instantiateFixture` | 每用例 `makeXxxRepo()` 全量重建 |
| 身份靠 setup 环境变量 | 夹具里 `git config user.name/email`（断言 localValue 除外） |
| 纯函数测试标 node 环境 | 无 DOM 依赖仍跑 jsdom |
| 按域新增小测试文件 | 向既有大套件无限追加用例 |

**回归护栏**

- 全量回归预算 **~6 分钟**（基线 359s）。明显超预算时，看 vitest 输出的每文件 Duration，最慢文件优先按上述机制复查。
- 腐化信号：测试里出现新的 `git init` 夹具调用；`fileParallelism: false` 被无注释改回；web-koa/web-next 重新出现超百用例单文件；全量并发下 api 墙钟远超其单独跑值且无注释说明。

### 6.2 首跑验收标准（P1 可见产品完成定义）

1. http://localhost:3030 与 http://localhost:3031 均可打开 RepoPage，打开真实仓库后看到 CommitGraph（真图渲染）
2. log 首屏快照 + SSE 增量渲染工作；断开页面后 git 进程被终止（无泄漏）
3. DiffPage：Monaco 并排/行内切换、忽略空白开关、staged/工作区切换正确
4. RepoStatusBar 徽标/tooltip 与 `/events` 推送触发 revalidate
5. 提交详情面板字段集完整（§4.5.6(1)）
6. `pnpm typecheck` → `pnpm format` → `pnpm test` 全绿；eslint 边界（apps 互禁、api 禁框架）生效

路由层测试方式补充：Next route 函数直接构造 `Request` 断言 `Response`（状态码/错误 JSON/zod 拒绝）；Koa 直接调 `app.callback()`；SSE 测试读流首帧断言 `data: {"type":"log.line"...`，断开连接断言 git 进程被终止。

---

## 7. 落地顺序

1. **骨架**：清理旧 `packages/web` 遗留（server.ts、Electron、@tiegongji/*）→ 建 7 包结构 + workspace/tsconfig project references/eslint 边界规则 → 更新 `AGENT.md`。
2. **contracts**：领域类型 + P1 端点 schema + 错误码表。
3. **core**：`exec`/`repo`/`status`/`log`/`diff` 原语 + 集成测试。
4. **api**：`repo` `status` `log` `diff` `settings` `errors` + 测试。
5. **首跑组装（web-next + web-koa，P1 可见产品：打开仓库 → CommitGraph 真图渲染 + SSE 增量 → Monaco 单文件 diff → 状态条/事件推送）**，细化为：
   1. 依赖安装（两 app + ui/client deps，vite 钉版 7.3.6）+ 包配置（next.config/vite.config/tsconfig）
   2. core/api 增补：streamGit 取消对齐 + readFileAtRev + signal 透传 + events.ts + getFileVersions（含 130/预检/break 三个取消断言与事件测试）
   3. graph-layout：移植 + Java testData 行为等价夹具
   4. ui：base（VirtualList/GraphCanvas/MonacoDiffView）→ domain（CommitGraph/RepoStatusBar/DiffViewer/CommitDetailsPanel）→ composite（三页面）
   5. client：SWR/SSE hooks
   6. web-next：壳 + 路由（含 SSE）+ 页面挂载 → 3030 可跑
   7. web-koa：路由 + 中间件 + Vite SPA → 3031 可跑
   8. UX 对齐 6 项逐项落地（§4.5.6）
   9. 全链验收（§6.2 标准）+ 终审 + 合并决策
6. P2–P4 按清单逐项增量（每个功能 = api 一个文件 + 契约 + 两端路由 + ui 组件，各自独立子项目）。

> 首跑在 `feat/server-core` 分支进行；合并回 main 的决策挂起（待首跑验收通过后与用户确认）。

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

---

## 附录 B：UX 一致性对照（Java 版 vs 本设计，审计 2026-09-01）

结论：**无 ❌ 不一致项**；6 项 ⚠️ 已并入 §4.5.6；📌 推迟项与"明确不做"项如下。

### B.1 打开仓库/克隆/最近项目

| Java 侧证据 | 判定 |
|-------------|------|
| 最近列表最近优先、渲染面板 `RecentProjectPanel.java:486-557` | ✅ |
| 显示名三级回退 `RecentProjectsManagerBase.kt:1123-1184` | ⚠️→§4.5.6(3) |
| 路径副文本 user-home 相对 `RecentProjectPanel.java:521-557` | ⚠️→§4.5.6(3) |
| 移除动作+确认 `RemoveSelectedProjectsAction.kt:19-77` | ⚠️→§4.5.6(3) |
| 顺序最近优先/去重/上限 50 `RecentProjectsManagerBase.kt:387-434` | ⚠️→§4.5.6(3) |
| 打开路径表单 | ✅ |
| 欢迎屏整体 `FlatWelcomeFrame.kt:111-125` | 明确不做（RepoPage 取代） |
| 克隆对话框（URL+Directory+浅克隆行；新版无 Test/分支选择）`VcsCloneDialog.kt:33-131` | 📌 推迟（P2 补 UI，最小字段 URL+Directory） |
| 列表项分支后缀/图标/失效标记 | 📌 推迟（装饰性） |

### B.2 VCS Log UI

| Java 侧证据 | 判定 |
|-------------|------|
| CommitGraph（图+refs chips）`VcsLogGraphTable.java:176` | ✅ |
| 按 HEAD 着色 `GraphColorGetterByHead.kt:11-17` | ✅（§4.5.5 移植） |
| HEAD 装饰/实心描边 `GraphTableModel.kt:102-117` | ✅ |
| tag chips 默认关 `VcsLogApplicationSettings.kt:113` | ⚠️→§4.5.6(2) |
| 行默认列 Subject/Author/Date `VcsLogColumnManager.kt:31` | ⚠️→§4.5.6(2) |
| 详情面板 `CommitDetailsPanel.kt:56` | ✅ |
| 详情字段集 `CommitDetailsPanel.kt:71-199` | ⚠️→§4.5.6(1) |
| 文件变更列表（独立 `VcsLogChangesBrowser`） | 📌 推迟（Java 面板内也没有） |
| 操作按钮（面板内无，右键菜单） | ✅（首跑不提供 = 与 Java 面板一致；动作属 P3） |
| 过滤/搜索（文本即滤 Ctrl+L + 分支弹窗为高频）`VcsLogClassicFilterUi.kt:148-152` | 明确不做（P2 次优先补文本即滤+分支弹窗） |
| 分支折叠 | 明确不做 |
| showInEditor=true `VcsLogApplicationSettings.kt:145-146` | ✅（logInEditor=true；TS 免重启为改进） |

### B.3 Diff 查看器

| Java 侧证据 | 判定 |
|-------------|------|
| 并排/统一两模式 `DiffRequestProcessor.java:937-1040` | ✅（Monaco side-by-side/行内） |
| 默认并排（独立对话框）`DiffManagerImpl.kt:95-101` | ⚠️→§4.5.6(4) |
| 行号/语法高亮 | ✅（Monaco） |
| word diff BY_WORD 默认 `TextDiffSettingsHolder.kt:46` | ✅（§4.5.6(6) 文档化） |
| 忽略空白开关（默认不忽略）`TextDiffSettingsHolder.kt:47` | ⚠️→§4.5.6(4) |
| staged/工作区/三版本 `GitStageDiffUtil.kt:191-252` | ✅（首跑两版本；三版本属 P2 staging） |
| 提交间对比 `GitDiffFromHistoryHandler.java:86-99` | ✅（from/to） |
| 折叠开关/sync scroll/上下文行数 | 📌 推迟（默认已对齐） |
| unified 保留 `UnifiedDiffTool.java` | ✅ |

### B.4 状态条

| Java 侧证据 | 判定 |
|-------------|------|
| 分支名（长名截断）`GitBranchWidget.kt:46,64` | ✅ |
| ahead/behind 圆点徽标+tooltip，0 不显示，无 ↑↓ 文本 `GitInOutState.kt:70-109` | ⚠️→§4.5.6(5)（含前提修正） |
| 进行中操作前缀 `GitBranchUtil.java:193-204` | 明确不做（P2 operation.ts） |
| 点击弹窗/hover tooltip | 📌 推迟 |
| 事件驱动刷新 `DvcsStatusWidget.java:145-166` | ✅（对应 SSE /events） |

### B.5 设置

| Java 侧证据 | 判定 |
|-------------|------|
| logInEditor 默认 true + 复选框 `VcsLogConfigurable.kt:62-65` | ✅ |
| 自动 fetch（默认关，高级设置门控） | 明确不做（P3 remote/update） |
| 保护分支（默认 master/main） | 明确不做（P2 branch.ts） |

---

## 附录 C：推迟项清单（按优先级）

1. **P2 次优先**：log 文本即滤框 + 分支过滤弹窗（Java 高频入口）
2. **P2 补 UI**：克隆/init 对话框（最小字段 URL+Directory）
3. **P2 承接**：进行中操作状态前缀（operation.ts）、三版本对比（staging.ts）
4. **P3**：cherry-pick/revert 右键菜单动作、保护分支、自动 fetch
5. **装饰后置**：最近列表分支后缀/图标/失效标记、diff 折叠/sync/上下文设置、状态条点击弹窗
