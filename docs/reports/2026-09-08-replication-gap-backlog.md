# Rebased 复刻缺口与开发任务清单

- **日期**：2026-09-08
- **基线**：rebasedjs HEAD `7d9b850`（P2/P3/P4-A/B 全部收官，P4-C e2e 进行中）
- **来源**：`docs/reports/2026-09-03-pages-and-api-audit.md`（盘点报告，其 §四/§五 为逐页/逐边最终状态）
- **口径**：只列**未完全复刻**与**缺失**项；✅ 与 🟡 **等效**功能（CommitDialog 内嵌提交框、QuickActionsMenu 顶栏+更多菜单聚合、各等价导航边等）一律不列；**明确不做**项（已有决策记录）不排任务，单列于 §三 供参考、避免重复讨论。
- **优先级**：P0 半使用接口消化 → P1 repo 域收尾 → P2 各域功能点补齐 → P3 导航边与装饰性 → 工程排期项随批消化。

---

## 一、缺口总览

| 类别 | 缺口 | 对应位置 |
|------|------|----------|
| 半使用接口 | 2（diff/stream 分块渲染、staging/hunks 无 UI） | 盘点报告 §3.3 |
| 未挂端点能力 | 2（`initRepo`、`cloneRepo`） | §3.3 |
| SSE 事件 | 1（`operation.progress` 未实现） | §3.2 |
| 错误码预留 | 4（`CONFLICT`、`HOOK_FAILED`、`STALE_LOCK`、`CANCELLED`） | §3.2 |
| 功能域 | 1（browse 历史快照浏览——2026-09-08 裁定立项轻量复刻，见 §2.9） | §2.1 |
| 页面功能点缺口 | 57 项（分布于 24 个页面） | §四各页 |
| 可选任务（后置） | 1（分支折叠——依赖过滤 UI + PermanentGraph 类缓存） | §2.8 |
| 导航边缺口 | 33 条 ❌ 可做 + 2 条 🟡 直达（#13 LogPage→DiffPage、#21 右键动作直通）；4 条 ❌ 明确不做另列 | §五 |
| 工程排期项 | 11 项（技术债/硬化） | §六 |
| 进行中 | P4-C Playwright e2e | §四 |

---

## 二、任务清单

### 2.1 P0：半使用接口消化（2 项）

| # | 任务 | 现状 | 落点 |
|---|------|------|------|
| 1 | diff/stream 分块渲染接入 Monaco | 页面已订阅（保活/预热），`diff.chunk` 文本未接入渲染 | DiffPage 容器 + `useDiffStream` |
| 2 | hunk 级暂存 UI | `POST /staging/hunks` + `useHunkStaging` 就绪并有测试，无入口 | StatusPage 补丁预览 → 行内 hunk 选择 |

### 2.2 P1：repo 域收尾（init/clone + RepoPage 遗留，7 项）

| # | 任务 | 现状 |
|---|------|------|
| 3 | `POST /api/repos/init` + `POST /api/repos/clone` 端点与 RepoPage 入口 | `initRepo`/`cloneRepo` 服务层实现 + 集成测试就绪，无路由无 UI（克隆表单最小字段 URL+Directory，对齐 `VcsCloneDialog`） |
| 4 | RepoPage 显示名三级回退 | 实测仅目录名一级（`.idea/.name` 级经 spec §2.2 判定无对应概念——维持单级亦需修正组件注释与文档口径） |
| 5 | 路径 `~/` 相对化接线 | `relativeToHome` 有单测；两端容器未注入 `homeDir`，运行时显示绝对路径 |
| 6 | 最近列表上限对齐 | 组件 `MAX_RECENT=50` vs 服务端 `slice(0, 20)`——统一口径 |
| 7 | 最近列表移除动作 | Popconfirm 组件就绪；无删除端点、容器不注入 `onRemove`（需补 `DELETE /api/repos/:id` 或等价端点） |
| 8 | 列表项分支后缀/图标/失效标记 | 装饰性后置 |

### 2.3 P2：各域功能点补齐（按域 50 项）

**LogPage（5）**：分页「加载更多」UI；过滤 UI（author/path，对齐 Java「文本即滤 + 分支过滤弹窗」）；行右键菜单形态（checkout、New Branch/Tag from Commit、Push up to Commit、Open in Browser、Show All Affected、reword/fixup/squash/drop 直通）；Show Git Log for Command；（分支折叠见 §2.8 可选任务）。

