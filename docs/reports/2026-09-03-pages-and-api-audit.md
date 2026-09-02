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

RepoPage、LogPage、DiffPage、StatusPage（Local Changes + 暂存区）、CommitDialog（模态提交）、ResetDialog（Reset/Undo Commit）、BranchPanel、MergeDialog、RebaseDialog（交互式）、StashPanel、TagPanel、RemotePanel、PushDialog、PullDialog、UpdateProjectDialog、BlameView、HistoryPanel、CommittedChangesPanel、SearchPanel、ConflictsPanel、PatchPanel、ShelfPanel、WorktreePanel、SubmodulePanel、IgnoreDialog、GitHubPanel（PR 列表/详情/时间线/审查）、GitLabPanel、GitConsole、QuickActionsMenu（快捷操作聚合）、SettingsPage。

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

未实现的 27 个页面/面板：StatusPage、CommitDialog、ResetDialog、BranchPanel、MergeDialog、RebaseDialog、StashPanel、TagPanel、RemotePanel、PushDialog、PullDialog、UpdateProjectDialog、BlameView、HistoryPanel、CommittedChangesPanel、SearchPanel、ConflictsPanel、PatchPanel、ShelfPanel、WorktreePanel、SubmodulePanel、IgnoreDialog、GitHubPanel、GitLabPanel、GitConsole、QuickActionsMenu、SettingsPage——全部属于 P2–P4 阶段，与架构 spec §7 的落地顺序一致（当前处于第 5–6 步完成态）。

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
