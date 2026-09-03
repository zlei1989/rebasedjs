# Rebased 操作页面与 Rebased.js 接口盘点报告

- **日期**：2026-09-03
- **参照系**：`D:\zhanglei1120\Github\rebased`（Java/Kotlin 版 Rebased，基于 IntelliJ 平台的 Git 客户端）
- **审计对象**：`D:\zhanglei1120\Github\rebasedjs`（TS + React 全栈重写，pnpm monorepo）
- **依据**：`docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md`（下称"架构 spec"，其结论已对 Java 源码逐一核查）+ 本次对两个项目源码的直接盘点（附录 B 含抽查证据）

---

## 一、问题 1：操作页面数量与实现对照

### 1.1 Java 版 Rebased 有多少个操作页面？

"操作页面"按两个维度计量（均来自架构 spec §4.2/§4.5 的验证清单，证据链见 spec 附录 A）：

**维度 A —— 功能域：36 个 + 2 个可选后置**

| 阶段 | 数量 | 功能域 |
|------|------|--------|
| P1 | 5 | repo（打开/初始化/克隆/最近仓库）、status（工作区状态）、log（提交图/过滤/分页）、diff（工作区/暂存/提交间）、settings（应用设置） |
| P2 | 12 | operation（进行中操作）、reset、staging（暂存区）、changelist（变更列表）、commit（提交/amend/modal UX）、branch（分支）、checkout（检出）、merge（合并）、stash（贮藏）、conflict（冲突）、config（git 配置）、auth（凭据） |
| P3 | 15 | rebase（含交互式）、cherry-pick、revert、tag、remote（fetch/pull/push）、update（Update Project）、blame（溯源）、history（文件历史）、committed（Committed Changes 浏览器）、search（提交搜索）、patch（补丁）、shelf（搁置）、console（Git 输出控制台）、ignore（.gitignore）、github（PR/Gist/认证） |
| P4 | 4 | gitlab（MR/Snippet）、worktree（工作树）、submodule（子模块）、browse（历史快照浏览） |
| 可选后置 | 2 | terminal（内置终端，xterm.js）、local-history（本地历史，平台能力） |

**维度 B —— UI 页面/对话框/面板：30 个**（架构 spec §4.5 组合组件清单，即 Java 版用户可见操作面的完整枚举）：

RepoPage、LogPage、DiffPage、StatusPage（Local Changes + 暂存区）、CommitDialog（模态提交）、ResetDialog（Reset/Undo Commit）、BranchPanel、MergeDialog、RebaseDialog（交互式）、StashPanel、TagPanel、RemotePanel、PushDialog、PullDialog、UpdateProjectDialog、BlameView、HistoryPanel、CommittedChangesPanel、SearchPanel、ConflictsPanel、PatchPanel、ShelfPanel、WorktreePanel、SubmodulePanel、IgnoreDialog、GitHubPanel（PR 列表/详情/时间线/审查）、GitLabPanel、GitConsole、QuickActionsMenu（快捷操作聚合）、SettingsPage。**30 个页面的名称/用途/功能点/复刻状态逐一详析见附录 C；30 个页面之间的跳转关系（导航图谱）见附录 D。**

> 注：维度 A 偏后端功能、维度 B 偏用户界面，二者不是一一对应（如 commit 功能对应 CommitDialog + modal UX；remote 功能对应 Push/Pull/UpdateProject 三个对话框）。回答"操作页面有多少个"时，**面向用户的口径是 30 个页面/面板/对话框**；**面向功能覆盖的口径是 36 个功能域**。

### 1.2 当前项目（rebasedjs）实现了多少个？

**结论：已实现 3 个操作页面，对应 5 个功能域（P1 阶段全量）+ 1 个 SSE 推送基础设施。**

已实现的 3 个页面（`packages/client/ui/src/composite/`，web-next 与 web-koa 各挂 3 条路由、共享同一套组件）：

| 页面 | 路由（两端一致） | 内容 | 对应 Java 面 |
|------|------------------|------|--------------|
| RepoPage | `/` | 最近仓库列表 + 打开仓库表单（显示名三级回退、路径 `~/` 相对化、Popconfirm 删除确认） | 取代 Java 欢迎屏 `FlatWelcomeFrame` + RecentProjects |
| LogPage | `/repos/:repoId` | 顶栏（仓库名 + RepoStatusBar 状态徽标）+ CommitGraph（虚拟滚动真图渲染，graph-layout 算法移植自 `platform/vcs-log/graph`）+ 右侧 CommitDetailsPanel | VCS Log UI |
| DiffPage | `/repos/:repoId/diff?file=…` | Monaco DiffEditor（默认并排、忽略空白开关默认关、staged/工作区切换） | diff/merge 查看器（单文件部分） |

对照汇总：

| 口径 | Java 版总量 | 已实现 | 完成度 |
|------|------------|--------|--------|
| 操作页面/面板（维度 B） | 30 | 3（RepoPage、LogPage、DiffPage） | 10% |
| 功能域（维度 A） | 36 + 2 可选 | 5（repo、status、log、diff、settings）+ events（SSE 状态推送，P1 端点清单的一部分） | ≈14%（P1 阶段 5/5 完成） |

未实现的 27 个页面/面板：StatusPage、CommitDialog、ResetDialog、BranchPanel、MergeDialog、RebaseDialog、StashPanel、TagPanel、RemotePanel、PushDialog、PullDialog、UpdateProjectDialog、BlameView、HistoryPanel、CommittedChangesPanel、SearchPanel、ConflictsPanel、PatchPanel、ShelfPanel、WorktreePanel、SubmodulePanel、IgnoreDialog、GitHubPanel、GitLabPanel、GitConsole、QuickActionsMenu、SettingsPage——全部属于 P2–P4 阶段，与架构 spec §7 的落地顺序一致（当前处于第 5–6 步完成态）。各页面的功能点级复刻状态、已有基础与本次详析的实测更正见附录 C。

---

## 二、问题 2：当前项目全部接口的用途与使用情况

### 2.1 接口总表（9 个端点路径、10 个 HTTP 方法，web-next 与 web-koa 完全对称）

实现位置：web-next `app/api/**/route.ts`（9 个 route 文件）；web-koa `src/routes/repos.ts`（10 个路由注册）。每个路由只做三件事：zod 校验 → 调 `@rebased/api` → 错误映射。

| # | 端点 | 类型 | 用途 | 服务层函数 | 客户端消费 | 使用状态 |
|---|------|------|------|-----------|-----------|---------|
| 1 | `GET /api/repos` | REST | 最近仓库列表（RepoInfo[]，含 id/name/path） | `listRecentRepos` | `useRecentRepos` → 首页列表、日志页取仓库显示名 | ✅ 完全使用 |
| 2 | `POST /api/repos/open` | REST | 打开仓库：zod 校验 `{path}` → 验证是 git 仓库并注册到最近列表（同路径复用 id）→ 返回 `{repoId}` | `openRepo` | `useOpenRepo` → 首页打开表单（成功跳日志页，失败 message.error） | ✅ 完全使用 |
| 3 | `GET /api/repos/:repoId/status` | REST | 工作区状态：分支/上游/incoming/outgoing/变更条目 | `getRepoStatus` | `useRepoStatus` → 日志页 RepoStatusBar | ✅ 完全使用 |
| 4 | `GET /api/repos/:repoId/log?limit&skip&author&path` | REST | 提交历史分页快照（limit ≤500，skip 游标，author/path 过滤） | `getLogPage` | `useLogPage` → 日志页首屏快照（与 SSE 流 merge 去重） | ✅ 完全使用 |
| 5 | `GET /api/repos/:repoId/log/stream` | SSE | 提交图增量流（`log.line` 事件逐条推送，渐进式渲染；断开即杀 git 进程） | `streamLogEvents` | `useLogStream` → 日志页增量追加 + stream.error 呈现 | ✅ 完全使用 |
| 6 | `GET /api/repos/:repoId/diff?file&from&to&staged` | REST | 单文件两侧全文（FileVersions：staged→HEAD vs 暂存区；默认→HEAD vs 工作区；from/to→任意两版本），供 Monaco 两侧渲染 | `getFileVersions` | `useFileDiff` → 差异页 DiffViewer | ✅ 完全使用 |
| 7 | `GET /api/repos/:repoId/diff/stream` | SSE | 大 diff 分块流（`diff.chunk` 事件累积；断开即杀 git 进程） | `streamDiffEvents` | `useDiffStream` → 差异页 | ⚠️ **半使用**：页面已订阅（保活/预热），但分块文本未接入 UI 渲染（代码注释明示"留待后续任务"） |
| 8 | `GET /api/repos/:repoId/events` | SSE | 仓库状态推送：轮询 status，变化时发 `repo.state-changed`（首帧为当前状态） | `watchRepoStatus` | `useRepoEvents` → 日志页：回写 status 缓存 + 重验证日志 + 重订阅流 | ✅ 完全使用 |
| 9 | `GET /api/settings` | REST | 读应用设置（logInEditor、recentRepoIds） | `getSettings` | `useSettings` → 差异页预取 | ⚠️ **半使用**：已拉取但偏好值尚未接入任何 UI 行为（注释"供后续页面接线"） |
| 10 | `PUT /api/settings` | REST | 更新设置（zod 校验补丁，返回更新后完整设置） | `updateSettings` | `useSettings().update`（SWR mutation，响应回写缓存） | ⚠️ **半使用**：hook 已完整接线并有测试，但当前 3 个页面均未触发 update |

**小结：9/9 端点路径都有客户端消费方，没有"死接口"；其中 3 个处于"已接通、数据未消费"的预接线状态（#7 diff/stream、#9 GET settings、#10 PUT settings），均为当前页面范围内的已知预留，非遗漏。**

### 2.2 服务层导出但未挂端点的函数（`@rebased/api` 公共出口 15 个函数）

| 函数 | 状态 | 说明 |
|------|------|------|
| `getFileDiff` | 未挂端点 | 返回 unified diff 文本（DiffFile）；两端路由改用 `getFileVersions`（Monaco 需要两侧全文），仅测试引用 |
| `initRepo` / `cloneRepo` | 未挂端点 | 仓库初始化/克隆能力已在服务层实现并有集成测试，但尚无 `POST /api/repos/init`、`POST /api/repos/clone` 路由与 UI 入口 |
| 其余 12 个 | 已挂端点或被框架层使用 | 10 个支撑上表端点；`getRepoById`（两端 server-context 的 `resolveRepo`）与 `toServiceError`（两端 server-context + Koa 错误中间件）属路由装配/错误映射基础设施 |

### 2.3 契约层（`@rebased/contracts`）使用情况

