# Rebased 复刻缺口与开发任务清单

- **日期**：2026-09-08
- **基线**：rebasedjs HEAD `7d9b850`（P2/P3/P4-A/B 全部收官）
- **来源**：`docs/reports/2026-09-03-pages-and-api-audit.md`（盘点报告，其 §四/§五 为逐页/逐边最终状态）
- **口径**：只列**未完全复刻**与**缺失**项；✅ 与 🟡 **等效**功能（CommitDialog 内嵌提交框、QuickActionsMenu 顶栏+更多菜单聚合、各等价导航边等）一律不列；**明确不做**项（已有决策记录）不排任务，单列于 §三 供参考、避免重复讨论。
- **优先级**：P0 半使用接口消化 → P1 repo 域收尾 → P2 各域功能点补齐 → P3 导航边与装饰性 → 工程排期项随批消化。

---

## 一、缺口总览

| 类别 | 缺口 | 任务位置 |
|------|------|----------|
| 半使用接口 | 0（diff/stream 分块渲染、staging/hunks 行内选择均已落地，见 §2.1 完成记录） | §2.1 |
| 未挂端点能力 | 0（`initRepo`/`cloneRepo` 已挂端点，见 §2.2 完成记录） | §2.2 |
| SSE 事件 | 1（`operation.progress` 未实现） | §2.6 |
| 错误码预留 | 4（`CONFLICT`、`HOOK_FAILED`、`STALE_LOCK`、`CANCELLED`） | §2.6 |
| 功能域 | 0（browse 历史快照浏览已落地，见 §2.8 完成记录） | §2.8 |
| 页面功能点缺口 | 40 项（分布于 21 个页面） | §2.2 / §2.3 |
| 导航边缺口 | 32 条 ❌ 可做 + 2 条 🟡 直达（#13 LogPage→DiffPage、#21 右键动作直通）；4 条 ❌ 明确不做另列 | §2.4 |
| 工程排期项 | 11 项（技术债/硬化） | §2.5 |
| 可选任务（后置） | 1（分支折叠——依赖过滤 UI + PermanentGraph 类缓存） | §2.9 |

---

## 二、任务清单

### 2.1 P0：半使用接口消化 —— ✅ 全部完成

#### #1 diff/stream 分块渲染接入 Monaco —— ✅ 已完成

**完成记录**：

| 任务 | 落点 |
|------|------|
| 分块文本接入渲染 | `useDiffStream` 扩 staged/from/to 同参（与全文查询同口径——流是同一查询的渐进渲染，Ruling 6）；新建 ui `base/monaco-text-view.tsx`（Monaco 单编辑器懒加载包装）+ `composite/diff-stream-view.tsx`（language `diff` 只读渐进渲染累积分块文本；connected/error 态呈现）；两端 DiffPage 容器：全文未就绪且流已有文本 → DiffStreamView，全文（FileVersions）到达切换标准并排/行内视图（全文路径不变，spec §4.4）；client 1 新单测 + ui 3 新单测 |

#### #2 hunk 级暂存 UI —— ✅ 已完成

**完成记录**：

| 任务 | 落点 |
|------|------|
| 行内 hunk 选择 | contracts 新增共享切片 `splitPatchHunks`/`patchHunkHeading`（api 服务端 hunk 索引重组与 ui 行内选择**同源切片**，索引编号天然对齐；原 api 局部 splitHunks 删除）；StatusPage 补丁预览按 hunk 渲染：Collapse 每 hunk（勾选 + 序号 + `@@` 上下文标题 + 折叠正文），顶栏动作按预览取数模式分流（工作区视图→暂存选中/放弃选中 Popconfirm；已暂存视图→取消暂存选中）；`previewStaged`/`onHunkStaging`/`hunkActing` props 驱动；两端容器接 `useHunkStaging`（hook 回写 status 缓存 + 失效重取 patch）；契约 5 单测 + ui 6 单测 + api 既有 3 用例回归 |

### 2.2 P1：repo 域收尾（init/clone + RepoPage 遗留）——✅ 已完成

**完成记录**（随批落地，含单测 / UI 测试 / 端点测试）：