**DiffPage（5）**：word diff/同步滚动/折叠/上下文行数 UI 开关；hunk 级应用/回退；三版本对比（本地/暂存/HEAD）；与分支比较（`GitCompareWithBranchAction`）；（分块渲染见 2.1）。

**StatusPage（2）**：三版本对比；（hunk 级见 2.1）。

**CommitDialog 等效面（4）**：amend 历史提交/reword 直通按钮；GPG 签名/commit template 提交链路消费（白名单键已可读写）；CRLF 提示（`GitCrlfDialog`）；commit & push / push up to commit 组合执行器。

**BranchPanel（6）**：最近检出/标签分组与过滤；查找已合并/清理已合并与过时分支；保护分支设置联动；force-push 后修复（`GitForcePushedBranchUpdateAction`）；checkout with rebase；检出文件。

**MergeDialog（1）**：远程分支直接合并（当前仅本地分支 Select）。

**RebaseDialog（2）**：auto-squash/fixup、squash by subject（`GitAutoSquashCommitAction` 等）；skip（continue/abort 已通，skip 未做）。

**StashPanel（2）**：keep index 选项；Unstash As 对话框（改分支/改名单应用，`GitUnstashAsDialog`）。

**TagPanel（2）**：删除远程标签；推送全部标签。

**RemotePanel（1）**：shallow 识别徽标（unshallow 能力已有）。

**PushDialog（2）**：rejected → 自动弹 Update 对话框联动（`GitRejectedPushUpdateDialog` → 更新引擎 → 续推）；force-push 后修复联动。

**UpdateProjectDialog（2）**：更新会话进度/结果汇总（Java 多仓库会话；Web 单仓库模型下至少做单仓库结果面板）；修复跟踪分支（对话框左下 Reset to tracked）。

**BlameView（2）**：Show in History 联动（gutter 语义 → 跳 HistoryPanel）；Show All Affected（受影响提交对话框）。

**HistoryPanel（2）**：双击版本 → DiffPage（from/to 已可达，差入口）；Annotate Revision → BlameView。

**CommittedChangesPanel（1）**：目录树组织变更文件（`FileTree` 基础组件）。

**SearchPanel（1）**：分支快速搜索（Search Everywhere Git tab 语义；Web 无全局宿主，可在页内加分模式）。

**ConflictsPanel（2）**：冲突文件分组（按目录）；skip（continue/abort 已通）。

**PatchPanel（1）**：Import Patches into Shelf（`ImportIntoShelfAction`）。

**ShelfPanel（1）**：Shelve Changes from StatusPage（`ShelveChangesAction` 入口）。

**GitConsole（1）**：输出折叠/按命令分组（`GitConsoleFoldingImpl`）。

**SettingsPage（4）**：git 可执行文件检测/引导（`GitExecutableSelectorPanel`）；GPG/SSH 专属配置对话框（白名单键已可读写，缺对话框形态）；保护分支设置；自动 fetch 设置（或确认以事件推送替代的终稿口径）。

**GitHubPanel / GitLabPanel（2）**：PR/MR 行级 diff 视图（2026-09-08 裁定可行）——Monaco DiffEditor（并排/内联）+ unified diff 行映射 + 行级评论锚点与提交，任务拆解见 2.7。

### 2.4 P3：导航边缺口（33 条可做 + 2 条 🟡 直达，按目标页分组）

> 边号对应盘点报告 §5.3；等效边、明确不做边（#70/#92/#96/#101/#104）不列。

| 目标 | 边 | 缺口摘要 |
|------|----|----------|
| RepoPage | #3 | 欢迎屏 Configure → SettingsPage 入口 |
| LogPage | #4 | 回首页入口（File→Close Project 语义） |
| LogPage | #13 | LogPage → DiffPage 直达入口（现经 StatusPage/Committed 间接） |
| LogPage | #17/#18/#19/#20 | 右键 Push up to Commit / New Branch / New Tag / 分支操作子菜单 |
| LogPage | #21 | reword/fixup/squash/drop 直通按钮（现经交互式变基编辑器） |
| LogPage | #26 | Open in Browser（托管平台链接） |
| LogPage | #39 | Show Git Log for Command |
| LogPage | #63 | 主工具栏式分支下拉（等价物可选） |
| DiffPage | #27 | 多文件 Prev/Next 切换（依赖单文件模型改造） |
| BranchPanel | #10 | Compare with Branch 对比视图 → LogPage |
| BranchPanel | #67/#69 | 弹窗 fetch 按钮；Show Diff with Working Tree |
| BranchPanel | #70 外 | （New Working Tree 明确不做） |
| HistoryPanel | #30/#31 | 双击 → DiffPage；Annotate Revision → BlameView |
| BlameView | #29/#33/#34 | Show in History；Show Diff；Show All Affected |
| StatusPage | #43/#44/#45/#47/#48/#49 | 冲突入口、Create Patch、Shelve、Annotate/History、三版本、Stash Files |
| CommitDialog 等效面 | #50 | commit & push 组合执行器 |
| PatchPanel | #52 | Import Patches into Shelf |
| ShelfPanel | #54 | Unshelve 后跳转/回写联动 |
| StashPanel | #83/#84 | Unstash As；贮藏 Show Diff |
| PushDialog | #91 | rejected → Update 联动闭环 |
| UpdateProjectDialog | #93 | Reset to tracked |
| 面板 → Settings | #8 | GitHub/GitLab 面板内 Settings 菜单入口（现仅无令牌提示卡回边） |