- **zod schema（4 个）**：`openRepoBodySchema`、`logQuerySchema`、`diffQuerySchema`、`settingsPatchSchema` —— 全部被两端路由使用，无闲置。
- **错误码（12 个）**：`REPO_NOT_FOUND`、`NOT_A_GIT_REPO`、`INVALID_QUERY`、`GIT_ERROR` 当前阶段实际会产生；`INVALID_REF`、`CONFLICT`、`AUTH_FAILED`、`RATE_LIMITED`、`HOOK_FAILED`、`STALE_LOCK`、`OPERATION_IN_PROGRESS`、`CANCELLED` 为 P2+ 功能的预留（属契约前瞻性设计，映射表 `httpStatusFor` 两端共用）。
- **SSE 事件类型（4 种在用）**：`log.line`、`diff.chunk`、`repo.state-changed`、`stream.error`（流内错误帧，三端点统一约定）——生产端与消费端均已接通。架构 spec §5 首批还列了 `operation.progress`、`operation.state-changed`，属 P2（operation.ts），当前未实现。
- **领域类型（10 个）**：`RepoInfo`、`ChangeEntry`、`RepoStatus`、`CommitInfo`、`LogPage`、`DiffFile`、`FileVersions`、`SettingsState`、`LogEvent`、`DiffEvent` —— 全部贯穿 api → 路由 → client hooks → ui props 链路。

---

## 三、结论

1. **页面口径**：Java 版 Rebased 面向用户的操作页面/面板/对话框共 **30 个**（功能域口径 36 个 + 2 个可选）；当前 rebasedjs 实现了其中 **3 个**（RepoPage / LogPage / DiffPage），即 **P1 阶段的全部目标页面**，在两个下游应用（web-next:3030、web-koa:3031/5173）中对称可用。
2. **接口口径**：当前项目共 **9 个端点路径（10 个 HTTP 方法）**，两端实现完全对称，**全部被客户端使用、无死接口**；其中 3 个为"已接通待消费"的预接线状态（diff/stream 分块渲染、settings 读写接入 UI）。服务层有 3 个已实现但未暴露端点的能力（`getFileDiff`、`initRepo`、`cloneRepo`）。
3. **下一步建议**（按 spec §7 顺序）：① 补齐 diff/stream 分块渲染与 settings 偏好接线（把 3 个半使用接口变为完全使用）；② 为 init/clone 补端点与 RepoPage 入口；③ 进入 P2：operation / reset / staging / changelist / commit / branch 等 12 个功能域及其页面对应物。

---

## 附录 A：接口与文件索引

| 层 | 位置 |
|----|------|
| 契约 | `packages/server/contracts/src/{endpoints,domain,errors,sse}.ts` |
| 服务层 | `packages/server/api/src/{repo,status,log,diff,settings,events,errors}.ts` |
| web-next 路由 | `apps/web-next/app/api/repos/route.ts`、`repos/open/route.ts`、`repos/[repoId]/{status,log,log/stream,diff,diff/stream,events}/route.ts`、`settings/route.ts` |
| web-koa 路由 | `apps/web-koa/src/routes/repos.ts`（10 注册）+ `src/middleware/error.ts` |
| 客户端 hooks | `packages/client/client/src/{repos,log,diff,settings,events,http}.ts` |
| 页面容器 | web-next：`app/page.tsx`、`app/repos/[repoId]/page.tsx`、`app/repos/[repoId]/diff/page.tsx`；web-koa：`src/pages.tsx`、`src/pages/{repo,diff}.tsx` |

## 附录 B：Java 侧抽查证据（本次复核）

1. `plugins/git4idea/backend/src` 源文件计数实测：**533 个 .kt + 248 个 .java = 781 个**，与 spec 附录 A-2 一致。
2. `platform/build-scripts/.../BaseIdeaProperties.kt:13-20` 实测 `REBASED_BUNDLED_PLUGINS = DEFAULT_BUNDLED_PLUGINS + [intellij.vcs.git, intellij.vcs.git.commit.modal, intellij.vcs.github, intellij.vcs.gitlab, intellij.terminal, intellij.textmate.plugin]`，与 spec §2.1 一致。
3. 30 个操作页面与 36 个功能域的完整枚举引用自架构 spec §4.2/§4.5（其证据链含 git4idea 全量文件核对、平台 VCS 包核对、GitHub/GitLab 插件包核对，见 spec 附录 A-2/3/5）。
4. **导航证据（附录 D 一手来源）**：`plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml`（1063 行）为 git 插件 action 注册总表——Git 主菜单组 `Git.MainMenu`（:151-196）、分支弹窗动作组 `Git.Branches.List`/`Git.Branch.Backend`（:245-283）、日志右键注入 `Git.Log.ContextMenu`（:344-367）、暂存区/贮藏组（:391-529）、主工具栏与 worktree 组（:531-598）。
5. **Rebased 独家导航改动实测**（backend.xml 注释原文）：:305-309「in rebased the git context menu has been moved up into the main menu」（编辑器右键 Git 子菜单删去通用仓库动作）；:519-529「in rebased, pull & push are moved to the toolbar」（分支弹窗顶层移除 Pull/Push）；主工具栏 VCS 组 `MainToolbarVCSGroup` 定义于 `platform/platform-impl/resources/META-INF/PlatformActions.xml:1084`（Update Project / Push 按钮）。
6. **平台侧注册表**：`platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml:271-281`（`Vcs.Log.ContextMenu` 基座组）、`platform/vcs-impl/resources/META-INF/VcsActions.xml:633-637`（`Vcs.Show.Toolwindow.Tab` 组：Local Changes / Shelf 等 tab 切换动作）。

---

## 附录 C：30 个操作页面逐一详析（名称 / 用途 / 功能点 / 复刻状态）

- **口径**：页面清单为架构 spec §4.5 组合组件枚举（本文 §1.1 维度 B），顺序与之一致；功能点以 Java 版 Rebased 源码核查结论（架构 spec §4.2/§4.5.2、组装 spec §6 与附录 A）为参照系；复刻状态以本仓当前 HEAD（`cbb7dfa`）逐文件实测为准。
- **状态图例**：✅ 已复刻（端到端可用）｜🟡 部分复刻（服务层/组件/契约就绪但链路未通，或仅默认行为对齐）｜❌ 未复刻｜➖ Java 概念在 Web 形态无对应（经 spec 判定不做）。
- **实测更正**（相对 §1.2 汇总表述的 3 处精度修正，证据见 C.1）：① RepoPage 显示名实为"目录名"单级回退（`api/repo.ts:19` 仅 `basename`），非三级；② 最近列表有效上限为服务端 20（`slice(0, 20)`），组件的 50 截断不会触发；③ 路径 `~/` 相对化与 Popconfirm 移除均为组件就绪但两端容器未接线，运行时不生效。
- **口径说明**：页面级结论与 §1.2 一致（3/30 已复刻）；🟡 均出现在"页面未做但周边基础已就位"的情形（StatusPage、SettingsPage），不计入已复刻页面数。

### C.0 总览表

| # | 页面 | 用途（一句话） | 对应功能域（api 文件） | 阶段 | 复刻状态 |
|---|------|----------------|------------------------|------|----------|
| 1 | RepoPage | 打开仓库 + 最近仓库管理（取代 Java 欢迎屏） | `repo` | P1 | ✅（3 项 🟡 遗留） |
| 2 | LogPage | 提交图浏览 + 状态条 + 提交详情 | `log` + `status` | P1 | ✅（过滤/分页 UI 等缺口） |
| 3 | DiffPage | 单文件差异查看（工作区/暂存/两版本） | `diff` | P1 | ✅（分块渲染等缺口） |
| 4 | StatusPage | Local Changes + 暂存区主页 | `status`/`staging`/`changelist` | P2 | ❌（status 域已落地于 LogPage 顶栏；P2-B 计划就绪） |
| 5 | CommitDialog | 模态提交对话框 | `commit` | P2 | ❌（P2-B 计划就绪） |
| 6 | ResetDialog | Reset / Undo Commit | `reset` | P2 | ❌ |
| 7 | BranchPanel | 分支树/仪表盘 + 检出 | `branch`/`checkout` | P2 | ❌ |
| 8 | MergeDialog | 合并对话框 | `merge` | P2 | ❌ |
| 9 | RebaseDialog | rebase（含交互式编辑器） | `rebase` | P3 | ❌ |
| 10 | StashPanel | 贮藏管理 | `stash` | P2 | ❌ |
| 11 | TagPanel | 标签管理 | `tag` | P3 | ❌ |
| 12 | RemotePanel | 远程仓库管理 + 凭据 | `remote`/`auth` | P3 | ❌ |
| 13 | PushDialog | 推送对话框 | `remote` | P3 | ❌ |
| 14 | PullDialog | 拉取对话框 | `remote` | P3 | ❌ |
| 15 | UpdateProjectDialog | Update Project（策略化更新） | `update` | P3 | ❌ |
| 16 | BlameView | 文件溯源注解 | `blame` | P3 | ❌ |
| 17 | HistoryPanel | 文件历史（含重命名跟随） | `history` | P3 | ❌ |
| 18 | CommittedChangesPanel | 已提交变更浏览器 | `committed` | P3 | ❌ |
| 19 | SearchPanel | 提交搜索 | `search` | P3 | ❌ |
| 20 | ConflictsPanel | 冲突解决（3-way） | `conflict` | P2 | ❌ |
| 21 | PatchPanel | 补丁创建/应用/管理 | `patch` | P3 | ❌ |
| 22 | ShelfPanel | 搁置管理 | `shelf` | P3 | ❌ |
| 23 | WorktreePanel | 工作树管理 | `worktree` | P4 | ❌（core 有 worktree 发现原语） |
| 24 | SubmodulePanel | 子模块管理 | `submodule` | P4 | ❌ |
| 25 | IgnoreDialog | .gitignore / exclude 编辑 | `ignore` | P3 | ❌ |
| 26 | GitHubPanel | GitHub 认证/PR/Gist | `github` | P3 | ❌（错误码已预留） |
| 27 | GitLabPanel | GitLab 认证/MR/Snippet | `gitlab` | P4 | ❌ |
| 28 | GitConsole | Git 命令输出控制台 | `console` | P3 | ❌ |
| 29 | QuickActionsMenu | 快捷操作聚合菜单 | 聚合各域 | P2+ | ❌（随各域落地聚合） |
| 30 | SettingsPage | 应用设置 + git 配置 | `settings`/`config` | P1/P2 | ❌（数据层已通；P2-A 计划就绪） |

> 可选后置 2 项（terminal、local-history）不在 30 页面口径内，均无复刻。base 组件 `OperationStatus`（进行中操作条）不在页面口径内，其契约（`OperationState` / `operation.state-changed`）已随 P2-A 预备（`b3d438e`）。

### C.1 RepoPage ✅（P1，已复刻）

