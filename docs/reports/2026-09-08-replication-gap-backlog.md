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
| 页面功能点缺口 | 15 项（分布于 13 个页面） | §2.2 / §2.3 |
| 导航边缺口 | 8 条 ❌ 可做 + 2 条 🟡 直达（#13 LogPage→DiffPage、#21 右键动作直通）；4 条 ❌ 明确不做另列 | §2.4 |
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

**已落地（完成记录）**：LogPage 分页「加载更多」（limit 阶梯放大 50→500 封顶；过滤/翻页切快照模式——流仅默认视图接入，Ruling 6 同查询约束）与过滤 UI（作者/路径「文本即滤」，Enter/失焦提交；ui log-page 过滤行 +5 单测；两端容器接 useLogPage 查询参数）；行右键菜单形态（检出游离 HEAD / 从此处新建分支·创建后检出 / 从此处新建标签·附注可选 / 在浏览器中打开·GitHub/GitLab 提交页链接 / 摘樱桃·还原·Reset·浏览快照复用面板按钮；ui log-page +5 单测，e2e 实测 detach/newBranch/tag 端点）；BlameView/HistoryPanel 溯源联动（§#29/#30/#31/#33）；PatchPanel Import into Shelf 与 ShelfPanel Unshelve 回边（#52/#54：行内「导入搁置」→ 同样名搁置存补丁全文，成功跳 `/shelves`；restore 后 status 键回写联动——平台 Unshelve 无自动切 tab 证据，Web 等价为 events 刷新）；StatusPage 动作入口五连（#43/#44/#45/#47/#49）；commit & push 组合执行器（#50）；PushDialog rejected→Update 联动（#91）；与分支比较（#10：core `streamLog` 增 `range`（`git log <range>` 语义）+ contracts `logQuerySchema` 增 `range` + client `useLogPage` 增 range 参数与空 repoId→null key 条件拉取；ui `BranchCompareView`（GitCompareBranchesUi 语义——分支独有/当前独有双组卡片，行点击 → ?select=）+ BranchPanel 行内「比较」（当前分支禁用）；两端容器与分支页 onCompare 接线（`?compare=<branch>` → 双 range 查询）；UpdateProjectDialog Reset to tracked（#93：左下「Reset to tracked」（本地分支 → 上游文案）→ Modal.confirm → `reset --hard <upstream>`；无上游不渲染；ui +3 单测）；TagPanel 删除远程标签/推送全部（core `deleteRemoteTag`（push 空 ref）/`pushAllTags`（push --tags）原语 + 契约 `tagActionSchema` 增 `pushAll`/`deleteRemote` 分支 + api 分派（withAuth 认证回路）+ ui 行内「删除远程」与页头「推送全部」（Popconfirm）；core +2、contracts +3、api +3、ui +2 单测）；StashPanel keep index（契约 `stashActionSchema` save 增 `keepIndex` + core `saveStash` 传 `--keep-index` + api 透传 + ui 保存表单「保持暂存区（keep-index）」勾选；api +1、contracts +2、ui +1 单测，实测 --keep-index 暂存区保持）；MergeDialog 远程分支直接合并（ui 分支 Select 两组——本地非当前 / 远程 origin/xxx（远程引用名直接作 merge 参数）；api +1 单测（裸仓库 fetch 后 merge origin/side → success）、ui +1 单测）；SearchPanel 分支快速搜索（Search Everywhere Git tab 语义——ui search-panel「分支快速搜索」卡片（输入即滤本地分支，行点击 → onSelectBranch）+ 两端容器接线（检出并回日志页，quickswitch）；ui +3 单测）；RemotePanel shallow 识别徽标（契约 `RemoteList`/`FetchResult` 增 `shallow`（core `isShallowRepo` 挂 getRemotes/fetch 响应）+ ui 远程卡片顶部「浅克隆（历史截断）」徽标；api +2、ui +1 单测）；GitConsole 输出折叠（`foldArgs` 纯函数——`-c key=value` 对折叠为 `-c …` 占位（GitConsoleFoldingImpl 语义）；ui +2 单测）；ConflictsPanel 冲突文件按目录分组（`groupConflictsByDir` 纯函数——单层子标题分组：根目录/子目录带计数，键排序、组内路径排序；ui +2 单测）；ConflictsPanel skip（core `skipRebase`（git rebase --skip）/`skipPick`（git <kind> --skip）+ api `skipOperation`（merge 无 skip 概念 → INVALID_QUERY）+ `POST /operation/skip` 双端 + client `useSkipOperation` + ui 冲突页底部「跳过」（Popconfirm;仅 rebase/cherry-pick/revert 渲染）；core +1、api +3、client +1、ui +3 单测）。