### 2.5 工程排期项（11 项，随批消化）

gitlab checkout Bearer 注入 hardening（真机验证 + core 层改 Basic/PRIVATE-TOKEN）；web-next 空/非法 JSON body 500 与 koa 400 全局评估；createOpen 跨仓库保持打开；worktree 回滚失败包 gitFailure；resolveSubmodulePath 白名单；core vitest `fileParallelism`；unborn HEAD 建补丁/搁置（staged→`git diff --cached`、缺省→两段拼接）；execLogByCwd 仓库级淘汰；面板 key `kind+id`；addIgnore path 字符集收紧；存档名 `.`/`..` 边界统一。

### 2.6 功能域与契约（4 项）

browse（历史快照浏览）：2026-09-08 裁定**立项轻量复刻**（§2.9）；终稿盘点仍以架构 spec §4.2 域表逐行核；`operation.progress` SSE（有进度型长任务 UI 面时实现）；预留错误码 4 个（`CONFLICT`/`HOOK_FAILED`/`STALE_LOCK`/`CANCELLED`）随对应功能落地消费；`initRepo`/`cloneRepo` 端点（同 2.2 #3）。

### 2.7 PR/MR 行级 diff 视图（2026-09-08 新裁定：由「明确不做」改为可排期）

**裁定依据**：Java `GHPRDiffVirtualFile` / `GitLabMergeRequestDiffVirtualFile` 的评审功能集（语法高亮、行号、并排/内联、行级评论锚点、增删统计）可经 Monaco 行级视图功能对等复刻——复用既有 `monaco-diff-view`/`monaco-lazy`（MergeView 已为三编辑器先例）；`GitHubPrFile.patch`/`GitLabMrFile.diff` 已含每文件 unified diff 全文，hunk 头 `@@ -a,b +c,d @@` 自带行号，行映射可解析（GitLab 汇总字段不逐文件给行数不构成阻塞）。不可复刻者仅为 Java 平台编辑器的通用能力（本地搜索/检查集成），不属 PR diff 功能口径。

| # | 任务 | 说明 |
|---|------|------|
| 1 | unified diff 行映射解析器 | unified 文本 → original/modified 两侧全文 + 新侧行号映射（`@@` 头算术）；边界：`\ No newline at end of file`、rename 空 patch、GitHub 大 diff 截断（无标记，按部分渲染）、二进制无 patch；纯函数 + 单测，GitHub/GitLab 共用一个 parser（可放 `packages/client` 或 `@rebased/api` 共享层） |
| 2 | 文件 tab 改为行级视图 | 复用 `monaco-diff-view`：并排（默认）/内联切换、忽略空白；文件列表导航（现状保留 status/增删行徽标） |
| 3 | 行级评论锚点 | 新侧行 → 评论锚定（GitHub inline review comments：`path + line + side`，需新增 `/pulls/:n/review-comments` GET/POST 端点——现有 `comments` 为 issue comment；GitLab discussions：`position[new_line]`，新增 discussions 端点）；glyph margin 图标 + 行点击开评论 + 提交后回写时间线 |
| 4 | 降级路径 | patch 缺失/截断/二进制 → 统计行 + 说明（与 Java 大 diff 受限一致）；rename 无内容变更 → 仅 rename 提示 |

> 完成后盘点报告 C.26/C.27 的 diff 视图行与边 #98 由 🟡 转 ✅（保留 AI 描述、克隆/分享等其余裁定）。

### 2.8 可选任务（低价值后置，1 项）

**分支折叠（LogPage）**——2026-09-08 重新裁定：由「明确不做」改为可选任务。