| # | 任务 | 落点 |
|---|------|------|
| 3 | `POST /api/repos/init` + `POST /api/repos/clone` 端点与 RepoPage 入口 | 契约 `initRepoBodySchema`/`cloneRepoBodySchema`；api 复用既有 `initRepo`/`cloneRepo`（无需新函数）；web-next/web-koa 双端点；RepoPage 克隆 Modal（URL+Directory 双必填，对齐 `VcsCloneDialog` 最小字段集）+ 初始化 Modal（路径必填）；两端容器经 `repoMutationFlow`（open-repo-flow 通用化）入库 → 刷新列表 → 跳日志页 |
| 4 | RepoPage 显示名口径 | 维持单级（目录名）为定案，修正组件注释与盘点报告 §4.1 表述（`.idea/.name` 依 spec §2.2 无对应概念） |
| 5 | 路径 `~/` 相对化接线 | 新增 `GET /api/app/home-dir`（`getAppHomeDir`）+ `useAppHomeDir`；两端容器注入 `homeDir` |
| 6 | 最近列表上限对齐 | 服务端 `RECENT_LIMIT = 50`（原 `slice(0, 20)`），与组件 `MAX_RECENT=50` 同口径；单测锁定 60 条配置 → 返回 50 |
| 7 | 最近列表移除动作 | `removeRepo`（幂等；同清 `recentRepoIds` 与该仓库 changelists 簿记）+ `DELETE /api/repos/:id` + `useRemoveRepo`（SWR mutation key 占位、URL 经 arg 拼装）；容器注 `onRemove` → Popconfirm → mutate 刷新 |
| 8 | 列表项分支后缀/图标/失效标记 | ❌ 装饰性后置（保留） |

### 2.3 P2：各域功能点补齐（按域 48 项）

**已落地（完成记录）**：LogPage 分页「加载更多」（limit 阶梯放大 50→500 封顶；过滤/翻页切快照模式——流仅默认视图接入，Ruling 6 同查询约束）与过滤 UI（作者/路径「文本即滤」，Enter/失焦提交；ui log-page 过滤行 +5 单测；两端容器接 useLogPage 查询参数）；行右键菜单形态（检出游离 HEAD / 从此处新建分支·创建后检出 / 从此处新建标签·附注可选 / 在浏览器中打开·GitHub/GitLab 提交页链接 / 摘樱桃·还原·Reset·浏览快照复用面板按钮；ui log-page +5 单测，e2e 实测 detach/newBranch/tag 端点）。

**LogPage（2）**：行右键余项（Push up to Commit、Show All Affected、reword/fixup/squash/drop 直通）；Show Git Log for Command；（分支折叠见 §2.9 可选任务）。

**DiffPage（2）**：hunk 级应用/回退（`GitStageDiffAction`）；与分支比较（`GitCompareWithBranchAction`）；（word diff/同步滚动/折叠/上下文行数与三版本对比已落地——Monaco 内建 + folding/renderWhitespace/hideUnchangedRegions 开关 + 三版本视图）。

**StatusPage（0）**：三版本对比已落地（行「三版本」按钮 → `/diff?three=1`，见 DiffPage 完成记录）。

**CommitDialog 等效面（4）**：amend 历史提交/reword 直通按钮；GPG 签名/commit template 提交链路消费（白名单键已可读写）；CRLF 提示（`GitCrlfDialog`）；commit & push / push up to commit 组合执行器。

**BranchPanel（5）**：最近检出/标签分组与过滤的剩余分组维度（文本过滤与「仅看已合并」已落地）；保护分支设置联动；force-push 后修复（`GitForcePushedBranchUpdateAction`）；checkout with rebase；检出文件（查找已合并/清理已合并已落地——「仅看已合并」开关 +「清理已合并（N）」批量删除）。

**MergeDialog（1）**：远程分支直接合并（当前仅本地分支 Select）。

**RebaseDialog（2）**：auto-squash/fixup、squash by subject（`GitAutoSquashCommitAction` 等）；skip（continue/abort 已通，skip 未做）。

**StashPanel（1）**：keep index 选项（save 未提供 `--keep-index` 旗标——Unstash As 与贮藏 Show Diff 已落地：行「Unstash As…」Modal（目标本地分支 Select → 检出+apply 不 drop）+「查看差异」Modal（`git stash show -p` 补丁））。

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

**GitHubPanel / GitLabPanel（0）**：行级评论锚点与提交已落地（§2.7 完成记录）。

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
| StashPanel | #83/#84 | ✅ 已落地（Unstash As Modal + 查看差异 Modal，见 §2.3 完成记录） |
| PushDialog | #91 | rejected → Update 联动闭环 |
| UpdateProjectDialog | #93 | Reset to tracked |
| 面板 → Settings | #8 | GitHub/GitLab 面板内 Settings 菜单入口（现仅无令牌提示卡回边） |

### 2.5 工程排期项（11 项，随批消化）