**LogPage（1）**：Show Git Log for Command；（分支折叠见 §2.9 可选任务）。Show All Affected 已落地——BlameView 行内「受影响」→ 提交全量变更文件 Modal（见 §2.3 完成记录）；Push up to Commit 已落地——行右键 → PushDialog 哈希模式（#17）；reword/fixup/squash/drop 直通已落地——行右键「Reword/Drop/Squash/Fixup Commit」（`POST /commit-edit`，reword 经 Modal 收集新信息 + GIT_EDITOR shim；squash/fixup 并入父提交；根提交无父 → INVALID_QUERY）。

**DiffPage（1）**：与分支比较已落地（分支页行内「比较」→ 日志页 `?compare=` 对比视图——双 range 双向提交差异，对齐 GitCompareBranchesUi 双侧日志；hunk 级应用/回退经 StatusPage 补丁预览 hunk 行内选择为等效通道）。（word diff/同步滚动/折叠/上下文行数与三版本对比已落地——Monaco 内建 + folding/renderWhitespace/hideUnchangedRegions 开关 + 三版本视图）。

**StatusPage（0）**：三版本对比与页级动作五入口（Create Patch from changes / Shelve / Stash Files / Annotate / History）已落地（见完成记录）。

**CommitDialog 等效面（0）**：GPG 签名/commit template 已落地——白名单键 9 键（`commit.gpgsign`/`user.signingkey`/`commit.template`）设置页读写，提交链路原生消费（`git commit` 自动读取：实测 gpgsign=true + 无效 key → 签名失败拒绝、false → 正常提交、template 键置位后 -m 提交不受扰）。（commit & push 组合执行器已落地——提交框「提交并推送」→ `POST /commit/push` commit 先落盘再推当前分支上游，三态提示；amend 历史提交/reword 已落地——提交框「amend 到…」下拉（未发布/非合并非 HEAD 提交，上限 20）→ `POST /commit/amend-specific`：amend! 提交 + `fixup -C` 交互式变基折入目标（目标信息重写/reword、中间提交重放、冲突 → 冲突页流）；CRLF 提示已落地——`GET /commit/crlf-warning`（GitCrlfProblemsDetector 语义：Windows + core.autocrlf 未建议 + 暂存文件 CRLF 无 text/crlf 属性覆盖）→ 提交框内联警告 + 三选 Modal（「修复并提交」`commitBodySchema.crlfFix` 先写 `git config --global core.autocrlf <建议值>` 再提交；「原样提交」/取消）。）

**BranchPanel（4）**：最近检出/标签分组与过滤的剩余分组维度（文本过滤与「仅看已合并」已落地）；保护分支设置联动；checkout with rebase；检出文件（查找已合并/清理已合并已落地——「仅看已合并」开关 +「清理已合并（N）」批量删除；force-push 后修复已落地——当前分支与上游分叉时行内「force-push 修复」：`POST /update/force-pushed` fetch → 本地重置到上游 → @{u}..HEAD 本地独有提交逐一 cherry-pick 重放，冲突 → 冲突页流）。

**MergeDialog（0）**：远程分支直接合并已落地——分支 Select 两组（本地非当前 / 远程 origin/xxx），远程引用名作 merge 参数（服务端核心 git merge 直接解析远程跟踪引用；api +1、ui +1 单测，实测裸仓库 fetch 后 merge origin/side 成功）。

**RebaseDialog（0）**：auto-squash/fixup、squash by subject 已落地——日志行右键「Fixup Commit」「Squash Commit」（`GitCommitFixupBySubjectAction`/`GitCommitSquashBySubjectAction` 语义）：以暂存内容创建 `fixup!/squash! <subject>` 提交 + `rebase -i --autosquash` 折入目标（`POST /autosquash`；squash 经 GIT_EDITOR shim 覆写 `%B`——结果信息=目标原文；无暂存 → INVALID_QUERY；冲突 → 冲突页流）。（skip 已落地——冲突页「跳过」走 `operation/skip`，见 §2.3 完成记录。）