- **用途**：应用入口页——打开本地 Git 仓库 + 最近仓库列表管理；取代 Java 欢迎屏 `FlatWelcomeFrame` + RecentProjects（组装 spec §1.3 明确不做欢迎屏整体）。
- **复刻落点**：组件 `packages/client/ui/src/composite/repo-page.tsx`（+ `repo-page-utils.ts`）；容器 `apps/web-next/app/page.tsx`、`apps/web-koa/src/pages.tsx`（`open-repo-flow.ts` 两端同构）；服务层 `api/repo.ts`；端点 `GET /api/repos`、`POST /api/repos/open`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 打开路径表单（校验非空 → 验证 git 仓库 → 注册 → 成功跳日志页 / 失败 message.error） | ✅ | `openRepo`；`NOT_A_GIT_REPO` 错误映射两端一致 |
| 最近列表：打开即注册、同路径复用 id 去重、最近优先 | ✅ | `api/repo.ts:15-23` + 组件 `openedAt` 降序、同路径去重（repo-page.tsx:33-44） |
| 显示名三级回退（`.idea/.name` → 目录名 → 路径） | 🟡 | 实测仅目录名一级（`api/repo.ts:19` `basename(root)`）；`.idea/.name` 一级依架构 spec §2.2 判定无对应概念（Rebased 独家禁用 `.idea`，TS 版映射为集中存储策略）；组件注释所称"三级回退在服务端注册时解析"与实现不符 |
| 路径副文本 user-home 相对化（`~/…`） | 🟡 | `relativeToHome` 有单测（目录边界匹配），但两端容器均未注入 `homeDir`（`web-next/app/page.tsx`、`web-koa/src/pages.tsx` 仅传 `repos/onOpen`）→ 运行时原样显示绝对路径 |
| 列表上限 50（对齐 `RecentProjectsManagerBase`） | 🟡 | 组件 `MAX_RECENT=50`，但服务端 `listRecentRepos` 与 `recentRepoIds` 均 `slice(0, 20)` → 有效上限 20 |
| 移除动作 + 确认 | 🟡 | Popconfirm 组件就绪（对齐 `RemoveSelectedProjectsAction`）；无删除端点、两端容器不注入 `onRemove` → 按钮不渲染（组件注释自述"避免死控件"；属计划级不一致，端点清单本不含 remove） |
| 克隆对话框（URL + Directory） | ❌ | `api.cloneRepo` + `core.cloneGitRepo` 已实现且有集成测试；无端点无 UI（P2 补，组装 spec §1.3：最小字段 URL+Directory，对齐 `VcsCloneDialog.kt:33-131`） |
| 初始化仓库入口 | ❌ | 同上（`api.initRepo` / `core.initGitRepo` 就绪） |
| 列表项分支后缀 / 图标 / 失效标记 | ❌ | 装饰性后置（组装 spec 附录 B-5） |

- **总评**：✅ 核心链路（最近列表 + 打开 + 跳转）端到端可用；🟡 集中在"组件/服务就绪、容器接线或精度未齐"；克隆/init 为已定计划的已知缺口。

### C.2 LogPage ✅（P1，已复刻）

- **用途**：仓库主页——提交图浏览（真图渲染 + 渐进加载）+ 顶栏状态条 + 提交详情面板；对应 Java VCS Log UI（`VcsLogGraphTable` / `CommitDetailsPanel` / `GitBranchWidget`）。
- **复刻落点**：组件 `composite/log-page.tsx` + `domain/{commit-graph,repo-status-bar,commit-details-panel}.tsx` + `graph-layout/`；容器 `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（`log-merge.ts`）；端点 `log`、`log/stream`（SSE）、`status`、`events`（SSE）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 提交图真图渲染（lane 分配 / 边路由 / 可见行映射） | ✅ | `graph-layout/` 移植 `GraphLayoutBuilder`、`EdgePrintElementImpl`/`PrintElementGeneratorImpl`、`VisibleGraphImpl`+`RowsMapping` 最小集；Java 7 组 testData 转 vitest 夹具行为等价（`graph-layout/fixtures/java`），Apache-2.0 声明保留 |
| 分支着色（ref 名 hash → HSB 色板） | ✅ | `color.ts` 复刻 `javaStringHashCode` 与 `GraphColorGetterByHead` 算法；测试断言 Java 实测色值（`colorForRef('HEAD -> main') === '#6398a6'`） |
| 虚拟滚动（固定行高窗口渲染，支撑大仓库） | ✅ | `base/virtual-list.tsx`（行高 24、lane 宽 18） |
| 首屏快照 + SSE 增量渐进渲染 + hash 去重合成 | ✅ | `useLogPage` + `useLogStream` + `mergeLogCommits`；流为同一查询的渐进渲染（Ruling 6） |
| 取消链路（断开即杀 git 进程） | ✅ | 路由监听断开 → AbortSignal → 杀进程树；130/预检/break 三断言有测试 |
| 行默认列 Subject + Author + Date（Hash 列省） | ✅ | 对齐 `VcsLogColumnManager.kt:31` |
| refs chips：分支默认开 / tag 默认关 | ✅ | `showTags` prop 默认 false，对齐 `VcsLogApplicationSettings.kt:113` |
| 行点击 → 提交详情面板 | ✅ | `onSelectCommit`；流/快照合成列表中定位选中提交 |
| 详情面板字段集：短 hash+复制、作者行（"{author} on {date} at {time}"）、加粗 subject、分支/标签 chips（两组）、父提交链接 | ✅ | 对齐 `CommitDetailsPanel.kt:71-199`；文件变更列表与签名状态 Java 面板内亦无，不做 |
| 详情面板操作按钮 | ➖ | Java 面板内本来没有（动作在右键菜单）；首跑不提供 = 与 Java 面板一致（组装 spec §6 前提修正） |
| 顶栏状态条：分支名（detached 提示）、incoming 蓝 / outgoing 绿圆点徽标 + tooltip 计数、为 0 不显示 | ✅ | 对齐 `GitInOutState.kt:70-109` 2025 版形态（无旧版 ↑↓ 数字文本） |
| 状态变更自动刷新（事件驱动） | ✅ | `GET /events` SSE `repo.state-changed` → 回写 status 缓存 + 重验证日志 + 重订阅流 |
| 分页（limit ≤500 / skip 游标） | 🟡 | 服务端与 `useLogPage(query)` 支持；UI 无"加载更多"入口，容器仅取默认首屏（schema 默认 limit=50） |
| 过滤（author / path 查询参数） | 🟡 | 服务端 `logQuerySchema` 与 core 支持；UI 无过滤入口——Java 高频入口"文本即滤 + 分支过滤弹窗"（`VcsLogClassicFilterUi.kt:148-152`）列 P2 次优先 |
| 分支折叠 / PermanentGraph 高级视图 | ❌ | 组装 spec §1.3/§3.1 明确不做 |
| 新标签页打开 log、在控制台显示 log | ❌ | P3（`GitExternalLogTabsProperties`、`ShowGitLogCommandAction` → `console.ts`） |
| 行右键菜单动作（Reset to Here / cherry-pick / revert 等） | ❌ | P2/P3（`reset.ts` / `cherry-pick.ts` / `revert.ts`） |
| log 位置偏好（showInEditor） | ✅（文档化） | `logInEditor=true` 对齐 Rebased 独家默认；Web 无 editor/toolwindow 二分，免重启为改进 |

- **总评**：✅ P1 目标面完整，图布局算法为唯一代码级移植资产且经行为等价验证；主要缺口为过滤/分页 UI（P2 次优先，组装 spec 附录 B-1）。

### C.3 DiffPage ✅（P1，已复刻）

- **用途**：单文件差异查看——工作区/暂存/任意两版本对比；对应 Java diff/merge 查看器的单文件部分（`DiffRequestProcessor`、`GitStageDiffUtil`）。
- **复刻落点**：组件 `composite/diff-page.tsx` + `domain/diff-viewer.tsx` + `base/{monaco-diff-view,monaco-lazy}.tsx`；容器 `apps/web-next/app/repos/[repoId]/diff/page.tsx`、`apps/web-koa/src/pages/diff.tsx`；端点 `diff`、`diff/stream`（SSE）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| Monaco DiffEditor（懒加载、行号、语法高亮、只读） | ✅ | 语法高亮职责由 Monaco 替代 TextMate 插件（架构 spec §2.1） |
| 并排（默认）/ 行内切换 | ✅ | 对齐 `DiffManagerImpl.kt:95-101` 默认并排；options 变化经 key 强制重挂载生效 |
| 忽略空白开关（默认不忽略） | ✅ | 对齐 `TextDiffSettingsHolder.kt:47` DEFAULT |
| staged / 工作区切换（三态映射：staged→HEAD vs 暂存区；默认→HEAD vs 工作区） | ✅ | `api.getFileVersions` + `core.readFileAtRev`（`git show <rev>:<file>`） |
| 任意两版本对比（from/to 成对校验） | 🟡 | 端点与契约支持（Ruling 21）；`useFileDiff` 未暴露 from/to、两端容器仅 `?file=` 入口 → UI 不可达 |
| 大 diff 分块流渲染 | 🟡 | `useDiffStream` 已订阅（保活/预热），分块文本未接入 Monaco 渲染（容器注释明示留待后续任务） |
| word diff（BY_WORD）/ 同步滚动 / 折叠 / 上下文行数 | 🟡 | 默认值文档化对齐 Java（组装 spec §6.6）；无 UI 开关（装饰后置，附录 B-5） |
| unified diff 文本视图 | 🟡 | `api.getFileDiff` 已实现并有测试；未挂端点、UI 走两侧全文路径不用它（本文 §2.2） |
| hunk 级应用 / 回退 | ❌ | P2 `staging.ts`（`GitStageDiffAction`） |
| 三版本对比（本地 / 暂存 / HEAD） | ❌ | P2 `staging.ts`（`GitStageCompareThreeVersionsAction`） |
| 与分支比较 | ❌ | P3（`GitCompareWithBranchAction`、`GitShowDiffWithBranchPanel`） |

- **总评**：✅ P1 目标面完整；from/to 入口与分块渲染为已知预留（本文 §2.1 #7、§三建议①）。

### C.4 StatusPage ❌（P2；status 域已部分落地）

- **用途**：Local Changes + 暂存区主页——工作区变更分组、暂存/取消暂存、三版本对比；对应平台 Local Changes（`ChangeListManager`）+ `GitStage*` 暂存区 UI（§4.5.2 三版本模型对照）。
- **计划落点**：`api/{staging,changelist}.ts` + `composite/StatusPage`；实施计划 `docs/superpowers/plans/2026-09-03-rebasedjs-p2b-staging-commit.md` 已就绪。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 变更条目数据源（分支/上游/incoming/outgoing/变更清单） | 🟡 | `getRepoStatus` + `ChangeEntry` 契约已实现并被 LogPage 顶栏消费；分组列表 UI 未做 |
| 变更分组列表（已修改/未跟踪/忽略） | ❌ | 未跟踪/忽略状态在服务层域内（`GitUntrackedFilesHolder`/`GitIgnoredFilesHolder` 对照），UI 未做 |
| 暂存 / 取消暂存 / 放弃修改（文件与 hunk 级） | ❌ | `staging.ts`（`GitStageAllAction`、`StagingAreaOperation`） |
| 三版本对比（本地/暂存/HEAD） | ❌ | `GitStageCompareThreeVersionsAction`；DiffPage 当前仅两版本 |
| changelist：创建/切换/移动变更/默认列表 | ❌ | `changelist.ts`（平台 `ChangeListManager`） |

### C.5 CommitDialog ❌（P2）

- **用途**：模态提交对话框——Java 插件 `intellij.vcs.git.commit.modal` 的新版提交 UX；§4.5.2 对照结构：changelist 选择、amend/sign-off/GPG 选项、提交范围。
- **计划落点**：`api/commit.ts` + `composite/CommitDialog`（Editor 基础组件共用 Monaco 做提交信息编辑）；P2-B 计划已就绪。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 提交（modal UX、提交范围选择） | ❌ | `GitCheckinEnvironment` + commit.modal 插件 |
| amend / amend 历史提交 / reword | ❌ | `GitAmendSpecificCommitSquasher` 等 |
| sign-off / GPG 签名 / commit template | ❌ | `commit\signing`（`GpgAgentConfigurationAction`）；契约白名单已备 `commit.gpgsign`、`user.signingkey` 两键 |
| 跳过 hooks / CRLF 提示 | ❌ | `GitSkipHooksCommitHandlerFactory`、`GitCrlfDialog`；错误码 `HOOK_FAILED` 已预留 |
| commit & push / push up to commit / add commit to remote branch | ❌ | `GitPushUpToCommitAction` 等；依赖 P3 `remote.ts` |

### C.6 ResetDialog ❌（P2）

- **用途**：Reset 与 Undo Commit；对应 `GitResetAction` / `GitNewResetDialog` / `GitUncommitAction`。
- **计划落点**：`api/reset.ts` + `composite/ResetDialog`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| Reset mixed / soft / hard | ❌ | 三模式对话框 |
| 日志右键 "Reset Current Branch to Here" | ❌ | 依赖 LogPage 右键菜单（C.2 缺口联动） |
| Undo Commit（撤销最近提交） | ❌ | `GitUncommitAction` |

### C.7 BranchPanel ❌（P2）

- **用途**：分支树/仪表盘 + 检出操作；§4.5.2 对照 `BranchesTreeModel`：分组维度（本地/远程/最近检出/标签）、过滤逻辑、合并状态图标。
- **计划落点**：`api/{branch,checkout}.ts` + `composite/BranchPanel`（`BranchTree` 领域组件）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 分支树分组（本地/远程/最近检出/标签）+ 过滤 | ❌ | `GitRecentCheckoutBranches` 等 |
| 创建/删除/重命名/上游设置 | ❌ | `GitNewBranchDialog` 等 |
| 合并状态图标 / 查找已合并 / 清理已合并与过时分支 | ❌ | `FindMergedLocalBranchesAction`、`CleanupBranchesAction` |
| 保护分支 / force-push 后修复 / checkout with rebase | ❌ | `GitProtectedBranchProvider`、`GitForcePushedBranchUpdateAction` |
| 检出：分支/标签/提交/文件、新建分支检出、detached | ❌ | `GitCheckoutAction`、`GitCheckoutAsNewBranch`、`GitCheckoutFromInputAction` |

### C.8 MergeDialog ❌（P2）

- **用途**：合并对话框；§4.5.2 对照 `GitMergeDialog` + `GitOptionsPanel`。
- **计划落点**：`api/merge.ts` + `composite/MergeDialog`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 合并方向选择（MergeDirectionModel） | ❌ | |
| merge 策略选项 / commit 选项 | ❌ | `GitMergeOption` |
| 合并进行中状态联动（Merging 前缀、中止入口） | ❌ | 依赖 `operation.ts`（P2-A；契约 `OperationState` 已备） |

### C.9 RebaseDialog ❌（P3）

- **用途**：rebase 对话框 + 交互式 rebase 编辑器；§4.5.2 对照 `GitRebaseCommitsTableView/Model` + `GitInteractiveRebaseDialog`。
- **计划落点**：`api/rebase.ts` + `composite/RebaseDialog`（`InteractiveRebaseTable` 领域组件）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| rebase onto（目标基选择） | ❌ | `GitRebaseDialog` |
| 交互式列表：entry 状态机（pick/reword/squash/fixup/drop）、上移/下移约束、冲突标记 | ❌ | 信息架构逐项对照 §4.5.2 |
| auto-squash / fixup、squash by subject | ❌ | `GitAutoSquashCommitAction`、`GitCommitSquashBySubjectAction` |
| continue / abort / rebase 冲突联动 | ❌ | 依赖 `operation.ts` 与 `conflict.ts` |

### C.10 StashPanel ❌（P2）

- **用途**：贮藏管理；对应 `GitStashDialog` / `GitUnstashAsDialog` / `GitStashBranchComponent`。
- **计划落点**：`api/stash.ts` + `composite/StashPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| stash save（含 message、keep index 等选项） | ❌ | |
| pop / apply / drop | ❌ | |
| un-stash 对话框 / stash as branch | ❌ | |

