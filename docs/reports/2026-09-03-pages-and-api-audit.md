# Rebased 操作页面与 Rebased.js 接口盘点报告

- **日期**：2026-09-03（初版）；2026-09-07 全量复核
- **复刻状态基线**：`D:\zhanglei1120\Github\rebasedjs` HEAD `7d9b850`（P2/P3/P4-A/B 全部收官，P4-C 决策定形）
- **参照系**：`D:\zhanglei1120\Github\rebased`（Java/Kotlin 版 Rebased，基于 IntelliJ 平台的 Git 客户端）
- **审计对象**：rebasedjs（TS + React 全栈重写，pnpm monorepo）
- **依据**：`docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md`（架构 spec，其结论已对 Java 源码逐一核查）+ 对本仓两端路由、容器、组件、契约的逐文件实测（附录 B 含 Java 侧抽查证据）

---

## 一、总览

### 1.1 结论速览

| 口径 | 结论 |
|------|------|
| 操作页面/面板（31 个） | **29 ✅ + 2 🟡 等效 = 31/31** |
| 功能域（36 + 2 可选） | **36/36 落地**（browse 历史快照浏览 2026-09-08 轻量复刻落地，见任务清单 §2.8）；可选 2 项（terminal、local-history）明确不做 |
| 端点路径 / HTTP 方法 | **89 / 103**（web-next 89 个 route.ts ↔ web-koa repos.ts 103 注册，14 路径双方法，两端完全对称） |
| 半使用接口 | 0（diff/stream 分块文本已接 Monaco 渐进渲染；staging/hunks 已接行内 hunk 选择） |
| `@rebased/api` 公共出口 | 108 函数；未挂端点 0（`initRepo`/`cloneRepo` 已挂 `/repos/init`、`/repos/clone`） |
| 契约层 | zod schema 63、领域类型/别名 88、SSE 事件 6 种在用、错误码 8 实际产生 / 4 预留 |
| 导航边（104 条） | 66 ✅（含等价边）+ 8 🟡 + 7 ➖ + 23 ❌ |

### 1.2 口径与图例

- **维度 A（功能域）**：后端功能面，36 个 + 2 可选后置；**维度 B（页面）**：用户可见操作面（页面/面板/对话框），共 **31 个**。二者非一一对应（如 commit 功能对应 CommitDialog + modal UX；remote 功能对应 Push/Pull/UpdateProject 三个对话框）。面向用户的口径是 31 个页面；面向功能覆盖的口径是 36 个功能域。
- **状态图例**：✅ 已复刻（端到端可用，含等价边——Java 形态在 Web 以等价通道承载）｜🟡 部分复刻（服务/组件/契约就绪但链路未通、默认行为对齐、或等价形态承载）｜❌ 未复刻（含"明确不做"项）｜➖ Java 概念在 Web 形态无对应。
- **等价判定规则**：Java 多 tab 工具窗口 ↔ `/repos/:id/<页>` 路由（LogPage 为仓库枢纽页）；Java 模态对话框 ↔ 内嵌 Modal 或页面化路由；Java Git 主菜单/状态栏 widget/主工具栏 ↔ LogPage 顶栏按钮 +「更多」菜单 + OperationStatus 操作条；Java 编辑器内嵌（Blame/gutter 注解）↔ 独立页面 + 页内路径输入（Web 无编辑器宿主）。

### 1.3 明确不做清单（决策记录）

| 项 | 决策 |
|----|------|
| terminal（内置终端） | 不做：web 端服务端 shell 安全面大且与 Git 客户端核心价值正交 |
| local-history（本地历史） | 不做：无编辑器宿主；与 LogPage 提交历史重叠 |
| QuickActionsMenu 独立聚合组件 | 不做：🟡 等效——顶栏 +「更多」菜单 + 操作条已全覆盖 |
| 克隆/分享项目到 GitHub | 不做：`cloneRepo` 服务层能力后置 |
| GitHub Gist / GitLab Snippet | 不做 |
| 自托管 GitLab 实例 | 不做：仅 gitlab.com 形态 |
| 托管平台 OAuth/device 专属登录流 | 不做：PAT 经 Settings 账户卡片手动录入 |
| PR AI 描述 | 不做：需外部 AI 服务 |
| 打开 worktree 项目、Update 流程内子模块更新、分支弹窗 New Working Tree | 不做：无多项目会话模型 / 独立面板已承载 / 入口在更多菜单 |

---

## 二、页面与功能域

### 2.1 功能域清单（维度 A：36 + 2）
| 阶段 | 数量 | 功能域 | 状态 |
|------|------|--------|------|
| P1 | 5 | repo、status、log、diff、settings | ✅ 全量 |
| P2 | 12 | operation、reset、staging、changelist、commit、branch、checkout、merge、stash、conflict、config、auth | ✅ 全量 |
| P3 | 15 | rebase（含交互式）、cherry-pick、revert、tag、remote、update、blame、history、committed、search、patch、shelf、console、ignore、github | ✅ 全量（github 域 Gist 不做） |
| P4 | 4 | gitlab、worktree、submodule、browse | ✅ 全量（gitlab Snippet 不做；browse 轻量复刻已落地，见任务清单 §2.8） |
| 可选后置 | 2 | terminal、local-history | ❌ 明确不做 |

### 2.2 页面总览（维度 B：31 页面）

| # | 页面 | 用途（一句话） | 功能域 | 阶段 | 状态 |
|---|------|----------------|--------|------|------|
| 1 | RepoPage | 打开仓库 + 最近仓库管理（取代 Java 欢迎屏） | repo | P1 | ✅ |
| 2 | LogPage | 提交图浏览 + 状态条 + 提交详情（仓库枢纽页） | log + status | P1 | ✅ |
| 3 | DiffPage | 单文件差异查看（工作区/暂存/任意两版本） | diff | P1 | ✅ |
| 4 | StatusPage | Local Changes + 暂存区主页 | status/staging/changelist | P2 | ✅ |
| 5 | CommitDialog | 模态提交对话框 | commit | P2 | 🟡 等效（StatusPage 内嵌提交框） |
| 6 | ResetDialog | Reset / Undo Commit | reset | P2 | ✅（内嵌 LogPage 模态） |
| 7 | BranchPanel | 分支列表/仪表盘 + 检出 | branch/checkout | P2 | ✅ |
| 8 | MergeDialog | 合并对话框 | merge | P2 | ✅（页面化） |
| 9 | RebaseDialog | rebase + 交互式 rebase 编辑器 | rebase | P3 | ✅（内嵌 LogPage 模态） |
| 10 | StashPanel | 贮藏管理 | stash | P2 | ✅ |
| 11 | TagPanel | 标签管理 | tag | P3 | ✅ |
| 12 | RemotePanel | 远程仓库管理 + 凭据 | remote/auth | P3 | ✅ |
| 13 | PushDialog | 推送对话框 | remote | P3 | ✅（内嵌模态） |
| 14 | PullDialog | 拉取对话框 | remote | P3 | ✅（内嵌模态） |
| 15 | UpdateProjectDialog | Update Project（策略化更新） | update | P3 | ✅（内嵌模态） |
| 16 | BlameView | 文件溯源注解 | blame | P3 | ✅ |
| 17 | HistoryPanel | 文件历史（含重命名跟随） | history | P3 | ✅ |
| 18 | CommittedChangesPanel | 已提交变更浏览器 | committed | P3 | ✅ |
| 19 | SearchPanel | 提交搜索 | search | P3 | ✅ |
| 20 | ConflictsPanel | 冲突解决（3-way） | conflict | P2 | ✅ |
| 21 | PatchPanel | 补丁创建/应用/管理 | patch | P3 | ✅ |
| 22 | ShelfPanel | 搁置管理 | shelf | P3 | ✅ |
| 23 | WorktreePanel | 工作树管理 | worktree | P4 | ✅ |
| 24 | SubmodulePanel | 子模块管理 | submodule | P4 | ✅ |
| 25 | IgnoreDialog | .gitignore / exclude 编辑 | ignore | P3 | ✅ |
| 26 | GitHubPanel | GitHub 认证/PR 全流程 | github | P3 | ✅ |
| 27 | GitLabPanel | GitLab 认证/MR 全流程 | gitlab | P4 | ✅ |
| 28 | GitConsole | Git 命令输出控制台 | console | P3 | ✅ |
| 29 | QuickActionsMenu | 快捷操作聚合菜单 | 聚合各域 | P2+ | 🟡 等效（顶栏 + 更多菜单 + 操作条） |
| 30 | SettingsPage | 应用设置 + git 配置 | settings/config | P1/P2 | ✅ |
| 31 | BrowsePanel | 某提交处只读浏览文件树 + 文件内容（历史快照浏览） | browse | P4 | ✅ |

> 有路由的页面 23 个（`/` + `/repos/:id` 下 22 个子路由，两端对称）；内嵌模态 7 个（ResetDialog、RebaseDialog、PushDialog、PullDialog、UpdateProjectDialog、MergeView、AuthDialog）；CommitDialog 由 StatusPage 内嵌提交框承载、QuickActionsMenu 由顶栏+更多菜单聚合承载，均不计入已复刻页面数。

### 2.3 汇总

- ✅ 已复刻 29 个；🟡 等效 2 个（CommitDialog、QuickActionsMenu）。
- 功能点级 🟡 遗留（不影响页面级结论）：LogPage 过滤/分页 UI、BranchPanel 最近检出/标签分组与过滤、MergeDialog 远程分支合并、BlameView/HistoryPanel 的 diff 联动等——逐一见 §四各页功能点表。

---

## 三、接口盘点

### 3.1 端点总表（89 路径 / 103 方法，两端完全对称）

> 路径前缀 `/api`；`id` 即 `repoId`。SSE 3 个：`log/stream`、`diff/stream`、`events`。每个路由只做三件事：zod 校验 → 调 `@rebased/api` → 错误映射。