**StashPanel（0）**：keep index 已落地（保存表单「保持暂存区（keep-index）」勾选 → `saveStash --keep-index`）——Unstash As 与贮藏 Show Diff 已落地（行「Unstash As…」Modal（目标本地分支 Select → 检出+apply 不 drop）+「查看差异」Modal（`git stash show -p` 补丁））。

**TagPanel（0）**：删除远程标签（push 空 ref `deleteRemoteTag`）与推送全部标签（`pushAllTags` `push --tags`）已落地——行内「删除远程」+ 页头「推送全部」（均 Popconfirm，走认证回路）。

**RemotePanel（0）**：shallow 识别徽标已落地（契约 `RemoteList`/`FetchResult` 增 `shallow`——core `isShallowRepo` 挂 getRemotes/fetch 响应；ui 远程卡片顶部「浅克隆（历史截断）」徽标；api +2、ui +1 单测；unshallow 能力既有）。

**PushDialog（2）**：rejected → 自动弹 Update 对话框联动（`GitRejectedPushUpdateDialog` → 更新引擎 → 续推）✅ 已落地（容器编排：rejected 记录 pendingPush → 自动开 Update（pushRejected 文案）→ 更新成功续推；conflicts 引导解决；再 rejected 循环）；force-push 后修复联动（待办）。

**UpdateProjectDialog（0）**：更新会话进度/结果汇总已落地——常规更新后对话框保持打开呈现结果面板（fetched 引用数 + pull 状态：updated 已合入 / up-to-date 已最新 / conflicts 引导冲突页；footer 变「关闭」；推送被拒续推流程闭环不展示面板）。（修复跟踪分支 Reset to tracked 已落地——左下「Reset to tracked」→ Modal.confirm → `reset --hard <upstream>`；无上游不渲染。）

**BlameView（1）**：Show All Affected（受影响提交对话框——需专用查询端点）；行内「差异」（父哈希出 blame `parents` 批量解析，根提交 root=1）与「历史」已落地。

**HistoryPanel（0）**：双击 → DiffPage（%P 父哈希，根提交 root=1）与 Annotate Revision → `/blame?rev=`（blame rev 指定版本溯源）已落地（core parents 批量解析 + history %P）。

**CommittedChangesPanel（0）**：目录树组织变更文件已落地——右栏目录树（`buildFileTree` 纯函数：路径分段建目录节点、同级目录排文件前各按名称、文件叶子带状态徽标 + renameFrom、目录缺省展开可折叠（Set 折叠态）；ui +3 单测（纯函数嵌套/排序 + 渲染折叠展开 + 目录内文件点击）；文件点击 → diff 端点回调不变）。

**SearchPanel（0）**：分支快速搜索已落地（Search Everywhere Git tab 语义——页内「分支快速搜索」卡片：输入即滤本地分支，行点击 → 检出并回日志页（quickswitch）；ui +3 单测。全局宿主搜索 ➖ 保持）。

**ConflictsPanel（0）**：skip 已落地——`POST /operation/skip`（core `skipRebase`/`skipPick`：rebase/cherry-pick/revert 冲突时丢弃当前变更继续后续；merge 无 skip 概念 → INVALID_QUERY）+ ui 冲突页底部「跳过」按钮（Popconfirm;仅 rebase/cherry-pick/revert 渲染）。（冲突文件按目录分组已落地——单层子标题分组：根目录/子目录带计数，键排序、组内路径排序（`groupConflictsByDir` 纯函数）。）

**PatchPanel（0）**：Import Patches into Shelf（`ImportIntoShelfAction`）已落地——行内「导入搁置」→ 同样名搁置存补丁全文（无未跟踪伴随），成功后跳 `/shelves`（activateView 语义）；重名 → INVALID_QUERY、补丁不存在 → INVALID_REF。

**ShelfPanel（1）**：Shelve Changes from StatusPage（`ShelveChangesAction` 入口）。（Unshelve 回边已落地：restore 后 status 键回写联动——平台 Unshelve 无自动切 tab 证据，Web 等价为 events 刷新。）

**GitConsole（0）**：输出折叠已落地（`foldArgs` 纯函数——`-c key=value` 对折叠为 `-c …` 占位（GitConsoleFoldingImpl 语义）；ui +2 单测；进度行折叠不适用拉取式列表）。