### C.11 TagPanel ❌（P3）

- **用途**：标签管理；对应 `GitTagHolder` / `GitPushTagsAction`。
- **计划落点**：`api/tag.ts` + `composite/TagPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 创建标签（含附注） | ❌ | |
| 删除标签 | ❌ | |
| 推送标签 | ❌ | 依赖 `remote.ts` push |

### C.12 RemotePanel ❌（P3）

- **用途**：远程仓库管理 + 凭据；对应 `GitConfigureRemotesDialog`、`GitHttpAuthService` / `GitHttpLoginDialog`。
- **计划落点**：`api/{remote,auth}.ts` + `composite/RemotePanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 远程添加 / 删除 / 编辑 | ❌ | |
| fetch（含 fetch spec） | ❌ | `GitFetchSpec` |
| shallow clone 识别 / unshallow | ❌ | `GitUnshallowRepositoryAction` |
| HTTPS 认证对话框 / credential helper 桥接 / token 存储 | ❌ | `auth.ts`；credential helper 由系统 git 自处理（架构 spec §8），auth.ts 只做兜底对话框；错误码 `AUTH_FAILED` 已预留 |

### C.13 PushDialog ❌（P3）

- **用途**：推送对话框；对应 `GitRejectedPushUpdateDialog` / `GitPushTagsAction`。
- **计划落点**：`api/remote.ts` + `composite/PushDialog`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| push（远程/分支选择、当前分支推送） | ❌ | |
| rejected push 处理（提示 update 后再推） | ❌ | |
| push tags / force push（及 force-push 修复联动） | ❌ | 联动 `branch.ts` |

### C.14 PullDialog ❌（P3）

- **用途**：拉取对话框（远程与分支选择、fetch 预览）。
- **计划落点**：`api/remote.ts` + `composite/PullDialog`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| pull（远程/分支选择） | ❌ | |
| fetch 全远程 / fetch spec 定制 | ❌ | |

### C.15 UpdateProjectDialog ❌（P3）

- **用途**：Update Project——多仓库/多分支一键更新的策略化入口；对应 `GitUpdateOptionsDialog` / `GitUpdateSession` / `GitPostUpdateHandler` / `FixTrackedBranchDialog`。
- **计划落点**：`api/update.ts` + `composite/UpdateProjectDialog`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| pull + merge/rebase 策略选择 | ❌ | |
| 更新会话（进度/结果汇总） | ❌ | |
| 修复跟踪分支 | ❌ | `FixTrackedBranchDialog` |

### C.16 BlameView ❌（P3）

- **用途**：文件溯源注解（逐行显示最后修改提交/作者/日期，联动历史）；对应 `GitAnnotationProvider` / `GitAnnotationService`。
- **计划落点**：`api/blame.ts`（core `blame.ts` 薄封装）+ `composite/BlameView`（Monaco gutter 扩展）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| gutter 注解列（提交短 hash/作者/日期） | ❌ | |
| 注解点击联动（显示提交/历史） | ❌ | |

### C.17 HistoryPanel ❌（P3）

- **用途**：单文件提交历史（含重命名跟随）；对应 `GitFileHistory` / `GitHistoryTraverser`。
- **计划落点**：`api/history.ts` + `composite/HistoryPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 文件历史列表 | ❌ | core `log.ts` 已具备 `path` 过滤原语（`-- <path>`）可复用 |
| 重命名跟随（`--follow`） | ❌ | core `log.ts` 当前未实现 `--follow`（实测仅有 author/path 过滤） |
| 历史版本 diff 联动 | ❌ | 可复用 DiffPage 的 from/to 能力（端点已支持） |

### C.18 CommittedChangesPanel ❌（P3）

- **用途**：Committed Changes 浏览器——按提交/目录树浏览已提交变更；对应平台 `changes\committed`（`CommittedChangesBrowser`）+ `GitCommittedChangeListProvider`；§4.5.2 对照目录树结构。
- **计划落点**：`api/committed.ts` + `composite/CommittedChangesPanel`（`FileTree` 基础组件）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 按提交浏览已提交变更 | ❌ | |
| 目录树组织变更文件 | ❌ | |
| 与 diff 查看器联动 | ❌ | |

### C.19 SearchPanel ❌（P3）

- **用途**：提交搜索；对应 `GitSearchUtils` / `GitSearchEverywhereContributor`。
- **计划落点**：`api/search.ts` + `composite/SearchPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 提交内容搜索（grep / pickaxe `-S`/`-G`） | ❌ | |
| Search Everywhere 式提交/分支快速搜索 | ❌ | |

### C.20 ConflictsPanel ❌（P2）

- **用途**：冲突解决主页——冲突文件列表 + 3-way 合并视图；§4.5.2 对照 `GitConflictsPanel` + 平台 3-way merge（冲突文件分组、左右 diff + 底部合并结果面板）。
- **计划落点**：`api/conflict.ts` + `composite/ConflictsPanel` + `base/ThreeWayMergeView`（MergeView 基础组件亦未做）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 冲突文件分组列表 | ❌ | `GitResolvedConflictsFilesHolder` |
| 标记已解决 | ❌ | `MergeConflictResolveUtil` |
| 3-way 合并视图（左/右/结果三栏） | ❌ | Monaco 扩展或自研；基础组件未做 |
| 合并状态查询（与 operation 联动） | ❌ | 契约 `OperationState`（kind: 'merge'）已备 |

### C.21 PatchPanel ❌（P3）

- **用途**：补丁创建/应用/已保存补丁管理；对应平台 patch 包 + `GitStageCreatePatchActionProvider`。
- **计划落点**：`api/patch.ts` + `composite/PatchPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 从变更创建补丁（unified diff 导出） | ❌ | 可复用 `api.getFileDiff` 的 unified 文本能力 |
| 应用补丁 | ❌ | |
| 已保存补丁列表管理 | ❌ | |

### C.22 ShelfPanel ❌（P3）

- **用途**：Shelf 搁置——变更的本地暂存架（与 git stash 互补的平台能力）；对应平台 `com/intellij/vcs/shelf`。
- **计划落点**：`api/shelf.ts` + `composite/ShelfPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 搁置保存（变更 → shelf） | ❌ | |
| 恢复 / 删除搁置 | ❌ | |

### C.23 WorktreePanel ❌（P4）