| 域 | 端点（`/api` 前缀省略） | 方法 | 用途 | 客户端消费 | 状态 |
|----|------------------------|------|------|-----------|------|
| repo | `repos` | GET | 最近仓库列表 | RepoPage、LogPage 显示名 | ✅ |
| repo | `repos/open` | POST | 打开仓库（校验 git 仓库 → 注册） | RepoPage 打开表单 | ✅ |
| repo | `repos/init`、`repos/clone` | POST ×2 | 初始化仓库 / 克隆仓库（成功后注册入最近列表） | RepoPage 初始化/克隆 Modal | ✅ |
| repo | `repos/:id` | DELETE | 从最近列表移除（幂等；同时清该仓库变更列表簿记） | RepoPage 移除 Popconfirm | ✅ |
| app | `app/home-dir` | GET | 宿主用户主目录（路径副文本 `~/` 相对化） | RepoPage（容器注入 homeDir） | ✅ |
| status | `repos/:id/status` | GET | 工作区状态（分支/上游/变更条目） | LogPage 状态条、StatusPage | ✅ |
| log | `repos/:id/log`、`repos/:id/log/stream` | GET | 提交历史分页快照 / SSE 增量流 | LogPage（快照+流 merge 去重） | ✅ |
| diff | `repos/:id/diff`、`diff/three-way` | GET ×2 | 单文件两侧全文（staged/from/to）/ 三版本三侧全文 | DiffPage、CommittedChangesPanel | ✅ |
| diff | `repos/:id/diff/stream` | GET | 大 diff SSE 分块流 | DiffStreamView 渐进渲染（全文未就绪期间呈现当前进度） | ✅ |
| diff | `repos/:id/diff/patch` | GET | unified patch 全文 | StatusPage 补丁预览、PatchPanel | ✅ |
| events | `repos/:id/events` | GET | SSE 仓库状态/操作推送（首帧双事件） | LogPage、StatusPage 等自订阅 | ✅ |
| settings | `settings` | GET/PUT | 应用设置读写 | SettingsPage | ✅ |
| auth | `auth/accounts`、`auth/accounts/delete` | GET/POST/POST | 账户/令牌存储（应用级） | SettingsPage 账户卡片、远程认证 | ✅ |
| config | `repos/:id/config` | GET/PUT | git 配置白名单 8 键读写 | SettingsPage | ✅ |
| operation | `repos/:id/operation`、`operation/abort`、`operation/continue` | GET/POST/POST | 进行中操作查询/中止/继续（continue 泛化四操作共用） | LogPage 操作条、ConflictsPanel「完成合并」 | ✅ |
| staging | `repos/:id/staging` | POST | 文件级 stage/unstage/discard | StatusPage | ✅ |
| staging | `repos/:id/staging/hunks` | POST | hunk 级暂存（按 diff/patch hunk 索引） | StatusPage 补丁预览行内 hunk 选择 | ✅ |
| commit | `repos/:id/commit` | POST | 提交（amend/signOff/noVerify） | StatusPage 提交框 | ✅ |
| branch | `repos/:id/branches` | GET/POST | 分支列表 / create/delete/rename/setUpstream | BranchPanel、MergeDialog | ✅ |
| checkout | `repos/:id/checkout` | POST | 检出 branch/newBranch/detach | BranchPanel | ✅ |
| reset | `repos/:id/reset`、`reset/undo-commit` | POST | 三模式 reset / 撤销最近提交 | LogPage ResetDialog / 顶栏 | ✅ |
| merge | `repos/:id/merge`、`merge/continue` | POST | 合并（四选项）/ 完成合并 | MergeDialog / ConflictsPanel | ✅ |
| conflicts | `repos/:id/conflicts`、`conflicts/contents`、`conflicts/resolve` | GET/GET/POST | 冲突列表 / 三阶段内容 / 四策略解决 | ConflictsPanel、MergeView | ✅ |
| stash | `repos/:id/stashes` | GET/POST | 贮藏列表 / save/apply/pop/drop/branch | StashPanel | ✅ |
| stash | `repos/:id/stashes/:index/diff`、`stashes/unstash-as` | GET + POST | 贮藏差异（`git stash show -p`）/ Unstash As（检出目标分支+apply） | StashPanel | ✅ |
| changelist | `repos/:id/changelists` | GET/POST | 变更列表查询 / create/rename/delete/setDefault/move | StatusPage 分组与管理 | ✅ |
| remote | `repos/:id/remotes`、`fetch`、`pull`、`push`、`update` | GET/POST + 4×POST | 远程 CRUD（含 fetch spec/unshallow）/ 拉取 / 推送（forceWithLease/setUpstream）/ 策略化更新 | RemotePanel、Pull/Push/Update 对话框 | ✅ |
| rebase | `repos/:id/rebase`、`rebase/todo`、`rebase/interactive` | POST/GET/POST | 变基 onto / todo 读取 / 交互式执行 | RebaseDialog（内嵌 LogPage） | ✅ |
| pick | `repos/:id/cherry-pick`、`revert` | POST | 摘樱桃 / 还原 | LogPage 详情面板按钮 | ✅ |
| tag | `repos/:id/tags` | GET/POST | 标签列表 / create(含附注)/delete/push | TagPanel | ✅ |
| blame | `repos/:id/blame` | GET | 逐行溯源（`--line-porcelain`） | BlameView | ✅ |
| history | `repos/:id/history` | GET | 文件历史（`--follow`） | HistoryPanel | ✅ |
| browse | `repos/:id/browse`、`repos/:id/browse/content` | GET ×2 | 指定版本文件树 / 单文件内容（二进制标记） | BrowsePanel | ✅ |
| committed | `repos/:id/committed` | GET | 已提交变更分页浏览 | CommittedChangesPanel | ✅ |
| search | `repos/:id/search` | GET | 提交搜索（grep/pickaxe） | SearchPanel | ✅ |
| patch | `repos/:id/patches`、`patches/create`、`patches/apply`、`patches/delete`、`patches/:name/import-shelf` | GET + 4×POST | 补丁列表 / 创建（三态）/ 应用（check 先行）/ 删除 / 导入搁置 | PatchPanel | ✅ |
| shelf | `repos/:id/shelves` | GET/POST | 搁置列表 / save/restore/drop | ShelfPanel | ✅ |
| console | `repos/:id/console` | GET | 命令执行记录（token 剥离） | ConsolePanel | ✅ |
| ignore | `repos/:id/ignore`、`ignore/add`、`ignore/templates` | GET/PUT + 2 项 | .gitignore/exclude 读写 / 一键忽略 / 内建模板 | IgnoreDialog、StatusPage | ✅ |
| github | `repos/:id/github/status`、`prs`、`prs/:n`、`prs/:n/timeline`、`prs/:n/comments`、`prs/:n/review-comments`、`prs/:n/files`、`prs/:n/review`、`prs/:n/merge`、`prs/:n/checkout` | GET×7 + POST×5 | 检测（远程+令牌三态）/ PR 列表·详情·时间线·评论·**行级评审评论**·文件·审查·三策略合并·检出 | GitHubPanel | ✅ |
| gitlab | `repos/:id/gitlab/status`、`mrs`、`mrs/:iid`、`mrs/:iid/timeline`、`mrs/:iid/comments`、`mrs/:iid/discussions`、`mrs/:iid/files`、`mrs/:iid/review`、`mrs/:iid/merge`、`mrs/:iid/checkout` | GET×6 + POST×6（mrs 双方法） | 检测 / MR 列表·新建·详情·时间线·评论·**行级讨论**·文件·审查·合并·检出 | GitLabPanel | ✅ |
| worktree | `repos/:id/worktrees`、`worktrees/remove`、`worktrees/prune` | GET/POST + 2×POST | 工作树列表 / 创建 / 移除 / 清理 | WorktreePanel | ✅ |
| submodule | `repos/:id/submodules`、`submodules/update` | GET/POST | 子模块列表（四态）/ 更新（init/recursive） | SubmodulePanel | ✅ |

**小结**：89 路径全部有客户端消费方，无死接口；半使用 0（diff/stream 分块文本已接 Monaco 渐进渲染、staging/hunks 已接行内 hunk 选择——P0 两项消化完毕，见任务清单 §2.1）。

### 3.2 契约层（`@rebased/contracts`）