gitlab checkout Bearer 注入 hardening（真机验证 + core 层改 Basic/PRIVATE-TOKEN）；web-next 空/非法 JSON body 500 与 koa 400 全局评估；createOpen 跨仓库保持打开；worktree 回滚失败包 gitFailure；resolveSubmodulePath 白名单；core vitest `fileParallelism`；unborn HEAD 建补丁/搁置（staged→`git diff --cached`、缺省→两段拼接）；execLogByCwd 仓库级淘汰；面板 key `kind+id`；addIgnore path 字符集收紧；存档名 `.`/`..` 边界统一。

### 2.6 功能域与契约（3 项）

browse（历史快照浏览）：✅ 已完成（§2.8 完成记录）；`initRepo`/`cloneRepo` 端点：✅ 已完成（§2.2 完成记录）；终稿盘点仍以架构 spec §4.2 域表逐行核；`operation.progress` SSE（有进度型长任务 UI 面时实现）；预留错误码 4 个（`CONFLICT`/`HOOK_FAILED`/`STALE_LOCK`/`CANCELLED`）随对应功能落地消费。

### 2.7 PR/MR 行级 diff 视图（2026-09-08 新裁定：由「明确不做」改为可排期）——✅ 全部完成

**裁定依据**：Java `GHPRDiffVirtualFile` / `GitLabMergeRequestDiffVirtualFile` 的评审功能集（语法高亮、行号、并排/内联、行级评论锚点、增删统计）可经 Monaco 行级视图功能对等复刻——复用既有 `monaco-diff-view`/`monaco-lazy`（MergeView 已为三编辑器先例）；`GitHubPrFile.patch`/`GitLabMrFile.diff` 已含每文件 unified diff 全文，hunk 头 `@@ -a,b +c,d @@` 自带行号，行映射可解析（GitLab 汇总字段不逐文件给行数不构成阻塞）。不可复刻者仅为 Java 平台编辑器的通用能力（本地搜索/检查集成），不属 PR diff 功能口径。

| # | 任务 | 状态 |
|---|------|------|
| 1 | unified diff 行映射解析器 | ✅ contracts `parseUnifiedDiff`/`parseHunkHeader`/`hunkSides`（@@ 头算术两侧行号游标；`\ No newline` → no-newline 行；新建/删除文件 `-0,0`/`+0,0`；hunk 外容错按部分渲染；纯函数 9 单测） |
| 2 | 文件 tab 改为行级视图 | ✅ ui `domain/hunk-diff-view.tsx`（逐 hunk 两侧 MonacoDiffView：绝对行号头行 + 上下文标题、块高自适应；GitHub/GitLab 共用、loader 注入）；两面板 FileRow 由 patch 文本预览升级为「查看差异」行级视图（保留 status/增删行徽标）；两端面板测试以 stub loader 覆盖 |
| 3 | 行级评论锚点 | ✅ 端点 GET/POST `/pulls/:n/review-comments`（GitHub：path+line+side，line 兜底 original_line）与 `/mrs/:iid/discussions`（GitLab：position{new_path,new_line} 投递）；契约 GitHubReviewComment(s)/GitLabDiscussionNote(s) + `githubReviewCommentBodySchema`/`gitlabDiscussionBodySchema`；hooks `useGithubPrReviewComments`/`useAddGithubPrReviewComment`/`useGitlabDiscussions`/`useAddGitlabDiscussion`（显式回写键）；ui HunkDiffView 线程：按 hunk 新侧范围挂靠 + 新侧行号 Select + 输入 + 发送（提交后列表刷新）；两端容器接线（刷新联动）；api 4 单测 + client 5 单测 + ui 4 单测（线程/发射/降级） |
| 4 | 降级路径 | ✅ 0 hunk 按 status 分流：renamed → 仅重命名提示；其余 → 二进制/超限截断提示；截断按部分渲染（解析出多少显示多少） |

> 盘点报告 4.26/4.27 的 diff 视图行与边 #98 均已转 ✅（保留 AI 描述、克隆/分享等其余裁定）。

### 2.8 browse 历史快照浏览（2026-09-08 首次裁定：立项轻量复刻）——✅ 已完成

**裁定依据**（保留）：Java `GitBrowseRepoAtRevisionAction` = 日志右键在指定提交上打开平台 `RepositoryBrowser`——以该提交为根的**只读文件树浏览**（展开目录、打开文件在该版本的内容；虚拟文件 + commit 上下文，不触碰工作区）。Web 复刻成本低-中：核心原语基本齐备（`readFileAtRev` 已被 DiffPage 使用），文件树组件与 CommittedChangesPanel 目录树任务共享；补全后功能域 36/36。

**完成记录**（随批落地，含单测 / UI 测试）：