- **用途**：git worktree 管理；对应 `GitWorkingTreeDialog` / `workingTrees/ui`。
- **计划落点**：`api/worktree.ts` + `composite/WorktreePanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 工作树创建 / 打开 / 清理 / 删除 | ❌ | |
| worktree 仓库识别 | 🟡 | core `findRepoRoot` 已支持 worktree 的 `.git` 指针文件（发现级，core/repo.ts:1-7） |

### C.24 SubmodulePanel ❌（P4）

- **用途**：子模块状态与更新；对应 `GitSubmoduleUpdater` / `GitSubmodule` / `GitModulesFileReader`。
- **计划落点**：`api/submodule.ts` + `composite/SubmodulePanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 子模块状态列表（`.gitmodules` 解析） | ❌ | |
| 子模块更新（init/update） | ❌ | |

### C.25 IgnoreDialog ❌（P3）

- **用途**：`.gitignore` / `.git/info/exclude` 编辑；对应 `GitIgnoreFileActionGroup` / `DefaultGitExcludeAction` / ignore-lang。
- **计划落点**：`api/ignore.ts` + `composite/IgnoreDialog`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| .gitignore 创建 / 编辑 / 模板 | ❌ | |
| 一键忽略文件/目录（含 exclude） | ❌ | |

### C.26 GitHubPanel ❌（P3）

- **用途**：GitHub 集成——认证、克隆、PR 全流程、Gist；对应 `github-core`（accounts/pullrequest/ui、`GithubCreateGistDialog`）。注：Java 侧 Issues/通知仅剩无 UI 的内部加载器，不覆盖（架构 spec §4.2）。
- **计划落点**：`api/github.ts` + `composite/GitHubPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 账户 / token 认证 | ❌ | 错误码 `AUTH_FAILED` / `RATE_LIMITED` 已预留 |
| 克隆 GitHub 仓库 / 分享项目到 GitHub | ❌ | 可复用 `cloneRepo` 服务层能力 |
| PR 列表 / 详情 / 时间线 / 评论 | ❌ | |
| PR 审查（approve / request changes）/ diff 视图 / 三种合并策略 / AI 描述 | ❌ | |
| Gist 创建 | ❌ | `GithubCreateGistDialog` |

### C.27 GitLabPanel ❌（P4）

- **用途**：GitLab 集成——认证、MR 全流程、Snippet；对应 `gitlab-core`（mergerequest、snippets、ui\review）。
- **计划落点**：`api/gitlab.ts` + `composite/GitLabPanel`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 账户认证 | ❌ | |
| MR 创建 / 列表 / 详情 / diff 视图 / 评论 | ❌ | |
| MR 审查（approve / request changes）/ 合并 | ❌ | |
| Snippet 创建 | ❌ | |

### C.28 GitConsole ❌（P3）

- **用途**：Git 命令输出控制台（命令回显、输出折叠、错误呈现）；对应 `GitCommandOutputConsolePrinter` / `GitConsoleFoldingImpl`。
- **计划落点**：`api/console.ts` + `composite/GitConsole`。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| git 命令输出展示 | ❌ | 服务端现有 `GIT_ERROR` 带 stderr 上下文，可作数据源 |
| 输出折叠 / 按命令分组 | ❌ | |

### C.29 QuickActionsMenu ❌（P2+，聚合面）

- **用途**：当前仓库可执行操作全集的快捷入口聚合（分支弹窗 + 快捷动作工具栏）；§4.5.2 对照 `GitBranchesTreePopupOnBackend` / `GitQuickActionsToolbarPopup`。
- **计划落点**：`composite/QuickActionsMenu`；无独立 api 文件，聚合各域动作（落地顺序随 P2/P3 各域就位逐步扩大）。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 分支快捷弹窗（切换/新建） | ❌ | 依赖 `branch.ts`/`checkout.ts` |
| 当前可用操作聚合（fetch/pull/push/stash/…） | ❌ | 依赖各域动作入口 |

### C.30 SettingsPage ❌（P1 域 settings / P2 域 config；数据层已通）

- **用途**：应用设置 + git 配置页；对应 `GitVcsPanel` / `GitExecutableSelectorPanel` / `GitGpgConfigDialog` / `SSHConnectionSettings` / `VcsLogConfigurable` / `GitConfig`。
- **计划落点**：`api/config.ts` + `composite/SettingsPage`；实施计划 `docs/superpowers/plans/2026-09-03-rebasedjs-p2a-config-operation.md` 已就绪。

| 功能点 | 状态 | 说明 |
|--------|------|------|
| 设置读写通道（`GET/PUT /api/settings` + `useSettings` SWR/mutation） | 🟡 | 端到端已通且有测试；当前仅 `logInEditor`、`recentRepoIds` 两项，且偏好值未接入任何 UI 行为（本文 §2.1 #9/#10） |
| log 位置偏好（logInEditor 复选框） | 🟡 | 数据层就绪，无设置 UI（`VcsLogConfigurable.kt:62-65` 对照） |
| 最近仓库管理 | ✅（等效） | 由 RepoPage 列表承载；`recentRepoIds` 已持久化于 config-store |
| 仓库级设置集中存储（Rebased 独家"禁用 .idea"的 TS 映射） | ✅（策略级） | 应用配置集中于 `api/lib/config-store`，无 `.idea` 概念（架构 spec §2.2） |
| git 配置白名单读写（user.name/email、core.autocrlf、pull.rebase、commit.gpgsign、user.signingkey、fetch.prune、init.defaultBranch 共 8 键） | 🟡 | 契约就绪（`CONFIG_KEYS` / `GitConfigView` / `configPutBodySchema`，`b3d438e`）；`config.ts` 服务层/路由/UI 未做（P2-A） |
| git 可执行文件检测 / 引导 | ❌ | `GitExecutableSelectorPanel` |
| GPG 配置 / SSH 配置 | ❌ | `GitGpgConfigDialog`、`SSHConnectionSettings`；白名单键已备 |
| 保护分支设置 | ❌ | P2 `branch.ts` |
| 自动 fetch 设置 | ❌ | P3 `remote.ts`/`update.ts` |

### C.31 汇总

| 复刻状态 | 页面数 | 页面 |
|----------|--------|------|
| ✅ 已复刻 | 3 | RepoPage、LogPage、DiffPage（P1 全量，各自带 🟡 级遗留，见 C.1–C.3 总评） |
| ❌ 未复刻（周边有基础） | 4 | StatusPage（status 域）、SettingsPage（settings 数据层 + config 契约）、WorktreePanel（发现原语）、GitHubPanel（错误码预留） |
| ❌ 未复刻 | 23 | 其余全部（P2–P4） |

> 页面级口径与 §1.2 完全一致（3/30 = 10%）；本附录的 🟡 均为"功能点级"细分，不改变页面级结论。功能点级缺口最多的已复刻页面是 LogPage（过滤/分页 UI、右键菜单），最近的下一步与 §三建议一致：先消化 3 个半使用接口，再按 P2-A/P2-B 计划落地 SettingsPage / StatusPage / CommitDialog。

---

## 附录 D：30 个操作页面的跳转关系（导航图谱）

### D.0 口径与方法

- **参照系**：Java 版 Rebased 源码（`D:\zhanglei1120\Github\rebased`）。证据以 action 注册表与动作类源码为准；路径简写：`backend` = `plugins/git4idea/backend/src`，`backend.xml` = `plugins/git4idea/backend/resources/intellij.vcs.git.backend.xml`，`VcsActions.xml` = `platform/vcs-impl/resources/META-INF/VcsActions.xml`，`vcs-log.xml` = `platform/vcs-log/impl/resources/intellij.platform.vcs.log.impl.xml`（一手来源清单见附录 B-4/5/6）。
- **"跳转"口径**：用户可见的页面间导航边——菜单项、按钮、弹窗动作、双击、右键、快捷键、工具窗口 tab 切换。**不含页内交互**（如 LogPage 行点击展开详情面板、DiffPage 的并排/行内切换）。
- **核查方法**：action 注册组枚举（Git 主菜单 / 分支弹窗 / 日志右键 / Local Changes 右键 / 工具窗口 tab 组）+ 动作类逐一验证 + 分四域并行深查（日志差异历史 / 变更提交 / 分支操作 / 入口远程设置）+ 抽查复核。标注"未找到直接证据"的边为经查找确认不存在（或仅有间接通道）者。
- **rebasedjs 复刻状态基线**：当前 HEAD `a09f050` + 工作区未提交改动（settings 路由两端接线）。**与 §1.2/附录 C 的 `cbb7dfa` 快照相比 P2-A 已落地**：SettingsPage 成为第 4 个有路由的页面（`/repos/:repoId/settings`，两端对称），新增 2 条活动跳转边——本附录复刻状态按此新基线如实记录，不回改前文快照口径。
- **状态图例**：✅ 已复刻（端到端可用）｜🟡 部分（路由/服务就绪但入口未通）｜📋 计划就绪（P2-x 计划文档已定形）｜❌ 未复刻｜➖ Java 形态在 Web 无对应。

### D.1 容器形态总览（导航语义的前提）

30 个页面在 Java 版有 6 种容器形态；形态决定导航语义（tab 是"切换共存"、模态是"叠层后返回"、弹窗是"瞬时菜单"）：

| 容器形态 | 页面 |
|----------|------|
| 独立窗口/帧 | RepoPage（欢迎屏 `FlatWelcomeFrame.kt:111`）；ConflictsPanel 的 3-way 合并视图（独立 Frame，`MergeConflictResolveUtil.kt:73`） |
| Version Control（Commit）工具窗口 tab | StatusPage（Local Changes，`ChangesViewContentManager.kt:298`）、LogPage（Log tab，Rebased 默认编辑器 tab——`showInEditor=true`）、StashPanel（Stash tab）、ConflictsPanel（Conflicts tab，`GitConflictsToolWindowManager.java:26`）、HistoryPanel、CommittedChangesPanel（Repository tab，`CommittedChangesViewManager.kt:39`）、ShelfPanel（`ShelvedChangesViewManager.java:169`）、GitConsole、WorktreePanel（Worktrees tab）；GitHubPanel / GitLabPanel 各有独立 PR/MR 工具窗口（检测到对应远程才显示） |
| 模态对话框 | CommitDialog（modal 形态 `CommitChangeListDialog.java:115`）、ResetDialog、MergeDialog、RebaseDialog（+交互式编辑器 `GitInteractiveRebaseDialog`）、TagPanel、RemotePanel（`GitConfigureRemotesDialog` + 认证 `GitHttpLoginDialog.kt:36`）、PushDialog（`VcsPushDialog`，本 fork 无独立 GitPushDialog 类）、PullDialog（`GitPullDialog`）、UpdateProjectDialog（`GitUpdateOptionsDialog.kt:23`）、PatchPanel（创建 `CreatePatchFromChangesAction` SessionDialog / 应用 `ApplyPatchDifferentiatedDialog`）、StashPanel 的 save（`GitStashDialog`）与 Unstash As（`GitUnstashAsDialog`）、WorktreePanel 的创建（`GitWorkingTreeDialog`） |
| 弹出（非模态弹窗/菜单） | BranchPanel（TreePopup，`GitBranchesPopup.kt:13`）、QuickActionsMenu（ActionGroupPopup）、SearchPanel（Search Everywhere Git tab） |
| 编辑器内嵌 | BlameView（gutter 注解）；DiffPage 二态：模态对话框或编辑器 tab（`DiffManager`） |
| 无独立 UI | SubmodulePanel（仅 Update Project 流程内更新子模块，`GitUpdateProcess.java:327-335`）、IgnoreDialog（写入后直接编辑器打开 .gitignore，`IgnoreFileAction.kt:82`，非对话框） |

### D.2 全局导航骨架

```text
                         ┌────────────────────────── 主窗口 ──────────────────────────┐
                         │                                                            │
 欢迎屏 RepoPage ──Open/双击最近项目──▶  LogPage（仓库视图枢纽；Rebased 默认编辑器 tab） │
     │                                   StatusPage（Local Changes，变更枢纽）         │
     ├─Get from VCS─▶ 克隆对话框 ─克隆完成自动打开项目─▶  …                            │
     │                                   Shelf/Stash/Conflicts/History/Committed/      │
     └─Configure─▶ SettingsPage           Console/Worktrees（同窗口 tab 互相切换）      │
                         │                                                            │
                         │  全局入口面（任意处可达）：                                  │
                         │  ① Git 主菜单（Rebased：已上移至主菜单顶层，见 D.5）          │
                         │  ② 状态栏分支 widget ─▶ BranchPanel                         │
                         │  ③ 主工具栏：Update Project / Push / 分支按钮 /「…」        │
                         │     QuickActionsMenu / 进行中操作 widget                     │
                         │  ④ 工具窗口 tab 组（Alt+数字）                              │
                         │  ⑤ Search Everywhere（SearchPanel）                        │
                         └────────────────────────────────────────────────────────────┘
        返回：File → Close Project ─▶ 回欢迎屏（CloseProjectsActionBase.kt:42-46）