- **zod schema（63 个）**：覆盖全部入参校验（body/query/路径参数），域分布：repo（open/init/clone）/log/diff（含 three-way）/settings/config、staging/commit、branch/checkout、reset、merge/conflict、stash（含 unstash-as/index）、changelist、account、remote/fetch/pull/push/update、rebase/pick/tag、blame/history/browse、committed/search、patch/shelf/console/ignore（含 patch import-shelf name）、github（注释/审查/合并/**行级评论**）、gitlab（评论/讨论/审查/合并/创建）、worktree/submodule——全部被两端路由使用，无闲置。
- **SSE 事件（6 种在用）**：`log.line`、`diff.chunk`、`repo.state-changed`、`operation.state-changed`（events 首帧双事件）、`refs.changed`（fetch/pull/push 后引用移动，首帧全量基线）、`stream.error`（流内错误帧）。`operation.progress` 未实现（无进度型长任务 UI 面）。
- **错误码（12 个）**：实际产生 8 个——`REPO_NOT_FOUND`、`NOT_A_GIT_REPO`、`INVALID_QUERY`、`GIT_ERROR`、`INVALID_REF`、`OPERATION_IN_PROGRESS`、`AUTH_FAILED`（远程 401 → 认证重试回路）、`RATE_LIMITED`（GitHub 限流）；预留 4 个——`CONFLICT`、`HOOK_FAILED`、`STALE_LOCK`、`CANCELLED`。映射表 `httpStatusFor` 两端共用。
- **领域类型（88 项）**：贯穿 api → 路由 → client hooks → ui props 全链路。

### 3.3 服务层与使用状态

- `@rebased/api` 公共出口 108 函数（38 模块，一功能一文件），全部挂端点或被框架层使用（`getRepoById`/`toServiceError` 为路由装配基础设施）。
- **未挂端点 0**：`initRepo`/`cloneRepo` 已随 repo 域收尾挂 `/repos/init`、`/repos/clone`（见任务清单 §2.2 完成记录）。
- **半使用接口 2 个**：`streamDiffEvents`（diff/stream 已订阅未渲染）、`applyHunkStaging`（无 UI 入口）。

---

## 四、31 页面逐一详析

> 功能点以 Java 版 Rebased 源码核查结论（架构 spec §4.2/§4.5.2、组装 spec §6 与附录 A）为参照系；落点为两端对称实现的实测位置。

### 4.1 RepoPage ✅

应用入口页——打开本地 Git 仓库 + 最近仓库列表管理；取代 Java 欢迎屏 `FlatWelcomeFrame` + RecentProjects（组装 spec 明确不做欢迎屏整体）。

- **落点**：路由 `/`；组件 `composite/repo-page.tsx`；服务 `api/repo.ts`；端点 `GET /api/repos`、`POST /api/repos/open`、`POST /api/repos/init`、`POST /api/repos/clone`、`DELETE /api/repos/:id`、`GET /api/app/home-dir`；两端容器同构（`open-repo-flow.ts` 通用入库流程）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 打开路径表单（校验 → 验证 git 仓库 → 注册 → 跳日志页） | ✅ | 失败 message.error，`NOT_A_GIT_REPO` 映射两端一致 |
| 最近列表：打开即注册、同路径复用 id、最近优先 | ✅ | `openedAt` 降序 + 同路径去重 |
| 显示名 | ✅（定案单级） | 注册时以目录名命名；`.idea/.name` 依 spec §2.2 无对应概念，单级为定案口径（不再保留三级回退表述） |
| 路径副文本 `~/` 相对化 | ✅ | `relativeToHome` + 容器经 `GET /api/app/home-dir` 注入 `homeDir` |
| 列表上限 50 | ✅ | 服务端 `RECENT_LIMIT=50` 与组件 `MAX_RECENT=50` 同口径（原有效上限 20 为不一致） |
| 移除动作 + Popconfirm | ✅ | `DELETE /api/repos/:id`（幂等）；同清 `recentRepoIds` 与该仓库变更列表簿记 |
| 克隆对话框（URL + Directory） | ✅ | `POST /api/repos/clone` + RepoPage 克隆 Modal（对齐 `VcsCloneDialog` 最小字段集） |
| 初始化仓库入口 | ✅ | `POST /api/repos/init` + RepoPage 初始化 Modal |
| 列表项分支后缀/图标/失效标记 | ❌ | 装饰性后置（见任务清单 §2.2 完成记录） |

### 4.2 LogPage ✅

仓库主页——提交图浏览（真图渲染 + 渐进加载）+ 顶栏状态条/操作条/入口聚合 + 提交详情面板；对应 Java VCS Log UI（`VcsLogGraphTable` / `CommitDetailsPanel` / `GitBranchWidget`）。

- **落点**：路由 `/repos/:id`；组件 `composite/log-page.tsx` + `domain/{commit-graph,repo-status-bar,commit-details-panel}` + `graph-layout/`；端点 `log`、`log/stream`（SSE）、`status`、`events`（SSE）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 提交图真图渲染（lane 分配/边路由/可见行映射） | ✅ | `graph-layout/` 移植 `GraphLayoutBuilder`、`PrintElementGeneratorImpl`、`VisibleGraphImpl`+`RowsMapping` 最小集；Java 7 组 testData 转 vitest 夹具行为等价 |
| 分支着色（ref 名 hash → HSB 色板） | ✅ | 复刻 `javaStringHashCode` 与 `GraphColorGetterByHead`；测试断言 Java 实测色值 |
| 虚拟滚动（固定行高窗口渲染） | ✅ | 行高 24、lane 宽 18 |
| 首屏快照 + SSE 增量渐进渲染 + hash 去重合成 | ✅ | 流为同一查询的渐进渲染（Ruling 6） |
| 取消链路（断开即杀 git 进程） | ✅ | 130/预检/break 三断言有测试 |
| 行默认列 Subject + Author + Date（Hash 列省） | ✅ | 对齐 `VcsLogColumnManager` |
| refs chips：分支默认开 / tag 默认关 | ✅ | 对齐 `VcsLogApplicationSettings` |
| 行点击 → 提交详情面板（短 hash+复制、作者行、subject、双组 chips、父提交链接） | ✅ | 对齐 `CommitDetailsPanel.kt:71-199` |
| 详情面板操作按钮：浏览快照 / Reset 到此处 / 摘樱桃 / 还原 | ✅ | Java 面板内本无按钮（动作在右键菜单），Web 以面板按钮承载等价入口；冲突跳冲突页 |
| 顶栏状态条：分支名（detached 提示）、incoming 蓝/outgoing 绿徽标 | ✅ | 对齐 `GitInOutState` 2025 版形态 |
| 状态变更自动刷新（事件驱动） | ✅ | `repo.state-changed` → 回写缓存 + 重验证日志 + 重订阅流 |
| `refs.changed` 订阅（分支/标签/贮藏建删移动） | ✅ | 重验证日志快照（ref chips/图可达性）+ 全局分支列表键 |
| `?select=<hash>` 深链（定位选中提交） | ✅ | BlameView/HistoryPanel/SearchPanel 结果点击均经此回跳 |
| 顶栏入口：状态/分支/合并/贮藏/设置 5 按钮 | ✅ | 等价 Java 工具窗口 tab 组 + Git 主菜单入口面 |
| 「更多」菜单：18 项入口聚合 | ✅ | 拉取/推送/更新项目/远程管理/变基/标签/溯源/历史/已提交/搜索/补丁/搁置/控制台/忽略/GitHub/GitLab/工作树/子模块；GitHub/GitLab 带检测门，工作树/子模块恒渲染 |
| OperationStatus 操作条（kind 展示 + 中止） | ✅ | `GET /operation` + `operation.state-changed` + `POST /operation/abort` |
| 远程操作认证重试回路 | ✅ | `AUTH_FAILED` → 关对话框开 AuthDialog（host 自 context，不含 token）→ retry 重放 |
| 分页（limit ≤500 / skip 游标） | ✅ | 「加载更多」limit 阶梯放大（50→100→…→500 封顶）；过滤或翻页时切快照模式（流仅默认视图接入，Ruling 6 同查询约束） |
| 过滤（author / path） | ✅ | 「文本即滤」双输入（作者/路径，Enter/失焦提交，去首尾空白；清空即恢复）；与服务端 `--author`/`-- path` 过滤一致 |
| 行右键菜单形态 | ✅ | 行右键菜单（对齐 Java `Vcs.Log.ContextMenu` 组）：检出（游离 HEAD）/ 从此处新建分支（创建后检出）/ 从此处新建标签（附注可选）/ 在浏览器中打开（GitHub/GitLab 提交页链接）+ 摘樱桃·还原·Reset·浏览快照复用面板按钮；Push up to Commit、Show All Affected、reword/fixup/squash/drop 直通为余项（见任务清单 §2.3） |
| 分支折叠 / PermanentGraph 高级视图 | ❌ | 2026-09-08 重新裁定：由「明确不做」改为**可选任务**（依赖过滤 UI 与 PermanentGraph 类缓存结构先行，见任务清单 §2.8） |
| 新标签页打开 log、为命令过滤的 log | ❌ | internal 动作未做 |

### 4.3 DiffPage ✅

单文件差异查看——工作区/暂存/任意两版本对比；对应 Java diff/merge 查看器的单文件部分（`DiffRequestProcessor`、`GitStageDiffUtil`）。

- **落点**：路由 `/repos/:id/diff?file=&staged=&from=&to=`；组件 `composite/diff-page.tsx` + `domain/diff-viewer.tsx` + Monaco 基础组件；端点 `diff`、`diff/stream`（SSE）、`diff/patch`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| Monaco DiffEditor（懒加载、行号、语法高亮、只读） | ✅ | 语法高亮替代 TextMate 插件（spec §2.1） |
| 并排（默认）/行内切换、忽略空白开关（默认不忽略） | ✅ | 对齐 `DiffManagerImpl` / `TextDiffSettingsHolder` 默认值 |
| staged / 工作区切换（三态映射） | ✅ | staged→HEAD vs 暂存区；默认→HEAD vs 工作区 |
| 任意两版本对比（from/to 成对校验） | ✅ | CommittedChangesPanel 文件点击 → `from=<hash>~1&to=<hash>` |
| 新增/删除/重命名文件两侧渲染 | ✅ | A/D/R 侧缺失修复；重命名 renameFrom 呈现 |
| unified diff 文本视图 | ✅ | `GET /diff/patch` 供补丁预览/创建/hunk 索引；本页走两侧全文路径 |
| 大 diff 分块流渲染 | ✅ | 分块文本接入 Monaco（DiffStreamView：language `diff` 只读渐进渲染；与全文同参 Ruling 6，全文到达切换标准视图） |
| word diff/同步滚动/折叠/上下文行数 | ✅ | word diff 与同步滚动为 Monaco diff 引擎内建（行内词级高亮 + 双侧联动）；「折叠」→ folding、「空白字符」→ renderWhitespace、「上下文行数」→ hideUnchangedRegions（仅变更区 + N 行，默认 5——对齐 Java context lines）均有 UI 开关 |
| 三版本对比（本地/暂存/HEAD） | ✅ | `GET /diff/three-way`（三侧全文）+ ui ThreeWayView（HEAD→暂存、暂存→工作区两段 MonacoDiffView）+ StatusPage 行「三版本」入口（→ `/diff?three=1`）；若文件仅一个维度有差异，另一段显示「无差异」空视图 |
| hunk 级应用 / 回退、与分支比较 | ❌ | 未做（`GitStageDiffAction` / `GitCompareWithBranchAction`） |

### 4.4 StatusPage ✅

Local Changes + 暂存区主页——工作区变更分组、暂存/取消暂存、提交；对应平台 Local Changes（`ChangeListManager`）+ `GitStage*` 暂存区 UI。

- **落点**：路由 `/repos/:id/status`；组件 `composite/status-page.tsx`；服务 `api/{staging,commit,changelist}.ts`；端点 `staging`、`staging/hunks`、`commit`、`diff/patch`、`changelists`；本页自订阅 events。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 变更分组列表（已暂存/工作区/未跟踪） | ✅ | 按 porcelain XY 码分三组（`!!` 已忽略不展示）；组头全选 + 组级操作 |
| 变更列表子分组与管理 | ✅ | create/rename/delete/setDefault/move；默认列表平铺、非默认列表子标题分组、行级"移动到列表" |
| 暂存/取消暂存/放弃修改（文件级） | ✅ | stage/unstage/discard 按条目状态分派 restore/clean |
| hunk 级暂存 | ✅ | 补丁预览行内 hunk 选择（勾选 → 暂存/取消暂存/放弃选中）；切片与索引经 contracts `splitPatchHunks` 与服务端同源（P0 消化，见任务清单 §2.1） |
| 行内补丁预览 | ✅ | 选中文件 → `GET /diff/patch`；staging/commit 后失效重取 |
| 提交框（CommitDialog 等效，见 4.5） | ✅ | message + amend/signOff/noVerify；commit 后 key remount 清空 |
| 跳 DiffPage | ✅ | `onOpenDiff` → `/diff?file=`（staged 切换在 diff 页内） |
| 未跟踪行「忽略」一键入口 | ✅ | Modal.confirm → `ignore/add` → status 补刷 |
| 三版本对比（本地/暂存/HEAD） | ✅ | 行「三版本」按钮 → `/diff?file=&three=1`（`GET /diff/three-way` 三侧全文 + ui ThreeWayView 两段对比） |

### 4.5 CommitDialog 🟡（等效非模态形态）

提交——Java 插件 `intellij.vcs.git.commit.modal` 的新版提交 UX（changelist 选择、amend/sign-off/GPG、提交范围）。**模态对话框形态未做**；以 StatusPage 内嵌提交框承载（对齐 Java 非模态提交模式）。

- **落点**：`api/commit.ts` + `POST /commit`；提交框在 `composite/status-page.tsx` 内。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 提交（信息必填、范围=勾选条目所属列表） | ✅（等效） | 身份预检（未配置 user.name/email → 引导去设置页） |
| amend（改上次提交） | ✅ | 须给新 message（`git commit --amend -m`） |
| sign-off / 跳过 hooks | ✅ | signOff / noVerify 复选框 |
| amend 历史提交 / reword | ❌ | 依赖交互式变基编辑器（4.9）可达，非直通按钮 |
| GPG 签名 / commit template | ❌ | 白名单键可在设置页读写，提交链路未消费 |
| CRLF 提示 | ❌ | `GitCrlfDialog` 未做 |
| commit & push / push up to commit | ❌ | 组合执行器未做 |

### 4.6 ResetDialog ✅（内嵌 LogPage 模态）

Reset 与 Undo Commit；对应 `GitResetAction` / `GitNewResetDialog` / `GitUncommitAction`。

- **落点**：组件 `composite/reset-dialog.tsx`；端点 `POST /reset`、`POST /reset/undo-commit`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| Reset soft / mixed / hard | ✅ | 三模式单选；ref 预检失败 → `INVALID_REF` |
| Reset Current Branch to Here | ✅（等价） | 详情面板按钮 → 内嵌模态（右键菜单形态未做） |
| Undo Commit | ✅ | 顶栏 Popconfirm → soft reset HEAD~1（保留改动到暂存区） |

### 4.7 BranchPanel ✅

分支列表/仪表盘 + 检出操作；§4.5.2 对照 `BranchesTreeModel`（分组维度、过滤、合并状态图标）。

- **落点**：路由 `/repos/:id/branches`；组件 `composite/branch-panel.tsx`；服务 `api/{branch,checkout}.ts`；端点 `GET/POST /branches`、`POST /checkout`；本页自订阅 events（外部 CLI 检出/建删自动刷新）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 分组（本地/远程两组）与过滤 | ✅ | 远程行只读；文本过滤（名称子串，两组共用）+「仅看已合并」开关；"最近检出/标签"维度仍后置（见任务清单 §2.3 余项） |
| 行内信息：current 标记 / 上游 + ahead/behind 徽标 / 已合并图标 | ✅ | `mergedIntoHead` 绿色对勾 |
| 创建（起始点可选 + 创建后检出开关）/删除（未合并提示 force）/重命名/设上游 | ✅ | 删除走 Popconfirm |
| 检出：既有分支 / 新建并检出 / detached（标签/提交） | ✅ | 三态；检出文件未做 |
| 查找已合并 / 清理已合并与过时分支 | ✅ | 「仅看已合并」开关 +「清理已合并（N）」批量删除（已合并且非当前本地分支，Popconfirm → 逐条 delete，完成重验证列表） |
| 保护分支 / force-push 后修复 / checkout with rebase | ❌ | 未做 |

### 4.8 MergeDialog ✅（页面化对话框）

合并对话框；对照 `GitMergeDialog` + `GitOptionsPanel`。

- **落点**：路由 `/repos/:id/merge`（open 常驻，取消=返回日志页）；组件 `composite/merge-dialog.tsx`；服务 `api/merge.ts`；端点 `POST /merge`、`POST /merge/continue`；结果三分支：已是最新留页 / 成功返回 / 冲突预填缓存跳 ConflictsPanel。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 合并方向选择 | 🟡 | 固定"本地分支 → 当前分支"；远程分支 v1 不支持直接合并 |
| merge 策略/commit 选项 | ✅ | no-ff / squash / no-commit + 合并信息 |
| 进行中状态联动（中止入口、冲突跳转） | ✅ | `OperationState`（kind: 'merge'）+ `OPERATION_IN_PROGRESS` 互斥 |

### 4.9 RebaseDialog ✅（内嵌 LogPage 模态）

rebase 对话框 + 交互式 rebase 编辑器；对照 `GitRebaseCommitsTableView/Model` + `GitInteractiveRebaseDialog`。

- **落点**：组件 `composite/rebase-dialog.tsx`；服务 `api/rebase.ts` + core sequence-editor shim；端点 `POST /rebase`、`GET /rebase/todo`、`POST /rebase/interactive`；结果分派：conflicts → 跳冲突页。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| rebase onto（目标基选择） | ✅ | 简单模式：onto 输入 + 开始 |
| 交互式列表：pick/reword/squash/fixup/drop + 上移/下移 | ✅ | base 输入 → todo 拉取 → 行内动作 Select；首行禁上移、末行禁下移（对齐 Java 排序约束）；无效 base 显式报错不误示空列表 |
| continue / abort / 冲突联动 | ✅ | 冲突 → ConflictsPanel；「完成合并」走 `operation/continue` 泛化；abort 走操作条；skip 未做 |
| auto-squash / fixup、squash by subject | ❌ | 未做 |

### 4.10 StashPanel ✅

贮藏管理；对应 `GitStashDialog` / `GitUnstashAsDialog` / `GitStashBranchComponent`。

- **落点**：路由 `/repos/:id/stashes`；组件 `composite/stash-panel.tsx`；服务 `api/stash.ts` + core 贮藏原语；端点 `GET/POST /stashes`；本页自订阅 events。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| stash save | ✅ | message 可空 + includeUntracked（`-u`）；keep index 未做 |
| pop / apply / drop | ✅ | 按 `stash@{index}`；弹出/删除 Popconfirm；不存在 → `INVALID_REF` |
| stash as branch | ✅ | 转分支 Modal（`git stash branch`） |
| Unstash As 对话框 | ✅ | 行「Unstash As…」Modal：目标本地分支 Select（检出目标分支 + apply，不 drop——GitUnstashAsDialog 语义） |
| 查看差异 | ✅ | 行「查看差异」Modal：`git stash show -p` unified 补丁（`GET /stashes/:index/diff`；边 #84 等效承载） |

### 4.11 TagPanel ✅

标签管理；对应 `GitTagHolder` / `GitPushTagsAction`。

- **落点**：路由 `/repos/:id/tags`；组件 `composite/tag-panel.tsx`；服务 `api/tag.ts`；端点 `GET/POST /tags`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 创建标签（含附注） | ✅ | name 必填 + ref 默认 HEAD + message 非空即附注 |
| 删除标签 | ✅ | 行内 Popconfirm（本地标签；删除远程未做） |
| 推送标签 | ✅ | 行内推送；推送全部未做 |

### 4.12 RemotePanel ✅

远程仓库管理 + 凭据；对应 `GitConfigureRemotesDialog`、`GitHttpAuthService` / `GitHttpLoginDialog`。

- **落点**：路由 `/repos/:id/remotes`；组件 `composite/remote-panel.tsx` + `composite/auth-dialog.tsx`；服务 `api/remote.ts`（token 注入 + `AUTH_FAILED` 携带 host）；端点 `GET/POST /remotes`、`POST /fetch`、`POST /pull`、`POST /push`、`POST /update`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 远程添加/删除/编辑 | ✅ | 编辑 setUrl 同写 fetch/push URL；删除 Popconfirm |
| fetch（fetch spec、全远程/单远程） | ✅ | `FetchResult.updatedRefs` + `refs.changed` 推送 |
| shallow 识别 / unshallow | 🟡 | fetch 端点 unshallow 既有；shallow 识别徽标未做 |
| HTTPS 认证对话框 / token 存储 | ✅ | 401 → `AUTH_FAILED` → AuthDialog（token 写回账户存储）→ retry 重放；credential helper 由系统 git 自处理（spec §8） |

### 4.13 PushDialog ✅（内嵌模态）

推送对话框；对应 `GitRejectedPushUpdateDialog` / `GitPushTagsAction`。

- **落点**：组件 `composite/push-dialog.tsx`（LogPage 容器内嵌）；端点 `POST /push`；入口「更多」菜单「推送」。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| push（远程/分支选择、当前分支推送） | ✅ | 远程 Select + 分支输入 + setUpstream（默认勾）+ forceWithLease（安全强推） |
| rejected push → 自动 Update 联动 | ❌ | `PushOutcome.rejected` 带 hint 呈现，自动弹更新对话框未做 |
| push tags / force-push 后修复 | 🟡 | push tags 由 TagPanel 行内；修复联动未做 |

### 4.14 PullDialog ✅（内嵌模态）

拉取对话框（远程与分支选择）；对应 `GitPullDialog`。

- **落点**：组件 `composite/pull-dialog.tsx`（LogPage 容器内嵌）；端点 `POST /pull`；入口「更多」菜单「拉取」。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| pull（远程/分支选择） | ✅ | 远程缺省由服务端取当前分支上游；rebase Checkbox；conflicts → 跳冲突页 |
| fetch 全远程 / fetch spec 定制 | ✅ | 由 RemotePanel 顶部动作与 `fetchBodySchema.refspec` 承载 |

### 4.15 UpdateProjectDialog ✅（内嵌模态）

Update Project——策略化更新入口；对应 `GitUpdateOptionsDialog` / `GitUpdateSession` / `FixTrackedBranchDialog`。

- **落点**：组件 `composite/update-project-dialog.tsx`（LogPage 容器内嵌）；服务 `api/update.ts`；端点 `POST /update`（fetch 全远程 + 按策略合入当前分支）；入口「更多」菜单「更新项目」。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| merge/rebase 策略选择 | ✅ | 默认 merge |
| 更新会话（进度/结果汇总） | 🟡 | 单仓库一次性结果呈现（fetched + pull 状态）；Java 多仓库会话未做（Web 单仓库模型） |
| 修复跟踪分支（Reset to tracked） | ❌ | 未做 |

### 4.16 BlameView ✅

文件溯源注解（逐行显示最后修改提交/作者/日期）；对应 `GitAnnotationProvider` / `GitAnnotationService`。

- **落点**：路由 `/repos/:id/blame`；组件 `composite/blame-view.tsx`；服务 `api/blame.ts`（core `blame --line-porcelain`）；端点 `GET /blame`；`?file=` 初始值 + 页内路径输入。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 注解展示 | ✅（等效形态） | 行列表（行号/作者/日期/内容 + hash 短名徽标）承载注解语义（Web 无编辑器 gutter） |
| 注解点击联动 | ✅ | hash 徽标 → LogPage `?select=`；行内「差异」→ DiffPage from/to（父哈希出 blame `parents` 批量解析，根提交 → `root=1`）；行内「历史」→ HistoryPanel（边 #29/#33） |
| previousLineno 边界 | ✅ | orig 近似边界注释在案 |

### 4.17 HistoryPanel ✅

单文件提交历史（含重命名跟随）；对应 `GitFileHistory` / `GitHistoryTraverser`。

- **落点**：路由 `/repos/:id/history`；组件 `composite/history-panel.tsx`；服务 `api/history.ts`（core `log --follow`）；端点 `GET /history`；`?file=` 初始值 + 页内输入。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 文件历史列表 | ✅ | 条目：短哈希 + subject + 作者 + 日期 |
| 重命名跟随（`--follow`） | ✅ | 改名前的提交同样列出 |
| 版本 diff 联动 | ✅ | 条目点击 → 日志页 `?select=`；双击 → DiffPage from=父哈希&to=该提交（%P 解析，根提交 `root=1`）；行内「Annotate Revision」→ `/blame?rev=`（边 #30/#31）；历史条目与溯源行现均带父哈希 |

### 4.18 CommittedChangesPanel ✅

Committed Changes 浏览器——按提交浏览已提交变更；对应 `CommittedChangesBrowser` + `GitCommittedChangeListProvider`。

- **落点**：路由 `/repos/:id/committed`；组件 `composite/committed-changes-panel.tsx`；服务 `api/committed.ts`；端点 `GET /committed`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 按提交浏览已提交变更 | ✅ | 提交列表左栏 + 分页「加载更多」 |
| 目录树组织变更文件 | 🟡 | 平铺列表（A/M/D/R 徽标 + renameFrom）；目录树未做 |
| 与 diff 查看器联动 | ✅ | 文件点击 → `/diff?file&from=<hash>~1&to=<hash>` |

### 4.19 SearchPanel ✅

提交搜索；对应 `GitSearchUtils` / `GitSearchEverywhereContributor`。

- **落点**：路由 `/repos/:id/search`；组件 `composite/search-panel.tsx`；服务 `api/search.ts`；端点 `GET /search`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 提交搜索（grep / pickaxe） | ✅ | 双模式 Segmented（信息 grep / 内容 pickaxe）；非法正则 → 400 |
| 结果 → 日志页 | ✅ | 行点击 → `?select=<hash>` |
| Search Everywhere 式全局搜索 | ➖ | Web 无全局宿主；分支快速搜索未做 |

### 4.20 ConflictsPanel ✅

冲突解决主页——冲突文件列表 + 3-way 合并视图；对照 `GitConflictsPanel` + 平台 3-way merge。

- **落点**：路由 `/repos/:id/conflicts`；组件 `composite/conflicts-panel.tsx` + `composite/merge-view.tsx`（左 ours/右 theirs/底部结果编辑，全屏 Modal）；端点 `GET /conflicts`、`GET /conflicts/contents`、`POST /conflicts/resolve`、`POST /operation/continue`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 冲突文件列表 + 类型徽标 | ✅ | stages 组合推导（双方修改/双方新增/删除修改等）；分组未做 |
| 整侧解决（ours/theirs） | ✅ | 删除/修改冲突对应侧禁用 +「删除该文件」（delete 策略） |
| 3-way 手动合并 | ✅ | MergeView 保存走 manual 策略；外部 `git add` 解决经 events 重验证 |
| 完成合并（continue 泛化） | ✅ | merge/rebase/cherry-pick/revert 共用；成功返回日志页 |
| 合并状态联动 | ✅ | 进行中提示页内；中止入口在 LogPage 操作条 |

### 4.21 PatchPanel ✅

补丁创建/应用/已保存补丁管理；对应平台 patch 包 + `GitStageCreatePatchActionProvider`。

- **落点**：路由 `/repos/:id/patches`；组件 `composite/patch-panel.tsx`；服务 `api/patch.ts` + `api/shelf.ts`；端点 `GET /patches`、`POST /patches/create`、`POST /patches/apply`、`POST /patches/delete`、`POST /patches/:name/import-shelf`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 创建补丁（unified diff 导出） | ✅ | 三态：工作区/暂存/提交区间（from/to 单侧缺省=HEAD） |
| 应用补丁 | ✅ | `git apply --check` 先行；空补丁 no-op；失败诚实报错 |
| 补丁列表管理 | ✅ | 名/大小/时间 + 删除 Popconfirm；重名 → `INVALID_QUERY` |
| 导入补丁到搁置 | ✅ | 行内「导入搁置」→ `importPatchIntoShelf`（同名搁置存补丁全文；重名 → `INVALID_QUERY`、补丁不存在 → `INVALID_REF`）；成功后跳 ShelfPanel（`ImportIntoShelfAction:74` activateView 语义） |

### 4.22 ShelfPanel ✅

Shelf 搁置——变更的本地暂存架（与 git stash 互补的平台能力）；对应平台 `com/intellij/vcs/shelf`。

- **落点**：路由 `/repos/:id/shelves`；组件 `composite/shelf-panel.tsx`；服务 `api/shelf.ts`；端点 `GET/POST /shelves`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 搁置保存 | ✅ | 工作区+暂存 diff + 未跟踪文件随档；重名 → `INVALID_QUERY` |
| 恢复 / 删除 | ✅ | restore（空补丁跳过 apply 仅回拷；同名冲突跳过不覆盖）/ drop；不存在 → `INVALID_REF` |
| Unshelve 联动 | ✅ | restore 成功后 status 键重验证（工作区变更进入状态页，边 #54：平台 Unshelve 无自动切 tab 证据，Web 等价 = events 刷新） |

### 4.23 WorktreePanel ✅

git worktree 管理；对应 `GitWorkingTreeDialog` / `workingTrees/ui`。

- **落点**：路由 `/repos/:id/worktrees`；组件 `composite/worktree-panel.tsx`；服务 `api/worktree.ts` + core 路径归一原语；端点 `GET/POST /worktrees`、`POST /worktrees/remove`、`POST /worktrees/prune`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 工作树列表 | ✅ | `--porcelain`：path/branch/detached 徽标 +「当前」标记；realpath 归一修正主工作树 path |
| 工作树创建 | ✅ | 互斥 Radio（关联已有分支/创建新分支）；realpath 校验阻止仓库内/嵌套工作树 |
| 移除 / 清理 | ✅ | 行内移除（`--force` API 支持）+ prune |
| 打开 worktree 项目 | ❌ 明确不做 | 用户自开仓库 |

### 4.24 SubmodulePanel ✅

子模块状态与更新；对应 `GitSubmoduleUpdater` / `GitSubmodule` / `GitModulesFileReader`。

- **落点**：路由 `/repos/:id/submodules`；组件 `composite/submodule-panel.tsx`；服务 `api/submodule.ts` + core `format` 净化原语；端点 `GET /submodules`、`POST /submodules/update`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 子模块状态列表（`.gitmodules` 解析） | ✅ | 含空格/点号陷阱有单测锁定；四态徽标（未初始化/已检出/提交漂移/冲突）；损坏配置 → 诚实 GIT_ERROR |
| 子模块更新（init/update） | ✅ | 行内 + 全量（recursive Checkbox） |
| Update 流程内更新子模块 | ➖ 明确不做 | 独立面板承载 |

### 4.25 IgnoreDialog ✅

`.gitignore` / `.git/info/exclude` 编辑；对应 `GitIgnoreFileActionGroup` / `DefaultGitExcludeAction` / ignore-lang。

- **落点**：路由 `/repos/:id/ignore`；组件 `composite/ignore-dialog.tsx`；服务 `api/ignore.ts`；端点 `GET/PUT /ignore`、`POST /ignore/add`、`GET /ignore/templates`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 创建/编辑/模板 | ✅ | 双 target 切换 + 模板替换预览（Node/Python/通用）+ 保存 |
| 一键忽略文件/目录 | ✅ | StatusPage 未跟踪行入口（Modal.confirm → `ignore/add`，追加 `/path` 幂等） |

### 4.26 GitHubPanel ✅

GitHub 集成——认证、PR 全流程；对应 `github-core`（accounts/pullrequest/ui）。Java 侧 Issues/通知仅剩无 UI 的内部加载器，不覆盖。

- **落点**：路由 `/repos/:id/github`（「更多」菜单项，检测 github.com 形态远程才渲染）；组件 `composite/github-panel.tsx`；服务 `api/github.ts`（REST api.github.com，mock 可测、零真实网络依赖测试）；端点 9 个（见 3.1）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 账户/token 认证 | ✅ | `findToken('github.com')` + Settings 账户卡片（PAT 录入） |
| PR 列表/详情/时间线/评论 | ✅ | 时间线 = issue comments + review summaries 合并（旧→新）；空评论拦截 |
| PR 审查（approve/request changes） | ✅ | reviewDecision 徽标 |
| diff 视图 | ✅ | 行级视图落地：逐 hunk 两侧 MonacoDiffView（`parseUnifiedDiff` 行映射；`@@` 绝对行号头行 + 上下文标题）；降级：renamed 无内容 → 仅提示、空 patch → 二进制/截断提示、截断按部分渲染；**行级评论锚点与提交落地**（GET/POST `/pulls/:n/review-comments`，新侧行号 Select + 输入 + 发送，线程按 hunk 挂靠——见任务清单 §2.7） |
| 三种合并策略 | ✅ | merge/squash/rebase + warning 路径 |
| 检出 PR 分支 | ✅ | fetch `+refs/pull/N/head` + `checkoutNewBranch('pr-N','FETCH_HEAD')`；跨键回写 status/branches |
| 克隆/分享、Gist、AI 描述 | ❌ 明确不做 | — |

### 4.27 GitLabPanel ✅

GitLab 集成——认证、MR 全流程；对应 `gitlab-core`（mergerequest、ui\review）。

- **落点**：路由 `/repos/:id/gitlab`（「更多」菜单项，检测 gitlab.com 形态远程才渲染）；组件 `composite/gitlab-panel.tsx`；服务 `api/gitlab.ts`（REST+mock，与 GitHub 同构模式）；端点 10 个（见 3.1）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 账户认证 | ✅ | `findToken('gitlab.com')` + Settings 账户卡片 |
| MR 创建/列表/详情/评论 | ✅ | 列表四徽标；新建 MR（源/目标分支 + 标题 + 描述）；时间线 notes+reviews 尽力合并 |
| MR diff 视图 | ✅ | 行级视图落地：逐 hunk 两侧 MonacoDiffView（与 GitHub 共用 `parseUnifiedDiff`/HunkDiffView）；降级同 GitHub；**行级讨论锚点与提交落地**（GET/POST `/mrs/:iid/discussions`，`position{new_path,new_line}` 投递——见任务清单 §2.7） |
| MR 审查（approve/request changes）/合并 | ✅ | 三映射（approve 端点 / reviews{state:rejected} / notes）+ reviewState 徽标；`merge {squash?}` |
| MR 检出 | ✅ | fetch `refs/merge-requests/:iid/head` + `checkoutNewBranch('mr-N','FETCH_HEAD')` |
| Snippet、自托管实例 | ❌ 明确不做 | — |

### 4.28 GitConsole ✅

Git 命令输出控制台；对应 `GitCommandOutputConsolePrinter` / `GitConsoleFoldingImpl`。

- **落点**：路由 `/repos/:id/console`；组件 `composite/console-panel.tsx`；服务 `api/console.ts`（core exec 环形缓冲）；端点 `GET /console?limit=`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| git 命令输出展示 | ✅ | 环形缓冲（cap 200/仓库，按 cwd 键控）+ token 剥离（`-c`+`/extraheader=/i` 整对删除）+ stderr 尾 500；列表（时间/args/退出码/耗时/stderr 尾）+ 刷新 |
| 输出折叠 / 按命令分组 | ❌ | 拉取式历史列表不承载实时折叠 |

### 4.29 QuickActionsMenu 🟡（等效聚合）

当前仓库可执行操作全集的快捷入口聚合；对照 `GitBranchesTreePopupOnBackend` / `GitQuickActionsToolbarPopup`。**独立组件明确不做**，由 LogPage 顶栏五按钮 +「更多」菜单 18 项 + OperationStatus 操作条承载等价职能。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 分支快捷弹窗 | 🟡 | 等价：顶栏「分支」→ `/branches` |
| 操作聚合（fetch/pull/push/stash/…） | 🟡 | 全量入口已聚合；Unshallow 经 fetch 端点既有；快捷键未做 |

### 4.30 SettingsPage ✅

应用设置 + git 配置页；对应 `GitVcsPanel` / `GitExecutableSelectorPanel` / `GitGpgConfigDialog` / `SSHConnectionSettings` / `VcsLogConfigurable` / `GitConfig`。

- **落点**：路由 `/repos/:id/settings`（key=repoId 切仓库强制重挂载）；组件 `composite/settings-page.tsx`；服务 `api/{config,auth}.ts`；端点 `GET/PUT /settings`、`GET/PUT /config`、`auth/accounts` 三端点。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 应用设置读写 | ✅ | logInEditor 开关 + recentRepoIds（RepoPage 列表承载） |
| git 配置白名单 8 键读写 | ✅ | ConfigRow 逐行（生效值展示 + local 覆盖输入 + 保存） |
| 账户/令牌管理 | ✅ | host/account/token 添加覆盖、Popconfirm 删除；token 不下行仅掩码；配置文件 0600 |
| 集中存储（Rebased 独家"禁用 .idea"的 TS 映射） | ✅ | 应用配置集中于 `api/lib/config-store` |
| git 可执行文件检测/引导 | ❌ | 未做 |
| GPG/SSH 专属配置对话框 | 🟡 | 白名单键 `commit.gpgsign`/`user.signingkey` 可读写；专属对话框未做 |
| 保护分支设置 / 自动 fetch 设置 | ❌ | 未做（Web 以事件推送替代定时 fetch） |

### 4.31 BrowsePanel ✅

历史快照浏览——以某提交为根的**只读文件树浏览**（展开目录、打开文件在该版本的内容）；对应 Java `GitBrowseRepoAtRevisionAction` 的平台 `RepositoryBrowser`（虚拟文件 + commit 上下文，不触碰工作区）。

- **落点**：路由 `/repos/:id/browse?rev=`；组件 `composite/browse-panel.tsx` + `base/file-tree.tsx`（目录树基础组件，与 CommittedChangesPanel 目录树任务共用）+ `domain/directory-tree.ts`（平铺路径 → 嵌套树纯函数）；服务 `api/browse.ts` + core `tree.ts`（`ls-tree -r` 原语，复用 `verifyCommitish`/`readFileAtRev`）；端点 `GET /browse`、`GET /browse/content`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 文件树浏览（目录聚合 + 初始一层展开） | ✅ | `ls-tree -r -z` 平铺条目 → 目录节点按 path 前缀聚合（目录在前、字母序）；子模块/符号链接仅徽标不深入 |
| 文件内容只读查看 | ✅ | 复用 `readFileAtRev`（`git show <rev>:<file>`）；二进制（含 NUL 字节）仅提示不渲染 |
| 降级边界 | ✅ | 无效 rev → `INVALID_REF`；该版本内文件不存在 → `INVALID_REF`；路径越界 → `INVALID_QUERY`；空版本显示空态 |
| 入口与导航边 | ✅ | LogPage 提交详情面板「浏览快照」按钮 → `/browse?rev=<hash>`；边 #22 的浏览部分由 ❌ 转 ✅（checkout 部分仍经 BranchPanel） |

---

## 五、导航图谱

### 5.1 容器形态与等价映射

31 个页面在 Java 版有 6 种容器形态（tab=切换共存、模态=叠层后返回、弹窗=瞬时菜单）：

| Java 容器形态 | 页面 | Web 等价形态 |
|---------------|------|--------------|
| 独立窗口/帧 | RepoPage；ConflictsPanel 的 3-way 合并视图；BrowsePanel（`RepositoryBrowser`） | 路由页 `/`；MergeView 全屏 Modal；`/browse` 路由页 |
| Version Control 工具窗口 tab | StatusPage、LogPage、StashPanel、ConflictsPanel、HistoryPanel、CommittedChangesPanel、ShelfPanel、GitConsole、WorktreePanel；GitHub/GitLab PR/MR 窗口 | `/repos/:id/<页>` 路由（LogPage 为枢纽页）；GitHub/GitLab 面板带远程检测门 |
| 模态对话框 | CommitDialog、ResetDialog、MergeDialog、RebaseDialog、TagPanel、RemotePanel、PushDialog、PullDialog、UpdateProjectDialog、PatchPanel、Stash save/Unstash As、Worktree 创建 | 内嵌 Modal（Reset/Rebase/Push/Pull/Update/MergeView/AuthDialog）或页面化路由（Merge/Settings/Remote/Tag/Patch/Stash）；CommitDialog=内嵌提交框 |
| 弹出（非模态弹窗/菜单） | BranchPanel、QuickActionsMenu、SearchPanel | 路由页；顶栏+更多菜单聚合 |
| 编辑器内嵌 | BlameView（gutter 注解）；DiffPage | 独立页面 + 页内路径输入；DiffPage 路由页 |
| 无独立 UI | SubmodulePanel、IgnoreDialog | 独立面板（SubmodulePanel）；IgnoreDialog 路由页 |

### 5.2 全局骨架

```text
RepoPage ──Open/双击最近项目──▶ LogPage（仓库枢纽页）
    │                              │ 顶栏：状态/分支/合并/贮藏/设置 + OperationStatus
    └──(克隆/初始化：服务层就绪，UI 未做)     │ 更多菜单：拉取/推送/更新项目/远程管理/变基/标签/溯源/
                                   │   历史/已提交/搜索/补丁/搁置/控制台/忽略/GitHub/GitLab/工作树/子模块
                                   └──▶ 21 个子路由页（「返回日志」回边一致）
```

### 5.3 逐页跳转表（104 边）

> 参照 Java 版 action 注册表与动作类源码（一手来源：`intellij.vcs.git.backend.xml`、`PlatformActions.xml`、`VcsActions.xml`、`vcs-log.xml`，见附录 B）。"跳转"口径：页面间导航边（菜单/按钮/弹窗/双击/右键/快捷键/tab 切换），不含页内交互。

#### 5.3.1 入口与设置域

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 1 | RepoPage → 主窗口 | 双击最近项目 / Open | `OpenSelectedProjectsAction`（PlatformActions.xml:1251） | ✅ 打开成功 `navigate(/repos/:id)` |
| 2 | RepoPage → 克隆对话框 → 主窗口 | Get from VCS | `GetFromVersionControlAction` → `VcsCloneDialog`；`ProjectCheckoutListener.java:21` | ✅ 克隆 Modal（URL + Directory）→ `POST /repos/clone` → 日志页 |
| 3 | RepoPage → SettingsPage | 欢迎屏 Configure | PlatformActions.xml:1208-1209 | ❌ |
| 4 | 主窗口 → RepoPage | File → Close Project | `CloseProjectsActionBase.kt:42-46` | ❌（LogPage 无回 `/` 入口） |
| 5 | 任意处 → SettingsPage | File → Settings | PlatformActions.xml:509-510 | ➖（改由 LogPage 顶栏进入） |
| 6 | LogPage → SettingsPage | Log tab 下拉 Show Settings | `Vcs.Log.ShowSettingsAction`（vcs-log.xml:324） | ✅ 顶栏设置按钮 → `/repos/:id/settings` |
| 7 | SettingsPage → LogPage | 关闭对话框回源页 | —（模态语义） | ✅ 「返回日志」按钮 |
| 8 | GitHub/GitLabPanel → SettingsPage | 面板菜单 Settings | `GHOpenSettingsAction.kt:13`、`GitLabOpenSettingsAction.kt:14` | ❌（无令牌提示卡带「去设置」回边，菜单入口未做） |

#### 5.3.2 日志 / 差异 / 历史域

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 9 | Git 菜单 → LogPage | Show Git Log | `Vcs.Show.Log`（backend.xml:181） | ➖（LogPage 即仓库主页） |
| 10 | BranchPanel → LogPage | Compare with Branch | `GitCompareWithBranchAction.kt:33` | ❌ |
| 11 | SearchPanel → LogPage | 结果回车定位 | `GitSearchEverywhereContributor.kt:179` | ✅ 结果点击 → `?select=<hash>` |
| 12 | HistoryPanel → LogPage | Show Commit in Log | `ShowCommitInLogAction`（vcs-log.xml:235） | ✅ 条目点击 → `?select=<hash>` |
| 13 | LogPage → DiffPage | 双击/Ctrl+D；Compare Revisions | `ShowDiffAction.java:114`；vcs-log.xml:275-276 | 🟡 经 StatusPage `onOpenDiff`、CommittedChangesPanel from/to 可达，LogPage 无直达 |
| 14 | LogPage → ResetDialog | 右键 Reset Current Branch to Here | `Git.Reset.In.Log`（backend.xml:345） | ✅ 详情面板按钮 → 内嵌模态 |
| 15 | LogPage → Undo Commit | 右键 Undo Commit | `Git.Uncommit`（backend.xml:347） | ✅ 顶栏 Popconfirm |
| 16 | LogPage → RebaseDialog | 右键 Interactively Rebase from Here | `GitInteractiveRebaseAction.kt:16-24`（backend.xml:354） | ✅ 「更多」→ 内嵌模态（简单/交互双模式） |
| 17 | LogPage → PushDialog | 右键 Push Commits up to Here | `GitPushUpToCommitAction.kt:60`（backend.xml:355） | ❌（PushDialog 已落地，「推至指定提交」语义未做） |
| 18 | LogPage → New Branch 对话框 | 右键 New Branch… | backend.xml:361-363 | ✅ 行右键「从此处新建分支…」Modal（起始点=该提交，创建后检出） |
| 19 | LogPage → New Tag | 右键 New Tag… | `GitCreateTagAction.java:39`（backend.xml:364） | ✅ 行右键「从此处新建标签…」Modal（附注可选；ref=该提交） |
| 20 | LogPage → 分支/标签操作子菜单 | 右键分支操作组 | `GitLogBranchOperationsActionGroup.java:188-205`（backend.xml:360） | 🟡 行右键菜单已含检出/New Branch/New Tag；Merge/Rebase 经 #79/#80；Push up to Commit 未做 |
| 21 | LogPage → Revert/Reword/Fixup/Squash/Drop | 右键（后四者入 rebase 引擎） | backend.xml:346-353 | 🟡 Revert=面板按钮直通；Reword/Fixup/Squash/Drop 经交互式变基编辑器可达 |
| 22 | LogPage → Checkout / 浏览历史快照 | 右键 Checkout 组 / Browse at Revision | backend.xml:337-342 | ✅ 行右键「检出此提交（游离 HEAD）」+ 详情面板「浏览快照」 |
| 23 | LogPage → PatchPanel | 右键 Create Patch from commit | vcs-log.xml:273 | ✅ 「更多」→ 创建 Modal 提交区间三态 |
| 24 | LogPage → GitConsole | tab 下拉 Console | vcs-log.xml:321-322 | ✅ 「更多」→ `/console` |
| 25 | LogPage → HistoryPanel | tab 下拉 Show History | vcs-log.xml:321 | ✅ 「更多」→ `/history`（页内输入路径） |
| 26 | LogPage → Open in Browser | 右键托管平台链接 | backend.xml:555-561 | ✅ 行右键「在浏览器中打开」（GitHub/GitLab 提交页链接，域检测驱动） |
| 27 | DiffPage 页内 | 多文件 Prev/Next | `DiffNextFileAction`/`DiffPreviousFileAction` | ❌（单文件模型） |
| 28 | 编辑器/项目树 → HistoryPanel | 右键 Show History | backend.xml:115 | ➖（无编辑器宿主；等价=「更多」+ 页内输入） |
| 29 | BlameView → HistoryPanel | gutter 右键 Show in History | `ShowInFileHistoryAnnotationActionProvider.kt:55` | ✅ 行内「历史」按钮 → `/history?file=` |
| 30 | HistoryPanel → DiffPage | 双击版本/变更 | `ChangesBrowserBase.onDoubleClick:211` | ✅ 双击条目 → `/diff?file&from=父哈希&to=该提交`（根提交 `root=1`） |
| 31 | HistoryPanel → BlameView | Annotate Revision | `AnnotateRevisionFromHistoryAction` | ✅ 行内「Annotate Revision」→ `/blame?rev=` |
| 32 | 编辑器 → BlameView | 右键 Annotate | `AnnotateToggleAction`（VcsActions.xml:20） | ➖（无编辑器宿主；等价=「更多」+ 页内输入） |
| 33 | BlameView → DiffPage | gutter 右键 Show Diff | `ShowDiffFromAnnotation.java:85` | ✅ 行内「差异」→ DiffPage from/to（根提交 `root=1`） |
| 34 | BlameView → 受影响提交对话框 | 点击 Show All Affected | `AbstractVcsHelperImpl.java:551-564` | ❌ |
| 35 | BlameView 关闭 | 右键 Close Annotations | `EditorGutterComponentImpl:2719` | ➖（页面离开即关闭） |
| 36 | 任意处 → SearchPanel | Search Everywhere Git tab | `GitSearchEverywhereContributor` | ✅ 「更多」→ `/search` |
| 37 | 工具窗口 → CommittedChangesPanel | Repository tab | `CommittedChangesViewManager.kt:39` | ✅ 「更多」→ `/committed` |
| 38 | CommittedChangesPanel → DiffPage | 双击变更 | `ChangesBrowserBase` | ✅ 文件点击 → `/diff?file&from=<hash>~1&to=<hash>` |
| 39 | LogPage → 带命令过滤器的 Log tab | Show Git Log for Command（internal） | backend.xml:322 | ❌ |

#### 5.3.3 变更 / 提交域

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 40 | 工具窗口 → StatusPage | Local Changes tab | VcsActions.xml:635 | ✅ 顶栏「变更」按钮 |
| 41 | StatusPage → CommitDialog | 提交按钮 / Ctrl+K | `CheckinActionUtil.kt:94-108` + `CommitModeManager`（默认 modal） | 🟡 等效非模态内嵌提交框 |
| 42 | StatusPage → DiffPage | 双击变更条目 | `ShowDiffAction.java:114` | ✅ `onOpenDiff` → `/diff?file=` |
| 43 | StatusPage → ConflictsPanel | 冲突文件右键 Merge | backend.xml:422-429 | ❌（等价入口：操作条链接 #58、冲突跳转 #56） |
| 44 | StatusPage → PatchPanel | 右键 Create Patch | `CreatePatchFromChangesAction.java:44` | ❌（入口在「更多」菜单） |
| 45 | StatusPage → ShelfPanel | Shelve Changes | `ShelveChangesAction.kt:9` | ❌（入口在「更多」菜单） |
| 46 | StatusPage → IgnoreDialog | 右键 Add to .gitignore / Exclude | backend.xml:380-384 | ✅ 未跟踪行「忽略」→ Modal.confirm → `ignore/add` |
| 47 | StatusPage → HistoryPanel/BlameView | 右键 Annotate / Show History | backend.xml:106-117 | ❌ |
| 48 | StatusPage → 三版本对比 DiffPage | 右键 Compare Three Versions | `GitStageCompareThreeVersionsAction.kt:41-50` | ✅ 行「三版本」按钮 → `/diff?file=&three=1` |
| 49 | StatusPage → StashPanel | Stash Files | backend.xml:420 | ❌ |
| 50 | CommitDialog → PushDialog | Commit and Push… 执行器 | `GitCommitAndPushExecutor.kt:19` | ❌（PushDialog 独立落地，组合执行器未做） |
| 51 | Git 菜单 → PatchPanel（应用） | Apply Patch | backend.xml:182 | ✅ 「更多」→ 页内应用（check 先行） |
| 52 | PatchPanel → ShelfPanel | Import Patches into Shelf | `ImportIntoShelfAction.java:74` | ✅ 行内「导入搁置」→ 成功跳 `/shelves`（activateView 语义） |
| 53 | 工具窗口 → ShelfPanel | Shelf tab | VcsActions.xml:636 | ✅ 「更多」→ `/shelves` |
| 54 | ShelfPanel → StatusPage | Unshelve | `UnshelveChangesAction.kt:37` | ✅ restore 后 status 键回写联动（events 刷新；口径更正：平台 Unshelve 无自动切 tab 证据） |
| 55 | IgnoreDialog → 编辑器 | 写入后打开 .gitignore | `IgnoreFileAction.kt:82` | ➖（页内预览+保存，无编辑器） |
| 56 | merge/rebase/update → ConflictsPanel | 冲突后自动出现 tab | `GitConflictsToolWindowManager.java:26` | ✅ 四操作冲突结果均自动跳 `/conflicts` |
| 57 | Git 菜单 → ConflictsPanel | Resolve Conflicts… | `GitResolveConflictsAction.java:67` | ✅ 操作条「去解决冲突」链接 |
| 58 | 主工具栏 → ConflictsPanel | 进行中操作 widget Resolve | backend.xml:539-553 | ✅ 同 #57 |
| 59 | ConflictsPanel → 3-way 合并视图 | 双击冲突文件 | `GitConflictsPanel.kt:70-82` | ✅ 「手动合并」全屏 Modal（MergeView） |
| 60 | ConflictsPanel → StatusPage | 全部解决完成 | `MergeConflictManager.kt:58-70` | ✅ 「完成合并」`operation/continue` 泛化回日志页 |

#### 5.3.4 分支 / 操作域

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 61 | 状态栏 → BranchPanel | 点击分支 widget | `GitBranchWidget.kt:68-71` | ✅ 顶栏「分支」按钮（Web 无状态栏） |
| 62 | Git 菜单 → BranchPanel | Branches… / Ctrl+Shift+` | `GitBranchesAction.java:26` | ✅ 同 #61；快捷键未做 |
| 63 | 主工具栏 → BranchPanel | 分支下拉按钮 | `GitBranchesComboBoxAction.java:68` | ❌ |
| 64 | QuickActionsMenu → BranchPanel | Branches… 菜单项 | `GitQuickListContentProvider.java:24` | 🟡 等效：顶栏「分支」；独立组件不做 |
| 65 | BranchPanel → New Branch 对话框 | 弹窗顶部 New Branch… | backend.xml:245-249 | ✅ 新建 Modal（起始点 + 创建后检出） |
| 66 | BranchPanel → GitRefDialog | Checkout Branch or Revision… | `GitCheckoutFromInputAction.kt:38` | ✅ 行内三态检出 |
| 67 | BranchPanel → fetch | 弹窗 Fetch 按钮 | `GitBranchPopupFetchAction.kt:21-24` | ❌（远程页承载） |
| 68 | BranchPanel → PushDialog | 分支菜单 Push… | backend.xml:272 | ✅ 「更多」→ 内嵌 PushDialog |
| 69 | BranchPanel → DiffPage | Show Diff with Working Tree | `GitShowDiffWithRefAction.kt:25` | ❌ |
| 70 | BranchPanel → WorktreePanel | 分支菜单 New Working Tree | backend.xml:269 | ❌ 明确不做 |
| 71 | BranchPanel → 直接执行动作集 | Checkout/Merge/Rebase/Pull/Update/Rename/Delete/Push Tags（弹窗内无 Reset） | backend.xml:251-283 | ✅ 等价集齐：行内四动作 + 各域对话框/页面 |
| 72 | 任意处 → QuickActionsMenu | Alt+` | keymaps `$default.xml:1125-1127` | 🟡 等效：顶栏+更多菜单；快捷键不做 |
| 73 | 主工具栏「…」→ QuickActionsMenu | Show More Actions | backend.xml:318-319 | 🟡 等效：「更多」下拉 |
| 74 | QuickActionsMenu → 各面板 | Branches/Push/Stash/Resolve Conflicts/Working Trees/Unshallow | `GitQuickListContentProvider.java:24-37` | 🟡 等效覆盖（Unshallow 经 fetch 端点既有） |
| 75 | Git 菜单 → PushDialog | Push… / Ctrl+Shift+K | backend.xml:154 | ✅ 「更多」→ 内嵌 PushDialog |
| 76 | Git 菜单/主工具栏 → UpdateProjectDialog | Update Project / Ctrl+T | `CommonUpdateProjectAction` | ✅ 「更多」→ 内嵌 UpdateProjectDialog |
| 77 | Git 菜单 → PullDialog | Pull… | backend.xml:156 | ✅ 「更多」→ 内嵌 PullDialog |
| 78 | Git 菜单 → 直接 fetch | Fetch | backend.xml:157 | ✅ 远程页顶部 fetch 全部 + 行内单远程 |
| 79 | Git 菜单 → MergeDialog | Merge… | backend.xml:160 | ✅ 顶栏「合并」→ `/merge` |
| 80 | Git 菜单 → RebaseDialog | Rebase… | backend.xml:162 | ✅ 「更多」→ 内嵌 RebaseDialog |
| 81 | Git 菜单 → ResetDialog（旧版） | Reset HEAD… | backend.xml:176 | ✅ 落地为内嵌新版（#14），菜单入口不做 |
| 82 | Git 菜单 → StashPanel | Stash/Unstash/Show Stashes | backend.xml | ✅ 顶栏「贮藏」→ `/stashes` |
| 83 | StashPanel → Unstash As 对话框 | 右键 Unstash As… | backend.xml:490、502-507 | ✅ 行「Unstash As…」Modal（目标本地分支 Select → 检出+apply 不 drop） |
| 84 | StashPanel → DiffPage | 右键 Show Diff | backend.xml:511-517 | ✅ 行「查看差异」Modal（`git stash show -p` 补丁；等效承载，非 DiffPage 路由） |
| 85 | Git 菜单 → TagPanel | Tag… | backend.xml:175 | ✅ 「更多」→ `/tags` |
| 86 | Git 菜单 → RemotePanel | Manage Remotes… | backend.xml:186 | ✅ 「更多」→ `/remotes` |
| 87 | Git 菜单 → 克隆对话框 | Clone… | backend.xml:187 | ✅ 同 #2（RepoPage 克隆入口承载） |
| 88 | Git 菜单 → WorktreePanel | New Worktree / Show Worktrees | backend.xml:178-179 | ✅ 「更多」→ `/worktrees`（创建 Modal） |
| 89 | Git 菜单 → Shelf/Patch/Log/QuickList | Local Changes/Patch 子菜单等 | backend.xml:144、:182、:181、:189 | ✅ 等价：「更多」菜单承载 |
| 90 | Git 菜单 → GitHub/GitLabPanel | View Pull Requests / Show Merge Requests | `GithubViewPullRequestsAction.kt:24` | ✅ 「更多」双面板项（各自检测远程） |
| 91 | PushDialog → 被拒后 Update 联动 | push 被拒弹 Update required | `GitPushOperation.java:485-512` | ❌（rejected 带 hint 呈现，自动联动未做） |
| 92 | UpdateProjectDialog → SubmodulePanel | 更新流程内 submodule update | `GitUpdateProcess.java:327-335` | ➖ 明确不做（独立面板承载） |
| 93 | UpdateProjectDialog → reset to tracked | 对话框左下 Reset to tracked | `GitUpdateOptionsDialog.kt:24-28` | ❌ |
| 94 | 操作 → continue/abort/skip | 进行中操作继续/中止 | backend.xml:131-140、:228-236 | ✅ abort=操作条；continue=`operation/continue` 泛化；skip 未做 |

#### 5.3.5 远程 / 集成域

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 95 | 远程操作 → 认证对话框 | 401 自动弹出；内嵌托管登录 | `GitHttpGuiAuthenticator.java:399-440` | ✅ AuthDialog 认证重试回路（PAT 录入，OAuth 不做） |
| 96 | Worktrees tab → 打开 worktree | 双击 worktree | backend.xml:577-579 | ❌ 明确不做 |
| 97 | GitHubPanel 列表 → 详情+时间线 | 双击 PR | `GHPROpenPullRequestAction.kt:24-25` | ✅ 单击选中 → 详情 + 页内时间线 tab |
| 98 | GitHubPanel 详情 → PR diff | Changes 树打开 diff | `GHPRFilesManagerImpl.kt:37-46` | ✅ 行级视图（逐 hunk 两侧 MonacoDiffView，`parseUnifiedDiff` 行映射）；行级评论锚点见任务清单 §2.7 #3 |
| 99 | GitHubPanel 详情 → 时间线 | Show Timeline 回跳 | `GHPRDetailsComponentFactory.kt:107` | ✅ 页内 tab |
| 100 | → GitHubPanel 登录（4 入口） | 克隆 GitHub tab / 账户选择器 / Settings | `GithubSettingsConfigurable.kt:44-53` 等 | ✅ Settings 账户卡片既有流 |
| 101 | 任意处 → Share Project on GitHub | Vcs.Import / Share 按钮 | `GithubShareAction` | ❌ 明确不做 |
| 102 | GitLabPanel 列表 → 详情+时间线 | 双击 MR | `GitLabShowMergeRequestAction.kt:24-25` | ✅ 单击选中 → 详情 + 时间线 tab |
| 103 | GitLabPanel → 创建 MR | 面板动作开创建 tab | `GitLabMergeRequestOpenCreateTabAction` | ✅ 新建 MR Modal |
| 104 | 编辑器/项目树 → GitLab Snippet | 右键 Create Snippet | `GitLabCreateSnippetAction` | ❌ 明确不做 |

> 经核查**不存在**的边（4 条）：LogPage 右键直达 HistoryPanel、分支弹窗直达 LogPage、分支弹窗内 Reset、PR diff→时间线直接回跳。另有 2 条口径更正：#39「Show Git Log for Command」非写 Console；#54 Unshelve 无自动切 tab 证据。

### 5.4 汇总

| 口径 | 数量 |
|------|------|
| Java 版导航边（收录 104 条） | 出边最多：LogPage（仓库枢纽）；Git 主菜单承载入边 20+（Web 由顶栏+更多菜单聚合承接） |
| ✅ 已复刻（含等价边） | **66 条**：LogPage 出边 23（顶栏 5 + 更多菜单 18）、各子页回边 21、操作/冲突链路 7、StatusPage 链 4（#48 三版本）、BranchPanel 链 3、远程/集成链 8（#98 行级 diff 视图）、本地工具链 8（#83/#84 贮藏）、源码链路 4（#29/#30/#31/#33）、repo 入库链 2（#2/#87 克隆）、日志右键链 4（#18/#19/#22/#26）、Patch/Shelf 回边 2（#52/#54） |
| 🟡 半通/降级 | **8 条**：#13 LogPage→DiffPage、#20 右键分支操作子菜单（含 Push up to Commit 余项）、#21 右键动作集（reword 族经交互式变基）、#41 提交框等效、#64/#72/#73/#74 QuickActions 等效 |
| ➖ Web 无对应 | **7 条**：#5/#9 全局入口、#28/#32 编辑器宿主、#35 关闭注解、#55 写入后开编辑器、#92 流程内子模块更新 |
| ❌ 未复刻 | **23 条**（含明确不做：New Working Tree、打开 worktree、Share Project、GitLab Snippet） |

### 5.5 关键联动流程

1. **打开 → 工作流**：RepoPage → LogPage → 顶栏/更多菜单 → 各域页面（Web 单仓库模型，无 Java 的多项目会话）。
2. **提交 → 推送**：StatusPage 提交框 →（推送独立于「更多」菜单 PushDialog）；commit&push 组合执行器未做。
3. **合并/变基/摘樱桃/还原 → 冲突 → 解决 → 继续**：四操作冲突统一跳 ConflictsPanel → MergeView 逐文件（ours/theirs/manual/delete）→ 「完成合并」`operation/continue` 泛化 → 回日志页；abort 在操作条。
4. **溯源链路**：BlameView / HistoryPanel / SearchPanel / CommittedChangesPanel 结果 → 日志页 `?select=<hash>` 深链；Committed 文件 → DiffPage from/to。
5. **变更暂存架**：StatusPage → 补丁（PatchPanel 三态创建）/ 搁置（ShelfPanel save/restore）/ 忽略（一键 add）；Patch→Shelf（导入搁置 → 跳 ShelfPanel）、Shelve from Status 未做。

---

## 六、结论与下一步

1. **页面**：31/31 全覆盖（29 ✅ + 2 🟡 等效）；功能域 36/36（browse 已落地，见任务清单 §2.8），可选 2 项明确不做（1.3 决策清单）。
2. **接口**：85 路径 / 99 方法两端对称、全部有消费方（`initRepo`/`cloneRepo` 已挂 `/repos/init`、`/repos/clone`）；半使用 0（diff/stream 与 staging/hunks 两项均已接渲染入口）。
3. **导航**：104 条边中 52 ✅（含等价边）+ 9 🟡 + 7 ➖ + 36 ❌；形态等价判定规则见 1.2，明确不做项均记录在案。

**下一步**（按任务清单 `docs/reports/2026-09-08-replication-gap-backlog.md` 执行）：

1. **P0 半使用接口消化**：✅ 全部完成（hunk 级暂存 UI 见 §2.1 #2 完成记录；diff/stream 分块渲染见 §2.1 #1 完成记录）。
2. **P2 各域功能点补齐**（§2.3，50 项按域）：LogPage 过滤/分页/右键形态、DiffPage hunk 应用与三版本、BranchPanel 清理/保护分支、Push rejected 联动、Settings GPG/SSH 等逐项落地。
3. **专项裁定任务**：PR/MR 行级 diff 视图（§2.7，2026-09-08 裁定）——完成后边 #98 转 ✅。
4. **P3 导航边缺口**（§2.4，32 条 ❌ + 2 条 🟡 直达）：按目标页分组落地（LogPage 右键动作集、StatusPage 六入口、Stash/Patch/Shelf 回边等）。
5. **工程排期项**（§2.5，11 项）：gitlab checkout Bearer hardening、core vitest fileParallelism、unborn HEAD 补丁/搁置等随批消化。
6. **契约与功能域收尾**（§2.6）：`operation.progress` SSE、预留错误码 4 个随功能消费、终稿盘点以架构 spec §4.2 域表逐行核。
7. **可选任务**（§2.9）：分支折叠——待过滤 UI 落地后按触发条件评估。
8. **明确不做**：维持 §1.3 决策清单（清单 §三），新需求出现时可重新决议。

---

## 附录 A：接口与文件索引

| 层 | 位置 |
|----|------|
| 契约 | `packages/server/contracts/src/{endpoints,domain,errors,sse,host}.ts` |
| 服务层 | `packages/server/api/src/*.ts`（38 模块，`index.ts` 108 出口） |
| web-next 路由 | `apps/web-next/app/api/**/route.ts`（89 文件） |
| web-koa 路由 | `apps/web-koa/src/routes/repos.ts`（103 注册）+ `src/middleware/error.ts` |
| 客户端 hooks | `packages/client/client/src/*.ts` |
| UI 组件 | `packages/client/ui/src/composite/*.tsx`（31 页面组件 + base/domain 层） |
| 页面容器 | web-next：`app/page.tsx` + `app/repos/[repoId]/{page.tsx,*/page.tsx}`（22 子路由）；web-koa：`src/pages.tsx` + `src/pages/*.tsx`（22 文件，两端同构） |
| 模拟人工测试 | 浏览器全量冒烟（AGENT.md §测试；无独立 e2e 框架） |

## 附录 B：Java 侧抽查证据

1. `plugins/git4idea/backend/src` 源文件计数实测：533 个 .kt + 248 个 .java = 781 个，与 spec 附录 A-2 一致。
2. `BaseIdeaProperties.kt:13-20` 实测 `REBASED_BUNDLED_PLUGINS = DEFAULT_BUNDLED_PLUGINS + [intellij.vcs.git, intellij.vcs.git.commit.modal, intellij.vcs.github, intellij.vcs.gitlab, intellij.terminal, intellij.textmate.plugin]`，与 spec §2.1 一致。
3. 30 个操作页面与 36 个功能域的完整枚举引用自架构 spec §4.2/§4.5（证据链含 git4idea 全量文件核对、平台 VCS 包核对、GitHub/GitLab 插件包核对）。
4. **导航证据**：`plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml`（1063 行）为 git 插件 action 注册总表——Git 主菜单组 `Git.MainMenu`（:151-196）、分支弹窗组 `Git.Branches.List`/`Git.Branch.Backend`（:245-283）、日志右键注入 `Git.Log.ContextMenu`（:344-367）、暂存区/贮藏组（:391-529）、主工具栏与 worktree 组（:531-598）。
5. **Rebased 独家导航改动**（backend.xml 注释原文）：:305-309「in rebased the git context menu has been moved up into the main menu」；:519-529「in rebased, pull & push are moved to the toolbar」；主工具栏 VCS 组 `MainToolbarVCSGroup` 定义于 `PlatformActions.xml:1084`。
6. **平台侧注册表**：`vcs-log.xml:271-281`（`Vcs.Log.ContextMenu` 基座组）、`VcsActions.xml:633-637`（`Vcs.Show.Toolwindow.Tab` 组）。