| # | 任务 | 落点 |
|---|------|------|
| 1 | core `listTreeAtRevision` 原语 | `packages/server/core/src/tree.ts`：`git ls-tree -r -z <rev>` 解析（mode/type/hash/path，NUL 分隔）；单测 4 例（解析/嵌套+gitlink/空提交/无效 rev） |
| 2 | `api/browse.ts` + `GET /api/repos/:id/browse?rev=` | `getBrowseTree`（`verifyCommitish` 预检 → `INVALID_REF`）+ `getBrowseContent`（路径越界 → `INVALID_QUERY`；版本内不存在 → `INVALID_REF`；含 NUL → binary 标记）；单测 7 例 |
| 3 | `composite/BrowsePanel` + 路由 `/repos/:id/browse?rev=` | `base/file-tree.tsx`（antd Tree 受控选择包装：目录行点击=展开/收起、叶子=onSelect）+ `domain/directory-tree.ts`（平铺路径 → 嵌套树纯函数，目录在前字母序，与 CommittedChangesPanel 目录树共用）；`composite/browse-panel.tsx`（左树右内容，子模块/符号链接徽标、二进制提示、空/加载/错误态）；两端路由与页面容器（web-next 22 子路由 / web-koa 22 文件） |
| 4 | 文件内容只读查看 | 复用 `readFileAtRev`（`git show <rev>:<file>`），`GET /api/repos/:id/browse/content?rev=&file=`；UI 测试 9 例（含目录点击不选文件） |
| 5 | 入口与导航边 | LogPage 提交详情面板「浏览快照」按钮（`onBrowse` 回调链：ui → 两端容器 → `/browse?rev=<hash>`）；边 #22 浏览部分转 ✅ |
| 6 | 降级边界 | 二进制（NUL 检测）提示；子模块/符号链接展示为条目不深入（不可选中）；空版本空态；无效版本显式报错 |

> 完成后：功能域 36/36（盘点报告 §2.1 P4 行、§4.31 BrowsePanel、边 #22、§六 已同步更新）。

### 2.9 可选任务（低价值后置，1 项）

**分支折叠（LogPage）**——2026-09-08 重新裁定：由「明确不做」改为可选任务。

- **原裁定依据**（组装 spec §3.1:88、A.2:283-284、§1.3:32）：① graph-layout 移植为最小必需集，`PermanentGraph`（提交图缓存）属「缓存与高级视图」层不在首跑范围；② 频率证据——折叠家族高频入口仅「文本即滤 + 分支过滤弹窗」（列为 P2 次优先），分支折叠无高频使用证据；③ 折叠/虚线过滤边依赖 PermanentGraph 类缓存结构。
- **重新裁定理由**：折叠是独立可评估的可视化能力，不应与 PermanentGraph 缓存机制永久绑定定性；待过滤 UI 落地、大仓库图密度成为实际问题后值得重新评估。
- **前置依赖**：① LogPage 过滤 UI —— 已落地（§2.3 完成记录，2026-09-08）；② PermanentGraph 类缓存结构或自研等价物（折叠状态存储）—— 未动。
- **工作量**：中-大（缓存结构移植 + 折叠交互 + 虚线过滤边渲染），单独立项时再估。
- **触发条件**：大仓库折叠诉求出现时启动评估（过滤 UI 前置已落地，仅剩缓存结构项）。

---

## 三、明确不做清单（非任务，决策记录）

> 引自盘点报告 §1.3 与各页功能点表，不再排期；新需求出现时可重新决议。

| 项 | 决策理由（简） |
|----|----------------|
| terminal（内置终端） | web 端服务端 shell 安全面大，与 Git 客户端核心价值正交 |
| local-history（本地历史） | 无编辑器宿主；与 LogPage 提交历史重叠 |
| QuickActionsMenu 独立聚合组件 | 顶栏+更多菜单+操作条已等效全覆盖 |
| 克隆/分享项目到 GitHub | 克隆对话框已落地（见 §2.2 完成记录）；分享不做 |
| GitHub Gist / GitLab Snippet | 独立对话框域后置 |
| 自托管 GitLab 实例 | 仅 gitlab.com 形态 |
| 托管平台 OAuth/device 专属登录流 | PAT 经 Settings 账户卡片手动录入 |
| PR AI 描述 | 需外部 AI 服务 |
| 打开 worktree 项目 | 无多项目会话模型；经 RepoPage 打开流程可达 |
| Update 流程内子模块更新 | 独立 SubmodulePanel 承载 |
| 分支弹窗 New Working Tree | 入口在「更多」菜单 → 工作树页 |
| 全局 Search Everywhere / 编辑器内嵌 Blame | Web 无宿主，以页面承载 |