- **原裁定依据**（组装 spec §3.1:88、A.2:283-284、§1.3:32）：① graph-layout 移植为最小必需集，`PermanentGraph`（提交图缓存）属「缓存与高级视图」层不在首跑范围；② 频率证据——折叠家族高频入口仅「文本即滤 + 分支过滤弹窗」（列为 P2 次优先），分支折叠无高频使用证据；③ 折叠/虚线过滤边依赖 PermanentGraph 类缓存结构。
- **重新裁定理由**：折叠是独立可评估的可视化能力，不应与 PermanentGraph 缓存机制永久绑定定性；待过滤 UI 落地、大仓库图密度成为实际问题后值得重新评估。
- **前置依赖**：① LogPage 过滤 UI（§2.3 LogPage 项，P2 次优先）；② PermanentGraph 类缓存结构或自研等价物（折叠状态存储）。
- **工作量**：中-大（缓存结构移植 + 折叠交互 + 虚线过滤边渲染），单独立项时再估。
- **触发条件**：过滤 UI 落地后、出现大仓库折叠诉求时启动评估。

### 2.9 browse 历史快照浏览（2026-09-08 首次裁定：立项轻量复刻）

**裁定依据**：Java `GitBrowseRepoAtRevisionAction` = 日志右键在指定提交上打开平台 `RepositoryBrowser`——以该提交为根的**只读文件树浏览**（展开目录、打开文件在该版本的内容；虚拟文件 + commit 上下文，不触碰工作区）。Web 复刻成本低-中：核心原语基本齐备（`readFileAtRev` 已被 DiffPage 使用），文件树组件可与 CommittedChangesPanel 目录树任务共享；补全后功能域 36/36。

| # | 任务 | 说明 |
|---|------|------|
| 1 | core `listTreeAtRevision` 原语 | `git ls-tree -r <rev>` 解析（path/类型/子树聚合），薄封装 + 单测 |
| 2 | `api/browse.ts` + `GET /api/repos/:id/browse?rev=` | 返回指定提交的文件树（按目录嵌套或平铺带 path 前缀） |
| 3 | `composite/BrowsePanel` + 路由 `/repos/:id/browse?rev=` | **共享 `FileTree` 基础组件**（与 §2.3 CommittedChangesPanel 目录树任务共用）；目录懒加载 |
| 4 | 文件内容只读查看 | 复用 `readFileAtRev` / 两侧全文路径（`git show <rev>:<file>`）；点文件 → 只读内容视图或 DiffPage from/to 联动 |
| 5 | 入口与导航边 | LogPage 详情面板「浏览快照」按钮（或「更多」菜单）→ 边 #22 由 ❌ 转 ✅（checkout 部分仍经 BranchPanel） |
| 6 | 降级边界 | 二进制文件提示；子模块/符号链接展示为条目不深入 |

> 完成后：功能域 36/36；盘点报告 §2.1 P4 行、边 #22、六.1 同步更新。

---

## 三、明确不做清单（非任务，决策记录）

> 引自盘点报告 §1.3 与各页功能点表，不再排期；新需求出现时可重新决议。

| 项 | 决策理由（简） |
|----|----------------|
| terminal（内置终端） | web 端服务端 shell 安全面大，与 Git 客户端核心价值正交 |
| local-history（本地历史） | 无编辑器宿主；与 LogPage 提交历史重叠 |
| QuickActionsMenu 独立聚合组件 | 顶栏+更多菜单+操作条已等效全覆盖 |
| 克隆/分享项目到 GitHub | `cloneRepo` 能力后置（克隆对话框见 2.2 #3，分享不做） |
| GitHub Gist / GitLab Snippet | 独立对话框域后置 |
| 自托管 GitLab 实例 | 仅 gitlab.com 形态 |
| 托管平台 OAuth/device 专属登录流 | PAT 经 Settings 账户卡片手动录入 |
| PR AI 描述 | 需外部 AI 服务 |
| 打开 worktree 项目 | 无多项目会话模型；经 RepoPage 打开流程可达 |
| Update 流程内子模块更新 | 独立 SubmodulePanel 承载 |
| 分支弹窗 New Working Tree | 入口在「更多」菜单 → 工作树页 |
| 全局 Search Everywhere / 编辑器内嵌 Blame | Web 无宿主，以页面承载 |

---

## 四、进行中

- **P4-C Playwright e2e**：计划 `docs/superpowers/plans/2026-09-03-rebasedjs-p4c-playwright-e2e.md`；`apps/e2e/` 基建与打开仓库冒烟已落地，套件扩展覆盖核心流与工具域全链（github/gitlab 数据面不依赖网络）。