**SettingsPage（4）**：git 可执行文件检测/引导（`GitExecutableSelectorPanel`）；GPG/SSH 专属配置对话框（白名单键已可读写，缺对话框形态）；保护分支设置；自动 fetch 设置（或确认以事件推送替代的终稿口径）。

**GitHubPanel / GitLabPanel（0）**：行级评论锚点与提交已落地（§2.7 完成记录）。

### 2.4 P3：导航边缺口（8 条可做 + 2 条 🟡 直达，按目标页分组）

> 边号对应盘点报告 §5.3；等效边、明确不做边（#70/#92/#96/#101/#104）不列。

| 目标 | 边 | 缺口摘要 |
|------|----|----------|
| RepoPage | #3 | 欢迎屏 Configure → SettingsPage 入口 |
| LogPage | #4 | 回首页入口（File→Close Project 语义） |
| LogPage | #13 | LogPage → DiffPage 直达入口（现经 StatusPage/Committed 间接） |
| LogPage | #17/#18/#19/#20 | #17 ✅ 已落地（行右键「Push up to Commit」→ PushDialog 哈希模式——refspec `<hash>:<当前分支>`，`POST /push` 增 `hash`；分离头指针/无效哈希显式 400）；#18/#19/#20 待办（PushDialog 既有） |
| LogPage | #21 | reword/fixup/squash/drop 直通按钮（现经交互式变基编辑器） |
| LogPage | #26 | Open in Browser（托管平台链接） |
| LogPage | #39 | Show Git Log for Command |
| LogPage | #63 | 主工具栏式分支下拉（等价物可选） |
| DiffPage | #27 | 多文件 Prev/Next 切换（依赖单文件模型改造） |
| BranchPanel | #10 | ✅ 已落地（行内「比较」→ 日志页 ?compare= 对比视图——双 range 双向提交差异） |
| BranchPanel | #67/#69 | #67 ✅ 已落地（页头「Fetch」按钮——fetch 全部远程，成功后复用事件流验证分支列表）；#69 Show Diff with Working Tree 待办 |
| BranchPanel | #70 外 | （New Working Tree 明确不做） |
| HistoryPanel | #30/#31 | ✅ 已落地（双击 → DiffPage；Annotate Revision → /blame?rev=，见 §2.3 完成记录） |
| BlameView | #29/#33/#34 | #29/#33 ✅ 已落地（行内「历史」「差异」）；#34 ✅ 已落地（Show All Affected：BlameView 行内「受影响」→ 提交全量变更文件 Modal——`GET /commits/:hash` 单提交清单，文件点击 → 该文件 diff（from=父哈希、to=该提交，根提交 root=1）；core `commitFiles` + api `getCommitFiles`（verifyCommitish 预检）+ client `useCommitFiles`（hash 空串 null key）+ ui 受影响 Modal（loading/error/空态/合并提示分派）+ 两端容器接线；core +3、api +2、client +2、ui +4 单测） |
| StatusPage | #43/#44/#45/#47/#48/#49 | #43/#44/#45/#47/#48/#49 ✅ 全部已落地（#43 冲突入口等价=操作条链接+冲突跳转；#44 组级「创建补丁」→ patches paths；#45 页头「搁置」；#47 行内「注解」「历史」→ /blame、/history；#48 行「三版本」；#49 页头「存入贮藏」） |
| CommitDialog 等效面 | #50 | ✅ 已落地（提交框「提交并推送」→ POST /commit/push：commit 先落盘 → push 缺省当前分支上游；Push up to Commit 余项见 #17） |
| PatchPanel | #52 | ✅ 已落地（行内「导入搁置」→ 成功跳 /shelves，见 §2.3 完成记录） |
| ShelfPanel | #54 | ✅ 已落地（restore 后 status 键回写联动；平台 Unshelve 无自动切 tab 证据） |
| StashPanel | #83/#84 | ✅ 已落地（Unstash As Modal + 查看差异 Modal，见 §2.3 完成记录） |
| PushDialog | #91 | ✅ 已落地（rejected → 自动弹 Update「推送被拒 — 更新项目」merge/rebase 二选 → 成功自动续推；再 rejected 循环回 Update；conflicts 引导解决） |
| UpdateProjectDialog | #93 | ✅ 已落地（左下「Reset to tracked」→ Modal.confirm → reset --hard <upstream>；无上游不渲染） |
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