```

五个全局入口面即是大多数对话框的"入边来源"：Git 主菜单一项就承载 20+ 条入边（见 D.3.4）。模态对话框关闭即返回源页（隐含回边，下表不再逐条列出"取消/关闭"）。

### D.3 逐页跳转表（按域分组）

#### D.3.1 入口与设置域（RepoPage、SettingsPage）

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 1 | RepoPage → 主窗口（Log/Changes） | 双击最近项目 / Open 按钮 | `OpenSelectedProjectsAction`（PlatformActions.xml:1251）、`OpenFileAction$OnWelcomeScreen`（customization min xml:46-48） | ✅（打开成功 `router.push/navigate(/repos/:id)`，`apps/web-next/app/page.tsx:21`、`apps/web-koa/src/pages.tsx:19`） |
| 2 | RepoPage → 克隆对话框 → 主窗口 | Get from VCS；克隆完成自动打开项目 | `GetFromVersionControlAction`（VcsActions.xml:486-488）→ `VcsCloneDialog`；`ProjectCheckoutListener.java:21` | 🟡（`cloneRepo` 服务层就绪，无端点无 UI） |
| 3 | RepoPage → SettingsPage | 欢迎屏 Configure | PlatformActions.xml:1208-1209 | ❌ |
| 4 | 主窗口 → RepoPage | File → Close Project | `CloseProjectsActionBase.kt:42-46`（`WelcomeFrame.showIfNoProjectOpened`） | ❌（LogPage 无回 `/` 入口） |
| 5 | 任意处 → SettingsPage | File → Settings | PlatformActions.xml:509-510 | ➖（rebasedjs 改由 LogPage 顶栏进入，见 #6） |
| 6 | LogPage → SettingsPage | Log tab 下拉 Show Settings（Vcs Log 设置子页） | `Vcs.Log.ShowSettingsAction`（vcs-log.xml:324）→ `VcsLogConfigurable` | ✅（等价边：顶栏设置按钮 → `/repos/:id/settings`，`app/repos/[repoId]/page.tsx:69`、`web-koa/src/pages/repo.tsx:68`，工作区接线） |
| 7 | SettingsPage → LogPage | 关闭对话框回源页（模态隐含回边） | —（模态语义） | ✅（"返回日志"按钮，`settings/page.tsx:26`、`web-koa/src/pages/settings.tsx:23`，工作区接线） |
| 8 | GitHubPanel / GitLabPanel → SettingsPage | 面板菜单 Settings（账户子页） | `GHOpenSettingsAction.kt:13`、`GitLabOpenSettingsAction.kt:14` | ❌ |

> SettingsPage 内部子页结构：Version Control 根页 + Git 子页（`GitVcsPanel`，含 SSH/GPG）+ Log 子页（`VcsLogConfigurableProvider`）+ GitHub/GitLab 账户子页——子页间为设置树切换，不逐条计边。

#### D.3.2 日志 / 差异 / 历史域（LogPage、DiffPage、HistoryPanel、BlameView、SearchPanel、CommittedChangesPanel、GitConsole）

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 9 | Git 菜单 → LogPage | Show Git Log | `Vcs.Show.Log`（backend.xml:181）→ `VcsShowLogAction` | ➖（rebasedjs 的 LogPage 即仓库主页，无"打开 log"动作） |
| 10 | BranchPanel → LogPage | 分支菜单 Compare with Branch（对比视图） | `GitCompareWithBranchAction.kt:33` → `GitBrancher.compare`（GitBrancherImpl.java:191） | ❌ |
| 11 | SearchPanel → LogPage | 提交结果回车定位 | `GitSearchEverywhereContributor.kt:179` → `VcsProjectLog.showRevisionInMainLog` | ❌ |
| 12 | HistoryPanel → LogPage | Show Commit in Log | `ShowCommitInLogAction`（vcs-log.xml:235，action id `Vcs.Log.SelectInLog`） | ❌ |
| 13 | LogPage → DiffPage | Changes 列表双击 / Ctrl+D；右键 Compare Revisions / Show Diff with Local | 统一通道 `ChangesBrowserBase.onDoubleClick:211` → `ShowDiffAction.java:114`（`ChangeDiffRequestChain` → `DiffManager.showDiff`）；`CompareRevisionsFromLogAction`、`Vcs.ShowDiffWithLocal`（vcs-log.xml:275-276） | 🟡（DiffPage 路由存在但 LogPage 无任何入口，仅手输 `?file=` 可达） |
| 14 | LogPage → ResetDialog | 右键 Reset Current Branch to Here… | `Git.Reset.In.Log`=`GitResetAction` → `GitNewResetDialog`（backend.xml:345） | 📋 P2-D（ResetDialog 内嵌 LogPage，无独立路由） |
| 15 | LogPage → Undo Commit | 右键 Undo Commit（ChangeListChooser 小对话框 → 后台 soft reset） | `Git.Uncommit`=`GitUncommitAction.java:60-70`（backend.xml:347） | 📋 P2-D |
| 16 | LogPage → RebaseDialog（交互式编辑器） | 右键 Interactively Rebase from Here… | `GitInteractiveRebaseAction.kt:16-24` → `GitInteractiveRebaseDialog`（backend.xml:354） | ❌ P3 |
| 17 | LogPage → PushDialog | 右键 Push Commits up to Here… | `GitPushUpToCommitAction.kt:60` → `VcsPushDialog`（backend.xml:355） | ❌ |
| 18 | LogPage → New Branch 对话框 | 右键 New Branch… | `GitCreateNewBranchFromCommitAction.kt:24`（backend.xml:361-363） | ❌ |
| 19 | LogPage → New Tag | 右键 New Tag…（轻量输入框，非 GitTagDialog） | `GitCreateTagAction.java:39`（`Messages.showInputDialog`，backend.xml:364） | ❌ |
| 20 | LogPage → 分支/标签操作子菜单 →（Merge/Rebase/Cherry-pick/Push…） | 右键分支操作组（复用分支弹窗动作集，直接执行不开对话框） | `Git.BranchOperationGroup`=`GitLogBranchOperationsActionGroup.java:188-205`（backend.xml:360） | ❌ |
| 21 | LogPage →（Revert / Reword / Fixup / Squash / Drop） | 右键（Reword/Fixup/Squash/Drop 最终入 rebase 引擎，隐藏边 LogPage→Rebase） | backend.xml:346-353（`GitRevertAction`、`GitRewordAction`、`GitSquashLogAction` 等） | ❌ |
| 22 | LogPage →（Checkout / 浏览历史快照） | 右键 Checkout 组 / Browse Repo at Revision | `Git.Log.ContextMenu.CheckoutBrowse`（backend.xml:337-342） | ❌（browse=P4 `browse.ts`） |
| 23 | LogPage → PatchPanel | 右键 Create Patch from commit | `ChangesView.CreatePatchFromChanges`（vcs-log.xml:273） | ❌ |
| 24 | LogPage → GitConsole | tab 下拉 Console | `Vcs.ShowConsoleTab`（vcs-log.xml:321-322）→ `ShowVcsConsoleTabAction.kt:36` | ❌ |
| 25 | LogPage → HistoryPanel | tab 下拉 Show History（文件历史 tab） | `Vcs.ShowTabbedFileHistory`（vcs-log.xml:321） | ❌ |
| 26 | LogPage →（Open in Browser） | 右键托管平台链接 | `Git.Hosting.Open.In.Browser.Group` 注入 `Vcs.Log.ContextMenu`（backend.xml:555-561） | ❌ |
| 27 | DiffPage 页内 | 多文件切换 Prev/Next File | `DiffNextFileAction`/`DiffPreviousFileAction` | ❌ |
| 28 | 编辑器/项目树 → HistoryPanel | 右键 Git 菜单 Show History | `Git.FileActions` 引用 `Vcs.ShowTabbedFileHistory`（backend.xml:115）→ `TabbedShowHistoryAction` | ❌ |
| 29 | BlameView → HistoryPanel | gutter 右键 Show in History | `ShowInFileHistoryAnnotationActionProvider.kt:55` | ❌ |
| 30 | HistoryPanel → DiffPage | 双击版本/变更 | `ChangesBrowserBase.onDoubleClick:211`（+ backend.xml:328-341 历史右键组） | ❌ |
| 31 | HistoryPanel → BlameView | Annotate Revision | `AnnotateRevisionFromHistoryAction` | ❌ |
| 32 | 编辑器 → BlameView | 右键 Annotate | `AnnotateToggleAction`（VcsActions.xml:20）→ `GitAnnotationProvider.java:81` | ❌ |
| 33 | BlameView → DiffPage | gutter 右键 Show Diff | `ShowDiffFromAnnotation.java:85` | ❌ |
| 34 | BlameView →（受影响提交对话框） | 点击注解 Show All Affected | `ShowAllAffectedGenericAction` → `AbstractVcsHelperImpl.java:551-564`（ChangeListViewerDialog） | ❌ |
| 35 | BlameView 关闭 | gutter 右键 Close Annotations | `EditorGutterComponentImpl.CloseAnnotationsAction:2719` | ❌ |
| 36 | 任意处 → SearchPanel | Search Everywhere Git tab | `GitSearchEverywhereContributor` | ❌ |
| 37 | 工具窗口 → CommittedChangesPanel | Repository tab | `CommittedChangesViewManager.kt:39`（VcsExtensions.xml:194） | ❌ |
| 38 | CommittedChangesPanel → DiffPage | 双击变更 | `ChangesBrowserBase`（同上双击通道） | ❌ |
| 39 | LogPage →（带命令过滤器的 Log tab） | "Show Git Log for Command"（internal 动作，菜单不可见；**并非输出到 GitConsole**） | `Git.Log.Show.Command`=`ShowGitLogCommandAction`（backend.xml:322） | ❌ |

> 已核查但不存在的边：LogPage 右键直达 HistoryPanel（无直接证据）；分支弹窗直达 LogPage（无直接证据，仅 #10 的 Compare 对比视图）。

#### D.3.3 变更 / 提交域（StatusPage、CommitDialog、PatchPanel、ShelfPanel、IgnoreDialog、ConflictsPanel）

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 40 | 工具窗口 → StatusPage | Local Changes tab | `Vcs.Show.Local.Changes`（VcsActions.xml:635） | 📋 P2-B（`/repos/:id/status` 路由 + LogPage 顶栏"变更"入口） |
| 41 | StatusPage → CommitDialog | 提交按钮 / Ctrl+K；modal 与非模态提交面板二态切换 | `CommonCheckinProjectAction.kt:44`；分支 `CheckinActionUtil.kt:94-108` + `CommitModeManager.kt:39-44,91-118`；commit.modal 插件默认 modal（`ModalCommitModeProvider.kt:10`，AdvancedSettings `git.non.modal.commit`） | 📋 P2-B |
| 42 | StatusPage → DiffPage | 双击变更条目；右键 Show Diff | 双击 `EditorTabPreview.kt:110-118`；`Diff.ShowDiff` → `ShowDiffAction.java:114` | 📋 P2-B（StatusPage `onOpenDiff` → 既有 `/diff?file=` 路由） |
| 43 | StatusPage → ConflictsPanel | 冲突文件右键 Merge / Accept Theirs / Yours | `Git.ChangesView.Conflicts` 组 anchor=first 注入 ChangesViewPopupMenu（backend.xml:422-429）；`GitMergeConflictAction`（GitConflictActions.kt:78-86）→ showMergeWindow | 📋 P2-E |
| 44 | StatusPage → PatchPanel | 右键 Create Patch | `CreatePatchFromChangesAction.java:44`（VcsActions.xml:208）；Stage 树 `GitStageCreatePatchActionProvider.kt:37-54` | ❌ |
| 45 | StatusPage → ShelfPanel | Shelve Changes | `ChangesView.Shelve`=`ShelveChangesAction.kt:9` → `ShelveChangesCommitExecutor.java:65` | ❌ |
| 46 | StatusPage → IgnoreDialog | 右键 Add to .gitignore / Exclude | `GitIgnoreFileActionGroup`（backend.xml:380-384，注入 ChangesViewPopupMenu / Git.FileActions / Unversioned 对话框三处）；`GitExcludeActions.kt:49` | ❌ |
| 47 | StatusPage → HistoryPanel / BlameView | 右键 Git 文件动作（Annotate / Show History） | `Git.FileActions`（backend.xml:106-117） | ❌ |
| 48 | StatusPage（Stage 区）→ 三版本对比 DiffPage | 右键 Compare Three Versions | `GitStageCompareThreeVersionsAction.kt:41-50` | ❌ |
| 49 | StatusPage（Stage 区）→ StashPanel | Stash Files | `GitStageStashFilesAction`（backend.xml:420） | ❌ |
| 50 | CommitDialog → PushDialog | "Commit and Push…" 执行器（可配提交前预览开关） | `GitCommitAndPushExecutor.kt:19` → `GitCheckinEnvironment.kt:241-242` → `GitPushAfterCommitDialog.java`（extends `VcsPushDialog`）；按钮注入 `CommitChangeListDialog.java:451-465`；设置项 `previewPushOnCommitAndPush`（GitVcsPanel.kt:99） | ❌ P3 |
| 51 | VCS/Git 菜单 → PatchPanel（应用） | Apply Patch | `ApplyPatchAction.java:49-80`（`Patch.MainMenu`，backend.xml:182）；应用失败复用平台 merge 工具（VcsExtensions.xml:74-75） | ❌ |
| 52 | PatchPanel → ShelfPanel | Import Patches into Shelf | `ImportIntoShelfAction.java:74`（激活 Shelf tab） | ❌ |
| 53 | 工具窗口 → ShelfPanel | Shelf tab | `Vcs.Show.Shelf`（VcsActions.xml:636） | ❌ |
| 54 | ShelfPanel → StatusPage | Unshelve / Unshelve with Dialog（写回 LocalChangeList；**未找到自动切回 tab 的直接证据**） | `UnshelveChangesAction.kt:37`、`UnshelveWithDialogAction.java:43` | ❌ |
| 55 | IgnoreDialog → 编辑器 | 写入后打开 .gitignore/exclude | `IgnoreFileAction.kt:82` | ❌ |
| 56 | merge/rebase/update → ConflictsPanel | 冲突后自动出现 Conflicts tab（staging-area 开启时） | `GitConflictsToolWindowManager.java:26,56`（registry `git.merge.conflicts.toolwindow`）；冲突统一经 `GitConflictResolver`（GitMergeAction.java:190 等） | 📋 P2-E |
| 57 | Git 菜单 → ConflictsPanel | Resolve Conflicts… | `GitResolveConflictsAction.java:67` → `AbstractVcsHelper.showMergeDialog` | 📋 P2-E |
| 58 | 主工具栏 → ConflictsPanel | 进行中操作 widget 的 Resolve 按钮 | `GitMergeRebaseWidget`（backend.xml:539-553，`GitMergeRebaseWidgetGroup`） | 📋 P2-E（OperationStatus 旁"去解决冲突"链接） |
| 59 | ConflictsPanel → 3-way 合并视图 | 双击冲突文件 | `GitConflictsPanel.kt:70-82`；独立 Frame `MergeConflictResolveUtil.kt:73` | 📋 P2-E（MergeView 全屏 Modal） |
| 60 | ConflictsPanel → StatusPage | 全部解决完成 | `MergeConflictManager.showMergeConflicts`（MergeConflictManager.kt:58-70） | 📋 P2-E（"完成合并"回日志页） |

#### D.3.4 分支 / 操作域（BranchPanel、QuickActionsMenu、ResetDialog、MergeDialog、RebaseDialog、StashPanel、TagPanel、PushDialog、PullDialog、UpdateProjectDialog）

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 61 | 状态栏 → BranchPanel | 点击分支 widget | `GitBranchWidget.kt:68-71` → `GitBranchesTreePopupOnBackend` | ➖（Web 无状态栏；等价物=LogPage 顶栏"分支"按钮，📋 P2-C） |
| 62 | Git 菜单 → BranchPanel | Branches… / Ctrl+Shift+` | `GitBranchesAction.java:26`（backend.xml:169-173 含快捷键） | 📋 P2-C |
| 63 | 主工具栏 → BranchPanel | 分支下拉按钮 | `GitBranchesComboBoxAction.java:68`（backend.xml:313-316） | ❌ |
| 64 | QuickActionsMenu → BranchPanel | Branches… 菜单项 | `GitQuickListContentProvider.java:24` | ❌ |
| 65 | BranchPanel → New Branch 对话框 | 弹窗顶部 New Branch… | `Git.Branches.List`（backend.xml:245-249）→ `GitCreateNewBranchAction` → `GitNewBranchDialog` | 📋 P2-C |
| 66 | BranchPanel → GitRefDialog | Checkout Branch or Revision… | `GitCheckoutFromInputAction.kt:38` | 📋 P2-C |
| 67 | BranchPanel →（fetch） | 弹窗 Fetch 按钮（仅主弹窗可见） | `GitBranchPopupFetchAction.kt:21-24` | ❌ |
| 68 | BranchPanel → PushDialog | 分支菜单 Push… | `GitPushBranchAction.kt:20` → `VcsPushDialog`（backend.xml:272） | ❌ |
| 69 | BranchPanel → DiffPage | 分支菜单 Show Diff with Working Tree | `GitShowDiffWithRefAction.kt:25` → `GitBrancher.showDiffWithLocal` | ❌ |
| 70 | BranchPanel → WorktreePanel | 分支菜单 New Working Tree | backend.xml:269（`Git.Branch.Backend` 组） | ❌ |
| 71 | BranchPanel →（直接执行，不开对话框） | 分支菜单 Checkout / Merge into Current / Rebase onto / Pull(merge/rebase) / Update / Rename / Delete / Push Tags | backend.xml:251-283（`GitCheckoutAction`、`GitMergeRefAction.kt:19`、`GitRebaseBranchAction.kt:39`、`GitPullBranchAction.kt:25`、`GitUpdateSelectedBranchAction.kt:15` 等；**弹窗内无 Reset 项**——未找到直接证据） | 📋 P2-C（分支页动作） |
| 72 | 任意处 → QuickActionsMenu | Alt+` | `Vcs.QuickListPopupAction`（keymaps `$default.xml:1125-1127`） | ❌ |
| 73 | 主工具栏「…」→ QuickActionsMenu | Show More Actions | `GitQuickActionsToolbarPopup.kt:35` → Vcs.Operations.Popup（backend.xml:318-319） | ❌ |
| 74 | QuickActionsMenu → BranchPanel / PushDialog / StashPanel / ConflictsPanel / WorktreePanel | 菜单项（Branches/Push/Stash/Unstash/Resolve Conflicts/Working Trees/Unshallow） | `GitQuickListContentProvider.java:24-37` + VcsActions.xml:648-670 | ❌（随各域落地聚合） |
| 75 | Git 菜单 → PushDialog | Push… / Ctrl+Shift+K | `Vcs.Push`（backend.xml:154）→ `VcsPushAction.java:39` → `VcsPushDialog.show()`；主工具栏按钮 dvcs xml:73 | ❌ |
| 76 | Git 菜单 / 主工具栏 → UpdateProjectDialog | Update Project / Ctrl+T | `CommonUpdateProjectAction`（VcsActions.xml:46-50）→ `GitUpdateOptionsDialogProvider.kt:21` → `GitUpdateOptionsDialog`；主工具栏按钮 PlatformActions.xml:1084 | ❌ |
| 77 | Git 菜单 → PullDialog | Pull… | `GitPull.java:47` → `GitPullDialog`（backend.xml:156） | ❌ |
| 78 | Git 菜单 →（直接 fetch，无对话框） | Fetch | `GitFetch.java:25`（backend.xml:157） | ❌ |
| 79 | Git 菜单 → MergeDialog | Merge… | `GitMerge.java:35` → `GitMergeDialog`（backend.xml:160） | 📋 P2-E（`/merge` 路由 + LogPage 顶栏入口） |
| 80 | Git 菜单 → RebaseDialog | Rebase… | `GitRebase.java:67` → `GitRebaseDialog`（backend.xml:162） | ❌ |
| 81 | Git 菜单 → ResetDialog（旧版） | Reset HEAD… | `GitResetHead.java:43` → `git4idea.ui.GitResetDialog`（backend.xml:176） | 📋 P2-D（rebasedjs 仅内嵌日志右键新版，无菜单入口） |
| 82 | Git 菜单 → StashPanel | Local Changes 子菜单 Stash / Unstash / Show Stashes | `GitStash.java:23` → `GitStashDialog`；`GitUnstash.java:35-42`（有 Stash tab 激活 tab，否则模态 `GitUnstashDialog`）；`GitShowStashTabAction.kt:36` | ❌ |
| 83 | StashPanel → GitUnstashAsDialog | Stash 右键 Unstash As… | `GitStashActions.kt:62`（backend.xml:490、502-507） | ❌ |
| 84 | StashPanel → DiffPage | Stash 变更右键 Show Diff | `Vcs.ShowDiffWithLocal.Before`（backend.xml:511-517） | ❌ |
| 85 | Git 菜单 → TagPanel | Tag… | `GitTag.java:33` → `GitTagDialog`（backend.xml:175） | ❌ |
| 86 | Git 菜单 → RemotePanel | Manage Remotes… | `GitConfigureRemotesAction.kt:34` → `GitConfigureRemotesDialog`（backend.xml:186） | ❌ |
| 87 | Git 菜单 → 克隆对话框 | Clone… | `Git.Clone`（backend.xml:187） | 🟡（同 #2） |
| 88 | Git 菜单 → WorktreePanel | New Worktree… / Show Worktrees | backend.xml:178-179 → `GitCreateWorkingTreeService.kt:72`（弹 `GitWorkingTreeDialog`）/ `ShowWorkingTreesAction.kt:41`（激活 Worktrees tab） | ❌ |
| 89 | Git 菜单 → ShelfPanel / PatchPanel / LogPage / QuickActionsMenu | Local Changes 子菜单 Shelf；Patch 子菜单；Show Git Log；菜单底部 Quick List | backend.xml:144（`Vcs.Show.Shelf`）、:182（`Patch.MainMenu`）、:181、:189 | ❌ |
| 90 | Git 菜单 → GitHubPanel / GitLabPanel | View Pull Requests / Show Merge Requests | `GithubViewPullRequestsAction.kt:24`（`GHPRToolWindowFactory.kt:57,69` 检测 GitHub 远程才显示）；intellij.vcs.gitlab.xml:43-46 | ❌ |
| 91 | PushDialog →（GitRejectedPushUpdateDialog → GitUpdateProcess）| push 被拒弹"Update required"选 Merge/Rebase → 与 Update Project 同一更新引擎 → 成功后继续 push | `GitPushOperation.java:485-512`；`GitRejectedPushUpdateDialog.kt:48-62` | ❌ |
| 92 | UpdateProjectDialog → SubmodulePanel | 更新流程内对 detached-HEAD 子模块跑 submodule update | `GitUpdateProcess.java:327-335`（`GitSubmoduleUpdater`） | ❌ |
| 93 | UpdateProjectDialog →（reset --hard 到跟踪分支） | 对话框左下 Reset Current Branch to \<tracked\> | `GitUpdateOptionsDialog.kt:24-28`（`ResetToRemoteBranchAction`） | ❌ |
| 94 | MergeDialog / RebaseDialog / 主工具栏 →（continue/abort/skip） | 进行中操作的继续/中止（Git 菜单 RebaseActions/MergeActions 组 + 主工具栏 widget） | backend.xml:131-140、:228-236、:539-553 | 📋 P2-A/E（OperationStatus 中止已通；continue 随 P2-E） |

#### D.3.5 远程 / 集成域（RemotePanel、WorktreePanel、SubmodulePanel、GitHubPanel、GitLabPanel）

| # | 源 → 目标 | 手势/入口 | Java 证据 | rebasedjs |
|---|-----------|-----------|-----------|-----------|
| 95 | 任意远程操作 → 认证对话框（RemotePanel 一部分） | push/pull/fetch 401 自动弹出；对话框内嵌"Log in via GitHub/GitLab"按钮 → 托管登录流 | `GitHttpGuiAuthenticator.java:399-440` → `GitHttpLoginDialog.kt:36`（:400-406） | ❌（错误码 `AUTH_FAILED` 已预留） |
| 96 | Worktrees tab → 打开 worktree 项目 | 双击 worktree | `Git.WorkingTrees.Open`（backend.xml:577-579，双击快捷键注册） | ❌ |
| 97 | GitHubPanel 列表 → 详情 tab + 时间线 | 双击 PR | `GHPROpenPullRequestAction.kt:24-25`（详情 tab + 编辑器时间线同时开） | ❌ |
| 98 | GitHubPanel 详情 → PR diff | Changes 树打开 diff | `GHPRFilesManagerImpl.kt:37-46`（`GHPRDiffVirtualFile` 编辑器 tab） | ❌ |
| 99 | GitHubPanel 详情 → 时间线 | PR 链接 / Show Timeline 动作回跳 | `GHPRDetailsComponentFactory.kt:107,122-124`（diff→时间线直接回跳未找到直接证据） | ❌ |
| 100 | → GitHubPanel 登录（4 入口） | 克隆对话框 GitHub tab / PR 面板账户选择器 / Settings→GitHub / GitHub 菜单 Settings | `GHCloneDialogExtension.kt:66-86`、`GHRepositoryAndAccountSelectorComponentFactory.kt:59-96`、`GithubSettingsConfigurable.kt:44-53`、`GHOpenSettingsAction.kt:13` | ❌ |
| 101 | 任意处 →（Share Project on GitHub） | Vcs.Import / 主工具栏 Share 按钮 | `GithubShareAction`（github-git xml:16-21） | ❌ |
| 102 | GitLabPanel 列表 → 详情 tab + 时间线 | 双击 MR | `GitLabShowMergeRequestAction.kt:24-25`；`GitLabToolWindowConnectedProjectViewModel.kt:74-90` | ❌ |
| 103 | GitLabPanel → 创建 MR | 面板动作开创建 tab | `GitLabMergeRequestOpenCreateTabAction`（:140-147） | ❌ |
| 104 | 编辑器/项目树 → GitLab Snippet | 右键 Create Snippet | `GitLabCreateSnippetAction`（:162-169） | ❌ |

### D.4 关键联动流程（场景链）

1. **克隆 → 打开**：RepoPage「Get from VCS」→ 克隆对话框（GitHub tab 可选账户登录）→ `ProjectCheckoutListener` 自动打开项目 → 主窗口 Log/Changes。
2. **提交 → 推送 → 被拒闭环**：StatusPage → CommitDialog →（Commit and Push）→ PushDialog → 被拒弹 `GitRejectedPushUpdateDialog`（Merge/Rebase 二选）→ `GitUpdateProcess`（与 Update Project 同引擎）→ 成功后续推。
3. **合并/rebase → 冲突 → 解决 → 继续**：MergeDialog/RebaseDialog → `GitConflictResolver` → ConflictsPanel（自动出现 tab）/ 主工具栏 widget → 3-way 合并视图（双击逐文件）→ 全解决回 StatusPage → continue（widget/Git 菜单 RebaseActions）或 abort。
4. **溯源链路**：编辑器 Annotate → BlameView →（gutter 右键）→ HistoryPanel →（双击）→ DiffPage /（Show Commit in Log）→ LogPage。
5. **变更暂存架**：StatusPage → Shelve → ShelfPanel → Unshelve → StatusPage；StatusPage/LogPage → Create Patch → PatchPanel →（Import into Shelf）→ ShelfPanel /（Apply Patch）→ StatusPage。

### D.5 Rebased 独家导航改动（相对上游，证据见附录 B-5）

1. **Git 上下文菜单上移主菜单**：编辑器右键的 Git 子菜单删去通用仓库动作（`GitRepositoryActions` 被注释移除），避免与已上移的 Git 主菜单重复（backend.xml:305-309）。
2. **分支弹窗顶层移除 Pull/Push**：二者移至主工具栏（Update Project / Push 按钮），弹窗顶层仅保留 Commit / Commit to Stage（backend.xml:519-529 注释明言动机）。
3. **主工具栏 VCS 组位置**：`MainToolbarVCSGroup`（Update Project 首位 + Push）定义于 PlatformActions.xml:1084，配合进行中操作 widget `GitMergeRebaseWidget`（backend.xml:539-541）。

### D.6 rebasedjs 跳转复刻状态汇总

**已实现（3 条活动边，全部在 LogPage 枢纽上）**：

| 边 | 实现方式 |
|----|----------|
| RepoPage → LogPage | 打开仓库成功 `router.push/navigate(/repos/:id)`（`openRepoFlow` 两端同构） |
| LogPage → SettingsPage | 顶栏设置按钮 → `/repos/:id/settings`（`onOpenSettings`，两端工作区接线） |
| SettingsPage → LogPage | "返回日志"按钮（两端工作区接线） |

**半通（1 条）**：LogPage → DiffPage——DiffPage 路由两端存在，但仅手输 `?file=` 可达，LogPage 无任何入口（待 P2-B StatusPage `onOpenDiff` 接通，D.3.2 #13）。

**计划就绪（📋，P2 计划已定形的边）**：LogPage 顶栏入口 ×3（→StatusPage P2-B、→BranchPanel P2-C、→MergeDialog P2-E）；LogPage 右键 →ResetDialog（P2-D，内嵌无路由）；StatusPage→DiffPage / StatusPage→CommitDialog（P2-B）；OperationStatus"去解决冲突"→ConflictsPanel、ConflictsPanel→3-way MergeView、ConflictsPanel"完成合并"→LogPage（P2-E）。

**形态映射差异**（复刻时的等价判定依据）：Java 的多 tab 工具窗口 ↔ rebasedjs 多路由页面（`/repos/:id/<页>`，LogPage 为仓库枢纽页）；Java 模态对话框 ↔ 内嵌 Modal（ResetDialog）或独立路由（SettingsPage）；Java 状态栏 widget / 主工具栏 ↔ LogPage 顶栏按钮 + OperationStatus 操作条；Java Search Everywhere / 编辑器内嵌 Blame 暂无 Web 对应物。

### D.7 汇总

| 口径 | 数量 |
|------|------|
| Java 版导航边（D.3 表收录，含"无独立 UI/直接执行"类） | 104 条（#1–#104） |
| 其中出边最多的页面 | LogPage（出边 15+，仓库视图枢纽）；Git 主菜单承载入边 20+（最大全局入口面） |
| rebasedjs 已复刻 | 3 条（+1 条半通），均为 P1/P2-A 页面范围内的边 |
| rebasedjs 计划就绪 | 10 条（P2-B/C/D/E 计划文档已定形） |
| 经核查不存在的边 | 4 条（LogPage 右键直达 HistoryPanel、分支弹窗直达 LogPage、分支弹窗内 Reset、PR diff→时间线直接回跳）；另有 2 条更正口径：#39「Show Git Log for Command」非写 Console、#54 Unshelve 无自动切 tab 证据 |

> 跳转关系与页面复刻状态（附录 C）正交：页面未复刻不代表边无规划——P2 各计划均以"LogPage 顶栏入口 + 独立路由"模式把新页面接入枢纽，与 Java 版"Git 主菜单 + 工具窗口 tab"的全局入口面形态对应。
