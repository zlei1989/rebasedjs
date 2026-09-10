# Rebased.js E2E 冒烟测试参照（MCP 模拟人工操作）

- **日期**：2026-09-10（功能矩阵定稿；执行结果按轮次回填，R1 已回填）
- **文档定位**：冒烟测试**参照文档**——先定义功能矩阵，执行后逐行回填结果，不得在本文件外另行扩展口径
- **范围**：`docs/pages-and-api-audit.md` §二/§四 全量（31 页面 / 36 功能域 → 功能点矩阵 **159 个测试行 + 11 个排除行**；terminal、local-history 2 个全域不做项无对应页面）
- **基准**：功能对齐 Java 版 Rebased（`D:\zhanglei1120\Github\rebased`）；终态口径以 `docs/pages-and-api-audit.md`（2026-09-21 终核版）为准
- **方式**：用 MCP（Playwright MCP 工具集）**模拟人工操作**在真实浏览器中按真实用户路径逐项冒烟——打开页面、点击、输入、弹窗、导航全走 UI；页面展示与仓库事实用 `git` CLI 互证（AGENT.md §冒烟测试口径）
- **应用**：web-next（http://localhost:3030）为默认被测端；web-koa（API :3031 + SPA :5173）按需对等抽查
- **截图**：每功能点至少 1 张**最终正确效果图**，保存至 `docs/shots/`，命名 `<页面slug>-<NN>.png`（过程图 `<页面slug>-<NN>b.png`）；排除行不截图；主题/响应式抽查另存 `theme-*.png`、`responsive-*.png`
- **互证**：写操作（提交/变基/合并/检出/推送等）必须用 pwsh 执行 `git` CLI 复核仓库事实后才可判 ✅

---

## 一、冒烟方法说明（执行前必读）

### 1.1 MCP 工具 ↔ 人工动作映射

| 人工动作 | MCP 工具 | 用法说明 |
|----------|----------|----------|
| 打开页面 / 跳转 | `browser_navigate` / `browser_tabs` | 直达路由 URL；应用内导航必须点击真实按钮，不得 URL 直达绕过入口验证 |
| 肉眼定位元素 | `browser_snapshot` / `browser_find` | 先取页面快照拿到元素 ref，再操作 |
| 点击 / 双击 / 右键 | `browser_click` | 双击 `doubleClick:true`；右键 `button:'right'` |
| 输入 / 表单 / 下拉 | `browser_type` / `browser_fill_form` / `browser_select_option` | 提交表单 `submit:true` |
| 键盘 | `browser_press_key` | Enter / Esc 等 |
| 等待 | `browser_wait_for` | 等文案出现/消失（SSE 实时更新行必等，不可仅 sleep） |
| 断言 / 读状态 | `browser_evaluate` | 校验 DOM 文本、行数、class 等 |
| 截图 | `browser_take_screenshot` | `filename` 直接落到 `docs/shots/<页面slug>-<NN>.png` |
| 控制台 / 网络核证 | `browser_console_messages` / `browser_network_requests` | 报错与 API 载荷核证 |
| CLI 互证 | pwsh → `git -C <冒烟仓> status/log/branch/stash/tag/worktree/remote` | 页面展示与仓库事实互证 |

### 1.2 判定口径

- **✅**：界面达到该行「预期最终正确效果」列描述的状态 + CLI 互证一致 + 截图已存 `docs/shots/` 对应文件——三者缺一不可
- **❌**：任一不满足——记根因与复现路径到 §五 执行记录（缺陷登记）
- **跳过 + 理由**：环境不具备（外部依赖：GitHub/GitLab 真实远端+令牌、gpg、Windows CRLF 等），必须在结果列写理由
- **每行一张最终正确效果图**：截图时机 = 该行全部操作步骤完成后的最终状态；过程态用 `<NN>b.png` 附加

### 1.3 冒烟仓构造与复位（一次性准备，每轮冒烟前复位）

| 冒烟仓 | 用途 | 构造要点（CLI） |
|--------|------|----------------|
| `D:\zhanglei1120\Github\rebased-smoke` | 主冒烟仓（绝大多数行） | 初始化 + user 身份 → 8 提交历史（含 1 个 merge 合并提交）→ 分支 `feature` → 标签 `v1.0` → 工作区修改 + 已暂存文件 + 未跟踪文件 → stash ×2（其一含未跟踪）→ 本地裸仓 `smoke-remote` 作 origin（master/feature 已 push，本地领先 1 提交以测 outgoing 徽标）→ 子模块指向本地仓 → 预置 1 个 worktree |
| `rebased-smoke-conflict` | 冲突流程（合并/变基/冲突页） | master 与 feature 对同一文件同区域修改 → merge 冲突待解决 |
| `rebased-smoke-big` | 分页/虚拟滚动/大 diff 流 | 脚本生成 300+ 提交单分支 + 1 个大文件（500+ 行变更） |
| `rebased-smoke-shallow` | shallow 徽标 | 浅克隆（`--depth 1`）自 smoke-remote |
| 分叉场景（主仓内构造） | rejected push 联动、force-push 修复 | 远端分支与本地分支同源分叉（本地与远端各领先 ≥1 提交） |
| GitHub/GitLab | 检测门/降级卡 | 无真实远端仓 → 冒烟至「检测门 + 无令牌提示卡」为止；完整 PR/MR 流程行（F-136~F-139、F-141~F-144）在具备真实远端+令牌时执行，否则跳过+理由 |

**复位**：写操作行有副作用（提交/变基/合并/检出/删除等）。执行顺序按矩阵编号（先读后写）；每轮冒烟开始前用 CLI 复位主仓（`git reset --hard origin/master` + 清 stash/tag/worktree/子模块，或整体重建脚本）。冲突仓每次重新构造。

### 1.4 执行流程（单轮冒烟）

1. `pnpm dev` 起服务（web-next :3030 / web-koa :3031），浏览器打开 `http://localhost:3030/`；
2. CLI 复位/构造冒烟仓；
3. 按矩阵逐行执行：入口 → 模拟人工步骤 → 等待 → 截图（最终正确效果）→ CLI 互证；
4. 每行回填「结果」列（✅/❌/跳过+理由）；❌ 行登记 §五 执行记录；
5. 一轮结束更新 §二 总览表状态；全部 ✅ 后关闭记录。

---

## 二、功能矩阵总览（31 页面）

> 行数 = 测试行（含跳过候补）；排除行见 §三。所有状态初始为「待测」。

| # | 页面 | 阶段 | 路由/承载 | 模拟入口（一步到达） | 测试行 | 截图前缀 | 状态 |
|---|------|------|-----------|----------------------|--------|----------|------|
| 1 | RepoPage | P1 | `/` | 浏览器打开 :3030 首页 | F-001~F-008（8） | repo-page | ✅ 8/8 |
| 2 | LogPage | P1 | `/repos/:id` | RepoPage 打开冒烟仓 | F-009~F-028（20） | log-page | ✅ 19/20（F-025 跳过） |
| 3 | DiffPage | P1 | `/repos/:id/diff` | StatusPage 双击变更文件 | F-029~F-038（10） | diff-page | ✅ 10/10 |
| 4 | StatusPage | P2 | `/repos/:id/status` | 顶栏「状态」 | F-039~F-051（13） | status-page | ✅ 13/13 |
| 5 | CommitDialog（等效内嵌提交框） | P2 | StatusPage 内 | StatusPage 提交框 | F-052~F-058（7） | commit | ✅ 7/7（F-056 的 gpg 分支跳过） |
| 6 | ResetDialog（内嵌模态） | P2 | LogPage 内 | 详情面板「Reset 到此处」 | F-059~F-061（3） | reset | ✅ 3/3 |
| 7 | BranchPanel | P2 | `/repos/:id/branches` | 顶栏「分支」 | F-062~F-072（11） | branch | 🚧 7/11 |
| 8 | MergeDialog（页面化） | P2 | `/repos/:id/merge` | 顶栏「合并」 | F-073~F-075（3） | merge | 待测 |
| 9 | RebaseDialog（内嵌模态） | P3 | LogPage 内 | 更多「变基」 | F-076~F-080（5） | rebase | 待测 |
| 10 | StashPanel | P2 | `/repos/:id/stashes` | 顶栏「贮藏」 | F-081~F-085（5） | stash | 待测 |
| 11 | TagPanel | P3 | `/repos/:id/tags` | 更多「标签」 | F-086~F-088（3） | tag | 待测 |
| 12 | RemotePanel | P3 | `/repos/:id/remotes` | 更多「远程管理」 | F-089~F-092（4） | remote | 待测 |
| 13 | PushDialog（内嵌模态） | P3 | LogPage 内 | 更多「推送」 | F-093~F-095（3） | push | 待测 |
| 14 | PullDialog（内嵌模态） | P3 | LogPage 内 | 更多「拉取」 | F-096~F-097（2） | pull | 待测 |
| 15 | UpdateProjectDialog（内嵌模态） | P3 | LogPage 内 | 更多「更新项目」 | F-098~F-100（3） | update | 待测 |
| 16 | BlameView | P3 | `/repos/:id/blame` | 更多「溯源」→ 页内输路径 | F-101~F-104（4） | blame | 待测 |
| 17 | HistoryPanel | P3 | `/repos/:id/history` | 更多「历史」→ 页内输路径 | F-105~F-107（3） | history | 待测 |
| 18 | CommittedChangesPanel | P3 | `/repos/:id/committed` | 更多「已提交」 | F-108~F-110（3） | committed | 待测 |
| 19 | SearchPanel | P3 | `/repos/:id/search` | 更多「搜索」 | F-111~F-113（3） | search | 待测 |
| 20 | ConflictsPanel | P2 | `/repos/:id/conflicts` | 制造冲突自动跳入 / 操作条「去解决冲突」 | F-114~F-119（6） | conflicts | 待测 |
| 21 | PatchPanel | P3 | `/repos/:id/patches` | 更多「补丁」 | F-120~F-123（4） | patch | 待测 |
| 22 | ShelfPanel | P3 | `/repos/:id/shelves` | 更多「搁置」 | F-124~F-126（3） | shelf | 待测 |
| 23 | WorktreePanel | P4 | `/repos/:id/worktrees` | 更多「工作树」 | F-127~F-129（3） | worktree | 待测 |
| 24 | SubmodulePanel | P4 | `/repos/:id/submodules` | 更多「子模块」 | F-130~F-131（2） | submodule | 待测 |
| 25 | IgnoreDialog | P3 | `/repos/:id/ignore` | 更多「忽略」 | F-132~F-133（2） | ignore | 待测 |
| 26 | GitHubPanel | P3 | `/repos/:id/github` | 更多「GitHub」（github.com 远程才渲染） | F-134~F-139（6） | github | 待测 |
| 27 | GitLabPanel | P4 | `/repos/:id/gitlab` | 更多「GitLab」（gitlab.com 远程才渲染） | F-140~F-144（5） | gitlab | 待测 |
| 28 | GitConsole | P3 | `/repos/:id/console` | 更多「控制台」 | F-145~F-146（2） | console | 待测 |
| 29 | QuickActionsMenu（等效聚合） | P2+ | 顶栏 5 按钮 + 更多菜单 18 项 | 顶栏按钮区 | F-147~F-148（2） | quick-actions | 待测 |
| 30 | SettingsPage | P1/P2 | `/repos/:id/settings` | 顶栏「设置」 | F-149~F-155（7） | settings | 待测 |
| 31 | BrowsePanel | P4 | `/repos/:id/browse?rev=` | 详情面板「浏览快照」 | F-156~F-159（4） | browse | 待测 |

---

## 三、不测清单（排除行：11 + 全域 2）

> 依据 `docs/pages-and-api-audit.md` §1.3 / §四 / §5.3；排除行不截图、不执行，理由回填本表即可。

| # | 页面 | 功能点 | 状态 | 排除理由（审计出处） |
|---|------|--------|------|----------------------|
| E-01 | RepoPage | 列表项分支后缀/图标/失效标记 | ❌ 装饰性后置 | 不计功能缺口（§4.1、§7.2 #8） |
| E-02 | LogPage | 分支折叠 / PermanentGraph 高级视图 | ⏸ 可选后置 | 触发条件出现时单独立项（§4.2、§7.9） |
| E-03 | LogPage | 新标签页打开 log、为命令过滤的 log | ➖ 无对应 | internal 动作，非用户可达入口（§5.3.2 #39） |
| E-04 | BranchPanel | 保护分支面板 UI | ➖ 无对应 | Java 亦无面板 UI，Web 以设置 + 编辑拦截承载（§4.7、§4.30） |
| E-05 | WorktreePanel | 打开 worktree 项目 | ❌ 明确不做 | 无多项目会话模型（§1.3） |
| E-06 | SubmodulePanel | Update 流程内子模块更新 | ➖ 明确不做 | 独立 SubmodulePanel 承载（§1.3） |
| E-07 | SearchPanel | Search Everywhere 式全局搜索 | ➖ 无对应 | Web 无全局宿主，页内分支快速搜索等效（§4.19） |
| E-08 | GitHubPanel | 克隆/分享到 GitHub、Gist、PR AI 描述 | ❌ 明确不做 | §1.3、§4.26 |
| E-09 | GitLabPanel | Snippet、自托管 GitLab 实例 | ❌ 明确不做 | §1.3、§4.27 |
| E-10 | SettingsPage | SSH 专属配置对话框 | ➖ 无对应 | Java 当前版本无 SSH 专属配置面（§4.30） |
| E-11 | SettingsPage | 自动 fetch 设置 | ➖ 无对应 | Web 以 SSE 事件推送替代定时 fetch（§4.30） |
| — | 全域 | terminal、local-history | ❌ 明确不做 | 无对应页面（§1.3） |

---

## 四、逐页功能点矩阵（159 行）

> 执行规则：每行按「MCP 冒烟操作」列顺序操作，达到「预期最终正确效果」后截图到「截图」列指定文件，再 CLI 互证，最后回填「结果」。列内「（CLI）」= 必须 pwsh `git` 复核互证。

### 4.1 RepoPage（slug `repo-page`；P1）

- **入口**：`browser_navigate` → `http://localhost:3030/`（web-koa 对等抽查用 :5173）。
- **前置**：冒烟仓 `rebased-smoke` 已注册；另备一个非 git 目录（坏路径）、一个空目录、裸仓 `smoke-remote` 本地路径。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-001 | 打开路径表单（校验→验证→注册→跳日志页） | 输入非 git 目录路径 → 点「打开」→ 观察 toast；再输入 `D:\zhanglei1120\Github\rebased-smoke` → 「打开」 | 坏路径 → 红 toast「不是 git 仓库：…」；好路径 → 跳 `/repos/:id` 日志页 | ✅ | repo-page-01.png（坏路径 toast）、repo-page-01b.png（成功跳日志页） |
| F-002 | 最近列表（打开即注册/同路径复用/最近优先） | 首页看列表 → 移除冒烟仓 → 重新打开 → 回首页 → 再次打开同路径 | 列表出现冒烟仓且置顶；同路径再次打开不新增重复行（id 复用）（CLI） | ✅ | repo-page-02.png |
| F-003 | 显示名（定案单级） | 注册时观察列表项显示名 | 显示名为目录名 `rebased-smoke`（单级，非三级回退） | ✅ | repo-page-03.png |
| F-004 | 路径副文本 `~/` 相对化 | 观察列表项副文本 | 副文本显示 `~/Github/rebased-smoke`（homeDir 注入） | ✅ | repo-page-04.png |
| F-005 | 列表上限 50 | 列表正常渲染；上限逻辑引服务端 `RECENT_LIMIT=50` 单测证据（不构造 50+ 仓） | 列表渲染正常、无报错；上限口径 = 50 | ✅ | repo-page-05.png |
| F-006 | 移除动作 + Popconfirm | 行内移除按钮 → Popconfirm 确认 | 行从列表消失、无报错；再次打开可重新注册（CLI） | ✅ | repo-page-06.png |
| F-007 | 克隆对话框（URL + Directory） | 「克隆」→ Modal → 输入裸仓路径作 URL + 目标目录 → 克隆 | Modal 字段最小集；成功 → 列表新增该仓 + 跳日志页（CLI 目标目录为 git 仓） | ✅ | repo-page-07.png（modal 填写过程图 repo-page-07b.png） |
| F-008 | 初始化仓库入口 | 「初始化」→ Modal → 输入新目录 → 初始化 | 成功 → 跳日志页（空仓 unborn HEAD；CLI `git status` 互证） | ✅ | repo-page-08.png |

### 4.2 LogPage（slug `log-page`；P1，仓库枢纽页）

- **入口**：RepoPage 打开 `rebased-smoke`（分页/滚动行用 `rebased-smoke-big`）。
- **前置**：主仓 8 提交含 1 合并提交、master/feature 分支、tag v1.0、本地领先 origin 1 提交。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-009 | 提交图真图渲染（lane/边路由） | 打开主仓日志页 → 观察 8 提交含合并 | 图列在合并处正确岔开/合拢，无重叠错位 | ✅ | log-page-01.png |
| F-010 | 分支着色（ref 名 hash → HSB 色板） | 观察 ref chips 颜色 | chips 颜色按分支名稳定着色（与测试断言口径一致） | ✅ | log-page-02.png（分支 chip 底色 = colorForRef(分支名)，与图车道同源；R1 修复项 D-06） |
| F-011 | 虚拟滚动（固定行高窗口渲染） | 打开 `rebased-smoke-big` → 连续滚动 | 滚动流畅、行高 24 一致、无整页白屏 | ✅ | log-page-03.png |
| F-012 | 首屏快照 + SSE 增量渲染 + hash 去重 | 打开日志页 → pwsh 在主仓追加 1 提交 → 等待 | 新提交行自动出现在顶部，无需刷新（CLI 互证新 hash） | ✅ | log-page-04.png |
| F-013 | 取消链路（断开即杀 git 进程） | 打开 `rebased-smoke-big` → 加载中立即导航离开 → pwsh 查进程 | 离开后无残留 `git log` 进程（CLI） | ✅ | log-page-05.png（离开后页面态） |
| F-014 | 行默认列 Subject + Author + Date | 观察行内容 | 三列可见（Hash 列省） | ✅ | log-page-06.png |
| F-015 | refs chips（分支默认开/tag 默认关） | 观察默认态 → 打开 tag 显示开关 | 默认只显分支 chips；开 tag 后 v1.0 出现 | ✅ | log-page-07.png（「标签」开关为 R1 新增，修复项 D-07） |
| F-016 | 行点击 → 提交详情面板 | 点击合并提交行 | 面板完整：短 hash+复制、作者行、subject、双组 chips、父提交链接 | ✅ | log-page-08.png |
| F-017 | 详情面板操作按钮 | 观察面板按钮区 | 「浏览快照 / Reset 到此处 / 摘樱桃 / 还原」四按钮齐全可点 | ✅ | log-page-09.png |
| F-018 | 顶栏状态条（分支名 + 徽标） | 观察顶栏 | 分支名 `master` + outgoing 绿徽标（本地领先 1） | ✅ | log-page-10.png |
| F-019 | 状态变更自动刷新（事件驱动） | pwsh 检出 `feature` → 等待 | 状态条分支名自动变 `feature`，无需刷新 | ✅ | log-page-11.png |
| F-020 | `refs.changed` 订阅 | pwsh 新建分支 `tmp-refs` → 等待 | ref chips 自动出现 `tmp-refs`（CLI） | ✅ | log-page-12.png |
| F-021 | `?select=<hash>` 深链 | navigate `/repos/:id?select=<某hash>` | 该行选中态 + 详情面板自动展开 | ✅ | log-page-13.png（行选中底色 + 详情面板同时到位；选中行高亮为 R1 修复项 D-08） |
| F-022 | 顶栏入口 5 按钮 | 观察顶栏按钮区 | 「状态/分支/合并/贮藏/设置」五按钮存在 | ✅ | log-page-14.png（顶栏 5 入口按钮实测 aria-label：变更/分支/合并/贮藏/设置——「变更」即状态页入口，另含撤销与「更多」） |
| F-023 | 「更多」菜单 18 项 | 展开「更多」下拉 | 18 项齐全（拉取/推送/更新项目/远程管理/变基/标签/溯源/历史/已提交/搜索/补丁/搁置/控制台/忽略/GitHub/GitLab/工作树/子模块） | ✅ | log-page-15.png（本仓渲染 16 项；GitHub/GitLab 两项受检测门约束，见 F-134/F-140） |
| F-024 | OperationStatus 操作条（kind + 中止） | 进入 rebase 冲突（见 F-076 前置）→ 观察操作条 → 点「中止」 | 操作条显示进行中操作 + 中止按钮；中止后恢复干净态（CLI） | ✅ | log-page-16.png |
| F-025 | 远程操作认证重试回路 | 向需认证的 HTTP 远端 push（依赖外部凭据服务；不具备 → 跳过） | 401 → AuthDialog 弹出（host 自 context、不含 token）→ 录入后 retry 重放 | 跳过：本机无「需认证的 HTTP 远端」服务（git 智能 HTTP + 401 挑战需真实凭据服务或自建 Basic 认证 git 服务器）；AuthDialog 装配与 AUTH_FAILED 分流已由 F-092 同级通道与 api/auth 单测覆盖 | —（排除行不截图） |
| F-026 | 分页「加载更多」（limit ≤500） | 打开 `rebased-smoke-big` → 点「加载更多」 | 首屏 50 行 → 逐次放大（50→100→…→500 封顶），行数增长正确 | ✅ | log-page-18.png |
| F-027 | 过滤（author / path） | 输入作者名 → Enter；清空恢复 | 列表只剩该作者提交；清空后全量恢复 | ✅ | log-page-19.png |
| F-028 | 行右键菜单形态 | 右键提交行 | 菜单项齐全：检出（游离 HEAD）/从此处新建分支/从此处新建标签/在浏览器中打开/Push up to Commit/Fixup/Squash/Reword/Drop/Squash/Fixup Commit | ✅ | log-page-20.png |

### 4.3 DiffPage（slug `diff-page`；P1）

- **入口**：StatusPage 双击变更文件（F-029~F-034、F-036~F-038）；任意两版本从 CommittedChangesPanel 文件点击；三版本从 StatusPage 行「三版本」。
- **前置**：主仓有修改/暂存/新增/删除/重命名文件；`rebased-smoke-big` 有大文件变更（流式行）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-029 | Monaco DiffEditor（懒加载/行号/高亮/只读） | StatusPage 双击修改文件 → diff 页 | Monaco 渲染满高、行号+语法高亮、只读、vs-dark 暗色与应用一致 | ✅ | diff-page-01.png |
| F-030 | 并排/行内切换 + 忽略空白 | 依次切换「行内」「忽略空白」开关 | 默认并排；行内切换生效；忽略空白后空白差异消失 | ✅ | diff-page-02.png |
| F-031 | staged / 工作区切换（三态映射） | 切换 staged 开关 | staged 开 = HEAD vs 暂存区；关 = HEAD vs 工作区（CLI diff 互证） | ✅ | diff-page-03.png（入口 staged 透传为 R1 修复项 D-10） |
| F-032 | 任意两版本对比（from/to 成对） | CommittedChangesPanel 点文件 → `/diff?file&from=<hash>~1&to=<hash>` | 两侧正确 = 该提交 vs 其父提交 | ✅ | diff-page-04.png（from=父提交 9f0af92、to=提交 79e9129；两侧内容与 `git show` 逐行一致） | |
| F-033 | 新增/删除/重命名两侧渲染 | 打开 A/D/R 文件 diff | A 侧/D 侧缺失正确；R 显示 renameFrom | ✅ | diff-page-05.png（A：.gitignore 左侧空/右侧全文；D：docs/gone.md 左侧全文/右侧空——修复项 D-14；R：renameFrom 提示行） | |
| F-034 | unified diff 文本视图 | StatusPage 选中文件 → 行内补丁预览（`/diff/patch` 通道） | unified 文本正确渲染（`@@` 头 + +/- 行） | ✅ | diff-page-06.png（hunk 展开后 unified 文本含 `@@ -4,4 +4,9 @@` 头、空格上下文行、+ 行与 `\ No newline at end of file`） | |
| F-035 | 大 diff 分块流渲染（DiffStreamView） | 打开 `rebased-smoke-big` 大文件 diff → 等待全文 | 先语言 diff 只读渐进累积分块 → 全文到达切换标准视图 | ✅ | diff-page-07.png（620 行改动大文件；流侧 2 个 diff.chunk 共 80KB 渐进到达，全文到达后切标准视图） | |
| F-036 | word diff/同步滚动/折叠/上下文行数 | 逐一切换「空白字符/仅变更区」开关并滚动 | 词级高亮内建；双侧联动滚动；仅变更区 + 5 行上下文 | ✅ | diff-page-08.png（左栏滚轮 2400px 后双侧同显第 162 行＝联动滚动；上下文 2 行/折叠 开关注入生效） | |
| F-037 | 三版本对比（本地/暂存/HEAD） | StatusPage 行「三版本」→ `/diff?three=1` | 两段对比（HEAD→暂存、暂存→工作区）；单维差异另段「无差异」 | ✅ | diff-page-09.png（HEAD→暂存标「无差异」为 R1 修复项 D-16；暂存→工作区 5 处新增） | |
| F-038 | 与分支比较（hunk 应用/回退经 StatusPage 通道） | BranchPanel 行「比较」→ 日志页对比视图 | 双 range 双向提交差异视图正确（hunk 应用/回退通道见 F-042） | ✅ | diff-page-10.png（构造 diverge-test 分叉分支：分支独有 1 / 当前独有 1，与 CLI `rev-list --left-right --count` 的 `1 1` 一致） | |

### 4.4 StatusPage（slug `status-page`；P2）

- **入口**：顶栏「状态」→ `/repos/:id/status`。
- **前置**：主仓置好 修改/暂存/未跟踪（含一个已忽略文件）；变更列表至少 1 个非默认。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-039 | 变更分组列表（已暂存/工作区/未跟踪） | 打开状态页观察分组 | 三组按 XY 码正确分组；已忽略文件不展示（CLI status 互证） | ✅ | status-page-01.png（三组 3/3/3 与 CLI XY 码逐条一致；ignored.log 未展示，CLI 为 `!!`） | |
| F-040 | 变更列表子分组与管理 | 新建变更列表 → 行「移动到列表」→ 观察子标题分组 → 重命名/删除 | 非默认列表子标题分组；默认列表平铺；操作后 CLI 互证 | ✅ | status-page-02.png（新建「冒烟列表」→ 移动 src/app.ts → 子标题分组「冒烟列表-改名（1）」；重命名/删除经 API 复核，删除后 assignments 清空并回平铺） | |
| F-041 | 文件级暂存/取消暂存/放弃修改 | 逐一点行内三按钮（暂存/取消/放弃） | 条目按状态分派 restore/clean；CLI status 每步互证 | ✅ | status-page-03.png（暂存 README→`M `；取消暂存 util→` M`；放弃 gone.md→文件恢复；删除 scratch/→clean；四步 CLI 逐条互证） | |
| F-042 | hunk 级暂存（行内 hunk 选择） | 补丁预览按 hunk 勾选 → 暂存选中 | 仅选中 hunk 进暂存区（CLI `git diff --cached` 互证） | ✅ | status-page-04.png（大仓 hunks.txt 两 hunk：勾 hunk1 暂存 → `git diff --cached` 仅含第 5 行改动，工作区余第 35 行；status=`MM`） | |
| F-043 | 行内补丁预览 | 选中文件 → 观察预览；变更文件后重选 | unified patch 渲染正确；staging/commit 后失效重取 | ✅ | status-page-05.png（hunk 展开显示 `@@ -32,7 +32,7 @@` 头 + 上下文 + -/+ 行；暂存后预览自动重取只剩 1 个 hunk） | |
| F-044 | 提交框（message + amend/signOff/noVerify） | 填 message → 点提交 | 提交成功 → 框清空（key remount）；CLI log 出现新提交 | ✅ | status-page-06.png（提交 bc1f451 落盘：`git log -1` 与三文件明细一致；提交框已清空；暂存组归零） | |
| F-045 | 跳 DiffPage | 点文件「差异」/双击 | 跳 `/diff?file=` 且两侧正确 | ✅ | status-page-07.png（双击文件名 → `/diff?file=src%2Fapp.ts`，右侧 17 行新增与 CLI 一致） | |
| F-046 | 未跟踪行「忽略」一键入口 | 未跟踪行「忽略」→ Modal.confirm | `.gitignore` 追加该路径；行消失；重复操作幂等（CLI） | ✅ | status-page-08.png（Modal.confirm「忽略文件? 将给 .gitignore 追加 /untracked.txt」；落盘后行消失并新增 `M .gitignore`；同路径二次调用端点幂等） | |
| F-047 | 三版本对比入口 | 行「三版本」按钮 | 跳 `/diff?file=&three=1` 三版本视图 | ✅ | status-page-09.png（行「三版本」→ `/diff?file=src%2Fapp.ts&three=1`，两段与「无差异」标注到位） | |
| F-048 | Create Patch from changes | 勾选 ≥1 文件 → 组级「创建补丁」→ Modal 输入名 | 成功跳 `/patches` 且列表含新补丁（CLI） | ✅ | status-page-10.png（勾 2 文件 → 创建补丁 smoke-changes.patch → 跳 /patches 且列表含 1 项；存储于 `~/.rebasedjs/patches/<repoId>/`，1.3KB） | |
| F-049 | Shelve Changes | 页头「搁置」→ Modal 输入名 | 成功跳 `/shelves` 且列表含新搁置（CLI） | ✅ | status-page-11.png（页头「搁置」→ smoke-shelf-1 → 跳 /shelves；存储含 patch.diff 1513B + 未跟踪文件 crlf.txt/todo.md） | |
| F-050 | Stash Files | 页头「存入贮藏」→ Modal 填可选信息 | 成功跳 `/stashes` 且列表含新 stash（CLI `stash list`） | ✅ | status-page-12.png（页头「存入贮藏」→ 跳 /stashes；`git stash list` 出现 `stash@{0}: smoke stash from status page`，工作区已清空） | |
| F-051 | Annotate / Show History 入口 | 行「注解」→ 返回后行「历史」 | 「注解」→ `/blame?file=`；「历史」→ `/history?file=` | ✅ | status-page-13.png（「注解」→ `/blame?file=src%2Fapp.ts`（修复 D-18 后正常）；「历史」→ `/history?file=src%2Fapp.ts` 列出 2 条） | |

### 4.5 CommitDialog（等效内嵌提交框；slug `commit`；P2）

- **入口**：StatusPage 内嵌提交框（审计口径：模态形态未做，提交框为定案等效形态）。
- **前置**：主仓已配身份；另备一个未配身份的空仓验证身份预检；GPG 行依赖本机 gpg；CRLF 行依赖 Windows。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-052 | 提交（信息必填/身份预检） | 未配身份仓提交 → 观察引导；主仓填 message 提交 | 未配身份 → 引导去设置页提示；正常提交成功（CLI） | ✅ | commit-01.png（未配身份仓提交 → 红提示「未配置 user.name 或 user.email，请先在设置页配置」；主仓随后提交 c7b9f6d 成功） | |
| F-053 | amend（改上次提交） | 勾选 amend + 新 message → 提交 | 上次提交 message 被替换、无新提交（CLI log 互证） | ✅ | commit-02.png（勾 amend + 新信息 → `git log -1` 信息被替换、提交数不变、新暂存内容并入该提交） | |
| F-054 | sign-off / 跳过 hooks | 勾选 sign-off 提交 | log 见 Signed-off-by；noVerify 经 hook 仓验证（可跳过+理由） | ✅ | commit-03.png（勾 signOff → 提交体含 `Signed-off-by: Smoke Tester <smoke@example.com>`；noVerify：装 pre-commit hook 后无勾选被拒（退出码 1 + hook stderr），勾选后提交成功） | |
| F-055 | amend 历史提交（amend 到…） | 提交框「amend 到…」下拉选目标 → 提交 | 目标提交信息重写、中间提交重放（CLI log 互证） | ✅ | commit-04.png（「amend 到…」候选＝未发布提交；选最老候选提交 → 目标信息重写、其间 3 个提交重放为新 hash、staged 改动并入目标提交） | |
| F-056 | GPG 签名 / commit template | 设置页配 `commit.template` 等白名单键 → 提交 | 提交链路正常不受扰（CLI config 互证；gpg 签名依赖本机密钥，否则跳过） | ⏭ 跳过（gpg 部分）｜✅（template 部分） | 本机无 gpg（`gpg --version` 不存在）→ 签名提交跳过；已完成：设置页写 `commit.template = .gitmessage`（CLI `git config --local` 互证）后提交链路正常（e034fd3） | |
| F-057 | CRLF 提示（三选 Modal） | Windows 下暂存 CRLF 文件 → 点提交 | 内联警告 + 三选 Modal（修复并提交/原样提交/取消）；非 Windows 跳过+理由 | ✅ | commit-06.png（Windows 下暂存 CRLF 文件点提交 → 三选 Modal「检测到 CRLF 行尾符」；选「原样提交」后提交落盘） | |
| F-058 | commit & push（提交并推送） | 提交框「提交并推送」 | commit 先落盘 → push 当前分支上游；pushed/up-to-date/rejected 三态提示正确（CLI 远端互证） | ✅ | commit-07.png（「提交并推送」→ 本地 800cf2a 与裸远端 HEAD 同 hash，`rev-list --left-right --count` = 0/0，提示「已提交并推送」） | |

### 4.6 ResetDialog（slug `reset`；P2）

- **入口**：LogPage 详情面板「Reset 到此处」（内嵌模态）；Undo Commit 走顶栏 Popconfirm。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-059 | Reset soft / mixed / hard | 详情面板「Reset 到此处」→ 依次三模式执行 | 各模式行为正确（soft 留暂存/mixed 留工作区/hard 全清；CLI 互证） | ✅ | reset-01.png（soft/mixed/hard 三模式依次执行：soft 后 `M  README.md`、mixed 后 ` M README.md`、hard 后工作区干净且 README 回 HEAD 版本；hard 前有「我了解 hard 将丢弃未提交改动」勾选门） | |
| F-060 | Reset Current Branch to Here（等价入口） | 详情面板按钮 → 内嵌模态弹出 | 模态正常弹出（右键菜单形态未做，面板按钮为等价入口） | ✅ | reset-02.png（详情面板「Reset 当前分支到此处」→ 内嵌模态：目标短 hash+主题 + 三模式单选） | |
| F-061 | Undo Commit | 顶栏 Popconfirm → 确认 | soft reset HEAD~1，改动回暂存区（CLI） | ✅ | reset-03.png（顶栏 Popconfirm「将撤销最近提交并保留改动到暂存区」→ HEAD 回退且 .gitmessage 回到暂存区 `A `） | |

### 4.7 BranchPanel（slug `branch`；P2）

- **入口**：顶栏「分支」→ `/repos/:id/branches`。
- **前置**：主仓 master/feature/远程跟踪分支/标签/recent checkout；分叉场景行 F-070 需先构造远端分叉。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-062 | 分组（本地/远程/最近检出/标签）与过滤 | 观察四组 → 文本过滤 → 「仅看已合并」开关 | 四组正确；过滤与已合并开关生效 | ✅ | branch-01.png（四组：最近检出 3 / 本地 7 / 远程 2 / 标签 1；文本过滤 feat → 1/3、1/7、1/2；仅看已合并 → 本地 6/7、远程 2/2（远程过滤为 R3 修复项 D-19）） | |
| F-063 | 行内信息（current/上游徽标/已合并图标） | 观察各分支行 | current 标记、ahead/behind 徽标、已合并绿勾正确 | ✅ | branch-02.png（当前标记 master/当前；上游徽标 origin/master ↑4；已合并绿勾覆盖 6 个本地 + 2 个远程，未合并 diverge-test 无勾） | |
| F-064 | 创建/删除/重命名/设上游 | 新建 Modal（起始点 + 检出开关）→ 删除（未合并 Popconfirm force 提示）→ 重命名 → 设上游 | 各操作 CLI `branch` 互证 | ✅ | branch-03.png（创建 smoke-created@diverge-test → 重命名 smoke-renamed → 设上游 feature→origin/feature → 删除：未合并分支 Popconfirm「该分支未合并，删除将使用强制删除」，四步 CLI 互证） | |
| F-065 | 检出三态（既有/新建并检出/detached） | 检出既有分支 → 新建并检出 → 标签行「检出」（detached） | 三态切换正确（CLI HEAD 互证） | ✅ | branch-04.png（三态检出：既有 diverge-test → HEAD=diverge-test；新建并检出 smoke-new-checkout 入最近检出；标签 v1.0 检出 → `## HEAD (no branch)` 且指向 9f0af92） | |
| F-066 | 查找已合并 / 清理已合并与过时分支 | 开「仅看已合并」→ 「清理已合并（N）」批量删除 | 批量删除非当前已合并分支（CLI 互证） | ✅ | branch-05.png（清理已合并（5）→ 批量删除 5 个；master（当前）与 wt-branch（worktree 占用）保留；修复 D-20 后计数排除 worktree 占用分支，按钮归零禁用） | |
| F-067 | 与当前分支比较 | 行「比较」→ 日志页对比视图 | 双 range 双向提交差异；「当前」分支禁用 | ✅ | branch-06.png（非当前分支「比较」→ `?compare=diverge-test` 双向视图：分支独有 1 / 当前独有 8，与 CLI `rev-list --left-right --count` 8/1 一致；当前分支行「比较」禁用） | |
| F-068 | 与工作树差异 | 行菜单「与工作树差异」→ 差异 Modal → 文件行 | 清单含未提交变更、R/C 带 renameFrom；文件行 → `/diff?from=<分支>` | ✅ | branch-07.png（行菜单「与工作树差异」→ 模态清单含 M/A/R 与 renameFrom；点文件行 → `/diff?file=src/app.ts&from=wt-branch`，17 处新增与 CLI 一致（左侧取分支而非 HEAD 为 R3 修复项 D-21）） | |
| F-069 | 弹窗 Fetch | 页头「Fetch」 | fetch 全部远程 → refs.changed → 列表刷新（CLI 远端互证） | 待测 | branch-08.png |
| F-070 | force-push 后修复 | 构造远端分叉 → 行内「force-push 修复」 | fetch → 本地重置到上游 → 本地独有提交 cherry-pick 重放（CLI 互证） | 待测 | branch-09.png |
| F-071 | 检出并变基到当前 | 远程行下拉「检出并变基到当前」（本地名 Modal） | 检出（远程 → 新本地分支）→ rebase onto 原当前分支（CLI） | 待测 | branch-10.png |
| F-072 | 检出并更新 | 本地行菜单「检出并更新」 | 检出 → fetch 跟踪分支 + 策略更新；up-to-date →「已是最新」（CLI） | 待测 | branch-11.png |

### 4.8 MergeDialog（slug `merge`；P2，页面化）

- **入口**：顶栏「合并」→ `/repos/:id/merge`（open 常驻，取消 = 返回日志页）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-073 | 合并方向选择 | 打开合并页观察两组列表 | 本地分支（排除当前）+ 远程分支（origin/xxx）两组齐全 | 待测 | merge-01.png |
| F-074 | merge 策略 / commit 选项 | 选目标分支 → 勾 no-ff/squash/no-commit → 填信息 → 执行 | 成功返回日志页；CLI 互证合并结果与选项效果 | 待测 | merge-02.png |
| F-075 | 进行中状态联动（中止/冲突跳转） | 用 `rebased-smoke-conflict` 合并 feature → 观察跳转 | 冲突 → 自动跳 `/conflicts`；进行中操作条提示 + 中止入口 | 待测 | merge-03.png |

### 4.9 RebaseDialog（slug `rebase`；P3，内嵌 LogPage 模态）

- **入口**：更多「变基」（简单/交互双模式）。
- **前置**：交互行需多提交目标区间；冲突行用冲突仓。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-076 | rebase onto（目标基选择） | 更多「变基」→ 输入 onto → 开始 | 变基完成，log 图重排正确（CLI） | 待测 | rebase-01.png |
| F-077 | 交互式列表（pick/reword/squash/fixup/drop + 上移/下移） | base 输入 → 观察 todo 列表 → 改动作 → 上移/下移 | 列表正确；首行禁上移、末行禁下移；无效 base 显式报错 | 待测 | rebase-02.png |
| F-078 | continue / abort / 冲突联动 | 冲突仓交互变基 → 解决 → 「完成合并」；另测 abort/skip | continue 泛化成功回日志页；abort 经操作条；skip 丢弃当前继续（CLI） | 待测 | rebase-03.png |
| F-079 | auto-squash / fixup、squash by subject | 暂存内容 → 行右键「Fixup Commit」→ 折入 | `fixup!/squash!` 提交折入目标、信息=目标原文（CLI） | 待测 | rebase-04.png |
| F-080 | 单提交编辑直通（reword/drop/squash/fixup） | 行右键逐一执行（reword 经 Modal 收集新信息） | 各动作落盘正确（根提交无父 → INVALID_QUERY 提示）（CLI） | 待测 | rebase-05.png |

### 4.10 StashPanel（slug `stash`；P2）

- **入口**：顶栏「贮藏」→ `/repos/:id/stashes`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-081 | stash save（message/-u/--keep-index） | 页内保存 Modal → 填 message → 勾 includeUntracked/keepIndex | stash 入列，选项生效（CLI `stash list`/`stash show` 互证） | 待测 | stash-01.png |
| F-082 | pop / apply / drop | 行内 pop → 再 apply → drop（Popconfirm） | 行为正确（pop 移除、apply 保留、drop 删除；CLI 互证） | 待测 | stash-02.png |
| F-083 | stash as branch | 行「转分支」Modal → 执行 | 新分支出现且 stash 消费（CLI `branch` 互证） | 待测 | stash-03.png |
| F-084 | Unstash As 对话框 | 行「Unstash As…」→ 选目标本地分支 → 执行 | 检出目标分支 + apply，不 drop（CLI） | 待测 | stash-04.png |
| F-085 | 查看差异 | 行「查看差异」Modal | `git stash show -p` unified 补丁正确展示 | 待测 | stash-05.png |

### 4.11 TagPanel（slug `tag`；P3）

- **入口**：更多「标签」→ `/repos/:id/tags`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-086 | 创建标签（含附注） | 创建 Modal → name + ref（默认 HEAD）→ message 非空即附注 | 列表出现新标签；附注/轻量区分正确（CLI `tag` 互证） | 待测 | tag-01.png |
| F-087 | 删除标签（本地/远程） | 行内 Popconfirm 删除本地 → 再测「删除远程」 | 本地删除成功；删除远程 = push 空 ref（CLI 远端互证） | 待测 | tag-02.png |
| F-088 | 推送标签（单个/全部） | 行内推送单个 → 页头「推送全部」（Popconfirm） | 远端出现标签（CLI `ls-remote` 互证）；认证回路正常 | 待测 | tag-03.png |

### 4.12 RemotePanel（slug `remote`；P3）

- **入口**：更多「远程管理」→ `/repos/:id/remotes`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-089 | 远程添加/删除/编辑 | 添加新远程 → 编辑 setUrl（同写 fetch/push）→ 删除（Popconfirm） | 各操作正确（CLI `remote -v` 互证） | 待测 | remote-01.png |
| F-090 | fetch（spec/全远程/单远程） | 顶部 fetch 全部 → 行内单远程 → 定制 spec | updatedRefs 展示 + `refs.changed` 推送列表刷新（CLI） | 待测 | remote-02.png |
| F-091 | shallow 识别 / unshallow | 打开 `rebased-smoke-shallow` 远程页 → 观察徽标 → unshallow | 顶部「浅克隆（历史截断）」徽标；unshallow 后消失（CLI） | 待测 | remote-03.png |
| F-092 | HTTPS 认证对话框 / token 存储 | 向需认证远端操作触发 401（依赖外部凭据服务；否则跳过） | AuthDialog 弹出 → token 写回账户存储 → retry 重放成功 | 待测 | remote-04.png |

### 4.13 PushDialog（slug `push`；P3，内嵌模态）

- **入口**：更多「推送」。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-093 | push（远程/分支选择、setUpstream/forceWithLease） | 推送 Modal → 选远程 + 分支输入 → 默认勾 setUpstream → 推送 | 推送成功 + 上游设置落盘（CLI 远端互证） | 待测 | push-01.png |
| F-094 | rejected push → 自动 Update 联动 | 分叉场景推送 → 观察自动弹 Update（merge/rebase）→ 选 merge | 更新成功自动续推原推送体；conflicts 引导解决（CLI） | 待测 | push-02.png |
| F-095 | push tags / force-push 后修复（通道验证） | 验证两通道可达：TagPanel 推送全部、BranchPanel force-push 修复 | 两通道各自完成（证据同 tag-03/branch-09；本行截等效通道完成态） | 待测 | push-03.png |

### 4.14 PullDialog（slug `pull`；P3，内嵌模态）

- **入口**：更多「拉取」。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-096 | pull（远程/分支选择、rebase 选项） | 拉取 Modal → 选远程/分支 → 勾 rebase → 拉取 | 拉取成功合入；rebase 模式生效（CLI 互证） | 待测 | pull-01.png |
| F-097 | fetch 全远程 / fetch spec 定制（通道验证） | 验证承载通道：RemotePanel 顶部 fetch 全部 + spec 定制 | 通道完成（同 remote-02 证据；本行截 RemotePanel fetch 成功态） | 待测 | pull-02.png |

### 4.15 UpdateProjectDialog（slug `update`；P3，内嵌模态）

- **入口**：更多「更新项目」。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-098 | merge/rebase 策略选择 | 打开更新对话框 → 观察策略选项 | 二选一、默认 merge | 待测 | update-01.png |
| F-099 | 更新会话（进度/结果汇总） | 执行更新 → 观察结果面板 | fetched 引用数 + pull 状态（updated 已合入/up-to-date 已最新）汇总；footer 变「关闭」 | 待测 | update-02.png |
| F-100 | Reset to tracked | 左下「Reset to tracked」→ Modal.confirm（danger） | reset --hard upstream、丢弃工作区/暂存（CLI）；无上游不渲染 | 待测 | update-03.png |

### 4.16 BlameView（slug `blame`；P3）

- **入口**：更多「溯源」→ `/repos/:id/blame`，页内路径输入（或 `?file=`）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-101 | 注解展示（等效行列表形态） | 打开某文件溯源 | 行列表：行号/作者/日期/内容 + hash 短名徽标 | 待测 | blame-01.png |
| F-102 | 注解点击联动 | hash 徽标 → 回看后行「差异」→ 回看后行「历史」 | 徽标 → 日志 `?select=`；「差异」→ DiffPage from/to（根提交 `root=1`）；「历史」→ `/history?file=` | 待测 | blame-02.png |
| F-103 | Show All Affected（受影响文件） | 行「受影响」→ Modal → 点文件 | 提交全量变更文件 Modal；文件点击 → 该文件 diff | 待测 | blame-03.png |
| F-104 | previousLineno 边界 | 抽查重命名/边界行注解 | 注解近似正确（orig 近似边界口径，抽查即可） | 待测 | blame-04.png |

### 4.17 HistoryPanel（slug `history`；P3）

- **入口**：更多「历史」→ `/repos/:id/history`，页内路径输入。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-105 | 文件历史列表 | 打开某文件历史 | 条目：短哈希 + subject + 作者 + 日期 | 待测 | history-01.png |
| F-106 | 重命名跟随（`--follow`） | 打开被重命名文件的历史 | 改名前的提交同样列出 | 待测 | history-02.png |
| F-107 | 版本 diff 联动 | 条目点击 → 双击 → 行内「Annotate Revision」 | 点击 → 日志 `?select=`；双击 → DiffPage from/to；Annotate → `/blame?rev=` | 待测 | history-03.png |

### 4.18 CommittedChangesPanel（slug `committed`；P3）

- **入口**：更多「已提交」→ `/repos/:id/committed`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-108 | 按提交浏览已提交变更 | 打开页面 → 观察左栏 → 分页「加载更多」 | 提交列表左栏 + 分页正确 | 待测 | committed-01.png |
| F-109 | 目录树组织变更文件 | 观察右栏目录树 | 目录节点 + A/M/D/R 徽标 + renameFrom；目录缺省展开可折叠 | 待测 | committed-02.png |
| F-110 | 与 diff 查看器联动 | 点目录树文件 | 跳 `/diff?file&from=<hash>~1&to=<hash>` 两侧正确 | 待测 | committed-03.png |

### 4.19 SearchPanel（slug `search`；P3）

- **入口**：更多「搜索」→ `/repos/:id/search`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-111 | 提交搜索（grep / pickaxe） | 双模式 Segmented 各搜一次；输入非法正则 | 结果列表正确；非法正则 → 400 提示 | 待测 | search-01.png |
| F-112 | 结果 → 日志页 | 点结果行 | 跳 `?select=<hash>` 且该行选中 | 待测 | search-02.png |
| F-113 | 分支快速搜索 | 输入即滤本地分支 → 点行 | 检出并回日志页（quickswitch）；当前分支仅导航（CLI） | 待测 | search-03.png |

### 4.20 ConflictsPanel（slug `conflicts`；P2）

- **入口**：`rebased-smoke-conflict` 合并/变基触发冲突自动跳入；或操作条「去解决冲突」。
- **前置**：冲突仓重新构造（master 与 feature 同区域修改）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-114 | 冲突文件列表 + 类型徽标 + 目录分组 | 观察列表 | stages 组合类型徽标正确；按目录子标题分组（带计数） | 待测 | conflicts-01.png |
| F-115 | 整侧解决（ours/theirs/delete） | 行内 ours → 另文件 theirs → 另文件 delete | 对应侧禁用逻辑正确；解决后 CLI 互证 | 待测 | conflicts-02.png |
| F-116 | 3-way 手动合并（MergeView） | 「手动合并」→ 全屏 Modal | 左 ours/右 theirs/底部结果编辑；保存 manual 策略（CLI） | 待测 | conflicts-03.png |
| F-117 | 完成合并（continue 泛化） | 全部解决 → 「完成合并」 | merge/rebase/cherry-pick/revert 共用 continue → 回日志页（CLI） | 待测 | conflicts-04.png |
| F-118 | 跳过（skip） | rebase 冲突 → 底部「跳过」（Popconfirm） | 丢弃当前变更继续后续（CLI）；merge 无 skip 按钮 | 待测 | conflicts-05.png |
| F-119 | 合并状态联动 | 观察进行中提示与操作条 | 进行中提示页内可见；中止入口在 LogPage 操作条 | 待测 | conflicts-06.png |

### 4.21 PatchPanel（slug `patch`；P3）

- **入口**：更多「补丁」→ `/repos/:id/patches`（创建也可从 StatusPage 组级入口）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-120 | 创建补丁（unified diff 三态导出） | 创建 Modal → 依次工作区/暂存/提交区间三态 | 列表出现补丁；三态内容正确（CLI 文件互证） | 待测 | patch-01.png |
| F-121 | 应用补丁（check 先行） | 应用已有补丁 → 再测空补丁 | `git apply --check` 先行；应用成功；空补丁 no-op；失败诚实报错 | 待测 | patch-02.png |
| F-122 | 补丁列表管理 | 观察列表 → 删除（Popconfirm）→ 重名创建 | 名/大小/时间齐全；删除成功；重名 → INVALID_QUERY 提示 | 待测 | patch-03.png |
| F-123 | 导入补丁到搁置 | 行内「导入搁置」 | 成功跳 `/shelves`，同名搁置存补丁全文（CLI） | 待测 | patch-04.png |

### 4.22 ShelfPanel（slug `shelf`；P3）

- **入口**：更多「搁置」→ `/repos/:id/shelves`（保存也可从 StatusPage 页头「搁置」）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-124 | 搁置保存（工作区+暂存+未跟踪随档） | 保存 Modal 输入名 | 列表出现搁置；内容含工作区+暂存 diff + 未跟踪文件（CLI） | 待测 | shelf-01.png |
| F-125 | 恢复 / 删除 | 行内 restore → 再 drop（Popconfirm） | 恢复回写工作区；同名冲突不覆盖；删除成功（CLI） | 待测 | shelf-02.png |
| F-126 | Unshelve 联动 | restore 后回 StatusPage | 工作区变更自动进入状态页（events 刷新） | 待测 | shelf-03.png |

### 4.23 WorktreePanel（slug `worktree`；P4）

- **入口**：更多「工作树」→ `/repos/:id/worktrees`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-127 | 工作树列表 | 观察列表 | path/branch/detached 徽标 +「当前」标记（CLI `worktree list` 互证） | 待测 | worktree-01.png |
| F-128 | 工作树创建 | 创建 Modal → 互斥 Radio（关联已有/新分支） | 创建成功；仓库内/嵌套路径被阻止（CLI） | 待测 | worktree-02.png |
| F-129 | 移除 / 清理 | 行内移除（`--force` 支持）→ prune | 移除与清理正确（CLI） | 待测 | worktree-03.png |

### 4.24 SubmodulePanel（slug `submodule`；P4）

- **入口**：更多「子模块」→ `/repos/:id/submodules`。
- **前置**：主仓已 add 本地子模块。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-130 | 子模块状态列表（四态徽标） | 观察列表（含空格/点号路径） | 未初始化/已检出/提交漂移/冲突四态徽标正确（CLI `.gitmodules` 互证） | 待测 | submodule-01.png |
| F-131 | 子模块更新（init/update） | 行内更新 → 全量（recursive Checkbox） | init/recursive 生效（CLI 互证） | 待测 | submodule-02.png |

### 4.25 IgnoreDialog（slug `ignore`；P3）

- **入口**：更多「忽略」→ `/repos/:id/ignore`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-132 | 创建/编辑/模板（双 target） | 双 target 切换 → 模板替换预览（Node/Python/通用）→ 保存 | `.gitignore`/`.git/info/exclude` 写入正确（CLI 文件互证） | 待测 | ignore-01.png |
| F-133 | 一键忽略文件/目录 | StatusPage 未跟踪行「忽略」→ Modal.confirm | 追加 `/path` 幂等；重复操作不重复写（CLI） | 待测 | ignore-02.png |

### 4.26 GitHubPanel（slug `github`；P3）

- **入口**：更多「GitHub」（仅 github.com 形态远程才渲染；无 → 行 F-134 验证检测门后其余按跳过处理）。
- **前置**：F-136~F-139 需真实 github.com 远端 + PAT（Settings 账户卡片录入）；不具备 → 跳过+理由。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-134 | 检测门（远程形态才渲染） | 在非 github 仓看「更多」→ 再看 github 远程仓 | 非 github 仓不渲染该项；github.com 远程仓渲染 | 待测 | github-01.png |
| F-135 | 账户/token 认证 + 降级卡 | 打开面板（无令牌）→ 观察 → Settings 账户卡片录 PAT | 检测三态（远程+令牌）正确；无令牌 → 提示卡「去设置」；录 PAT 后回面板重检测 | 待测 | github-02.png |
| F-136 | PR 列表/详情/时间线/评论 | 真实远端 → 列表点击选中 → 详情 + 时间线 tab → 发评论 | 时间线 issue comments + review summaries 合并（旧→新）；空评论拦截 | 待测 | github-03.png |
| F-137 | PR 审查（approve/request changes） | 详情内审查 | reviewDecision 徽标正确 | 待测 | github-04.png |
| F-138 | PR diff 视图 + 行级评论 | 文件行级视图 → 逐 hunk 观察 → 行级评论（新侧行号 Select + 发送） | 逐 hunk 两侧 MonacoDiffView + 绝对行号头行；评论线程按 hunk 挂靠并落地 | 待测 | github-05.png |
| F-139 | 三种合并策略 + 检出 PR 分支 | merge/squash/rebase 各测 → 检出 PR | 三策略合并正确（warning 路径）；检出 = fetch `+refs/pull/N/head` + `checkoutNewBranch('pr-N')`（CLI） | 待测 | github-06.png |

### 4.27 GitLabPanel（slug `gitlab`；P4）

- **入口**：更多「GitLab」（仅 gitlab.com 形态远程才渲染）。
- **前置**：F-141~F-144 需真实 gitlab.com 远端 + PAT；不具备 → 跳过+理由。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-140 | 检测门 + 账户认证 | 非 gitlab 仓 vs gitlab 远程仓入口；无令牌降级卡 | 检测门与降级卡同 GitHub 口径 | 待测 | gitlab-01.png |
| F-141 | MR 创建/列表/详情/评论 | 新建 MR Modal（源/目标分支 + 标题 + 描述）→ 列表四徽标 → 详情时间线 → 评论 | 各环节正确；时间线 notes+reviews 合并 | 待测 | gitlab-02.png |
| F-142 | MR diff 视图 + 行级讨论 | 行级视图 → 行级讨论（position new_path/new_line） | 与 GitHub 共用 HunkDiffView；讨论锚点与提交落地 | 待测 | gitlab-03.png |
| F-143 | MR 审查 / 合并 | approve/request changes → merge（squash?） | 三映射端点正确；reviewState 徽标；合并成功 | 待测 | gitlab-04.png |
| F-144 | MR 检出 | 检出 MR | fetch `refs/merge-requests/:iid/head` + `checkoutNewBranch('mr-N')`（CLI） | 待测 | gitlab-05.png |

### 4.28 GitConsole（slug `console`；P3）

- **入口**：更多「控制台」→ `/repos/:id/console`。
- **前置**：先执行若干 git 操作（含带 `-c`/extraheader 的远程操作）再进入。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-145 | git 命令输出展示（环形缓冲 + token 剥离） | 打开控制台 → 观察列表 → 刷新 | 列表（时间/args/退出码/耗时/stderr 尾）齐全；`extraheader` 明文不存在（token 剥离） | 待测 | console-01.png |
| F-146 | 输出折叠（`-c key=value`） | 观察含 `-c` 的条目 | 整对参数折叠为 `-c …` 占位 | 待测 | console-02.png |

### 4.29 QuickActionsMenu（slug `quick-actions`；P2+，等效聚合）

- **入口**：LogPage 顶栏按钮区（独立组件明确不做，等效 = 顶栏 5 按钮 + 更多菜单 18 项 + OperationStatus 操作条）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-147 | 分支快捷弹窗（等效 = 顶栏「分支」） | 顶栏「分支」→ 分支页 | 等效承载可达（同 branch-01 证据；本行截顶栏入口态） | 待测 | quick-actions-01.png |
| F-148 | 操作聚合（等效 = 顶栏 + 更多菜单 + 操作条） | 展开顶栏按钮区 + 更多菜单 | 5 按钮 + 18 项全量入口聚合在位（同 log-page-14/15 证据；本行截聚合展开态） | 待测 | quick-actions-02.png |

### 4.30 SettingsPage（slug `settings`；P1/P2）

- **入口**：顶栏「设置」→ `/repos/:id/settings`（key=repoId 切仓强制重挂载）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-149 | 应用设置读写 | 切 logInEditor 开关 → 刷新后仍保持；观察 recentRepoIds 生效 | 应用设置持久化正确 | 待测 | settings-01.png |
| F-150 | git 配置白名单 9 键读写 | ConfigRow 逐行：生效值 + local 覆盖输入 + 保存 | 保存写仓库配置成功（CLI `git config` 互证）；含 gpgsign/signingkey/commit.template | 待测 | settings-02.png |
| F-151 | 账户/令牌管理 | 添加/覆盖 host+account+token → Popconfirm 删除 | 列表正确；token 仅掩码不下行；配置文件 0600（CLI 文件互证） | 待测 | settings-03.png |
| F-152 | 集中存储（config-store） | 修改任一应用设置 → 重启服务 → 复查 | 配置集中于 config-store 持久化（口径由单测锁定，页面验证持久化即可） | 待测 | settings-04.png |
| F-153 | git 可执行文件检测/引导 | 观察「Git 可执行文件」卡片 | PATH 查找 `git` + 版本输出 + 已检测徽标 | 待测 | settings-05.png |
| F-154 | GPG 专属配置对话框 | 「GPG 提交签名」卡片 → 「配置…」Modal → 勾选 + 密钥下拉 | 状态行正确；密钥下拉列 secret keys；无密钥 → Alert 禁启用；取消勾选仅写 false 不清 key（CLI config 互证） | 待测 | settings-06.png |
| F-155 | 保护分支设置 | 卡片输入正则列表（含一个非法正则）→ 保存 | 非法标红禁保存；合法保存成功；联动：已发布到匹配远程分支的提交编辑 → 「不可重写」拦截提示 | 待测 | settings-07.png |

### 4.31 BrowsePanel（slug `browse`；P4）

- **入口**：LogPage 详情面板「浏览快照」→ `/repos/:id/browse?rev=<hash>`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-156 | 文件树浏览（目录聚合 + 初始一层展开） | 打开快照浏览 → 观察文件树 → 展开目录 | `ls-tree -r` 聚合：目录在前字母序、初始一层展开；子模块/符号链接仅徽标 | 待测 | browse-01.png |
| F-157 | 文件内容只读查看 | 点文本文件 → 再点二进制文件 | 该版本内容正确展示（`git show <rev>:<file>`）；二进制（含 NUL）仅提示不渲染 | 待测 | browse-02.png |
| F-158 | 降级边界 | 无效 rev → 路径越界 → 空版本 | 无效 rev → INVALID_REF 提示；越界 → INVALID_QUERY；空版本空态 | 待测 | browse-03.png |
| F-159 | 入口与导航边 | 详情面板「浏览快照」→ 回日志页 | 入口与回边均可用（边 #22） | 待测 | browse-04.png |

---

## 五、执行记录与缺陷登记

> 按 AGENT.md §冒烟测试记录规范回填：① 范围清单逐项 ✅/❌/跳过+理由；② 操作路径（点击/输入序列）；③ 证据（浏览器状态 + CLI 输出互证）；④ 未覆盖项与后续计划。

| 轮次 | 日期 | 执行范围（F-xx…） | 结果汇总（✅/❌/跳过） | 缺陷登记（根因/修复/复验） |
|------|------|-------------------|------------------------|----------------------------|
| R1 | 2026-09-10 | F-001~F-028（RepoPage 8 + LogPage 20）、F-029~F-031（DiffPage 3）；暗黑/明亮双主题与 1440/768/480 三档宽度抽查 | ✅ 30 / 跳过 1（F-025） | D-01~D-12 全部修复并复验，见下表 |
| R2 | 2026-09-10 | F-032~F-038（DiffPage 7）+ F-039~F-051（StatusPage 13）+ F-052~F-058（CommitDialog 7） | ✅ 27 / 跳过 0.5（F-056 的 gpg 分支） | D-14~D-17 修复并复验（见 §5.4）；夹具纠偏 P-06~P-10（见 §5.5） |
| R3 | 2026-09-10 | F-059~F-061（ResetDialog 3）+ F-062~F-068（BranchPanel 7） | ✅ 10（ResetDialog 3/3、BranchPanel 7/11） | D-19~D-21 修复并复验（见 §5.4）；F-069~F-072 待续 |

### 5.1 R1 缺陷登记（全部已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-01 | 首页打开仓库后日志页整体崩溃（白屏 + 「Rendered more hooks than during the previous render」）——F-001 首轮即触发，后续全部 LogPage 行不可达 | `app/repos/[repoId]/page.tsx` 把跨仓库复位 `useEffect` 写在 `if (!status) return null` 之后：首帧 status 未就绪提前返回（少一个 hook），次帧补齐 → hook 数不等 | 复位 `useEffect` 上移到所有提前 return 之前（其余 hook 本就在顶部，仅此一处越界） | 重跑 F-001：路径表单提交后正常进入 `/repos/:id` 并渲染 8 行提交图（repo-page-01b.png）；F-009~F-028 全量通过 |
| D-02 | 刚 init 的空仓日志页空白无提示，控制台连打 `GET /log 500`——F-008 | 空仓（unborn HEAD）`git log` 退出码 128（`does not have any commits yet`），core `streamLog` 直接抛 `GitExitError` → 路由映射 500 | core `streamLog` 捕获该语义并按空序列返回（新增 `isEmptyRepoLogError`）+ LogPage 0 提交时渲染「暂无提交」空态 | `GET /log?limit=50` → `200 {"commits":[],"hasMore":false}`；页面显示空态（repo-page-08.png）；core 新增用例「streamLog 在空仓（unborn HEAD）产出空序列而不抛错」 |
| D-03 | 控制台告警「Static function can not consume context like dynamic theme」——F-001 坏路径 toast | 容器/流程模块用 antd 静态 `message`，不消费 ConfigProvider 上下文，切主题后静态提示仍是旧主题 | `Providers` 内注册 `ConfigProvider.config({ theme, holderRender })`，静态 message/Modal 渲染进同一主题上下文 | 复跑坏路径 toast：告警消失（warnings=0），提示随主题变色 |
| D-04 | 全站仅暗色（`darkAlgorithm` + `globals.css` 写死 `#141414`），AGENT.md「适配 light 与 dark 主题」不可达 | 无主题开关，主题未进入应用设置 | 契约 `SettingsState.theme`（`light`/`dark`）+ 服务端默认/归一化 + `Providers` 按设置切算法与 `<html data-theme>` + `globals.css` 双套变量 + 设置页「界面主题」Segmented + Monaco 主题联动 | 设置页切「明亮」→ `data-theme=light`、body `#ffffff`、token 翻转（theme-light-settings.png）；日志页/差异页 Monaco 同步 `#fffffe`（theme-light-log.png、theme-light-diff.png）；切回「暗色」恢复 `#141414` |
| D-05 | 明亮主题下多处硬编码色错位：`#f0f0f0` 分隔线（暗色下过亮）、`#888` 次要文字、`#e6f4ff` 选中行底色（暗色下刺眼） | ui 层用明亮专用字面色写内联样式 | 统一改 antd token：`colorSplit`/`colorTextSecondary`/`controlItemBgActive`/`colorSuccess`（repo-page、log-page、commit-graph、branch-panel、committed/github/gitlab 面板） | ui 全量单测 616 通过（含 `#e6f4ff` 断言——`controlItemBgActive` 在默认算法下同值）；双主题截图复核 |
| D-06 | F-010 期望「ref chips 按分支名着色」，实际 chips 恒为 antd 预设蓝/橙，与图车道色无关 | chips 用 `color="blue"`，未接 `colorForRef`（图列着色已实现，chips 未接） | 分支 chip 底色取 `colorForRef(分支名)`（与图车道同源），tag chip 保持橙色预设 | 实测 chips 底色 = `colorForRef` 表值（master `#81a663`、feature `#9763a6`、origin/master `#a68e63`…）；新增单测「分支 chip 底色取 ref 名 hash 色板」 |
| D-07 | F-015 期望「开 tag 显示开关后 v1.0 出现」，实际 tag chips 恒隐藏且无开关 | `CommitGraph.showTags` 默认 false，LogPage 未透传、无 UI 入口 | 过滤行新增「标签」Switch（`data-testid=log-show-tags`）驱动 `showTags` | 默认无 `v1.0`，开开关后 chip 出现（log-page-07.png）；新增单测「过滤行「标签」开关切换 tag chips 显示」 |
| D-08 | F-021 `?select=<hash>` 深链只有详情面板展开，列表行无任何选中态；点击选中同样无高亮 | `CommitGraph` 无选中行概念（未接 selectedHash） | `CommitGraphProps.selectedHash` + 行 `data-selected` 与 token 底色；LogPage 传 `selectedCommit?.hash` | 深链后目标行底色 `rgb(21,50,91)`、`data-selected=true`（log-page-13.png）；新增单测「selectedHash 命中的行带选中底色」 |
| D-09 | 行右键菜单在无 GitHub/GitLab 远端的仓库仍渲染「在浏览器中打开」，点击无任何反应（死控件） | 容器无条件注入 `onOpenInBrowser`，回调内部才判空 remote | 改为仅当检测到 github/gitlab 远程时注入该回调（ui 层「回调不注入即隐藏」约定） | 复跑 F-028：无托管远端仓不再渲染该项，其余 14 项齐全（log-page-20.png） |
| D-10 | 双击「已暂存」分组行进入 diff 页后停在「工作区」模式，看不到该行暂存差异（F-031 三态映射入口断裂） | StatusPage 容器丢弃 ui 传入的 `staged` 第二参；diff 页 `staged` 恒为 `useState(false)`，也不读查询参数 | 两端容器把行分组的 staged 透传为 `&staged=1`；两端 diff 页以 `staged` 查询参数为初值 | `?file=src/util.ts&staged=1` → 选中「已暂存」且渲染 4 处差异（diff-page-03.png），CLI `git diff --cached --stat` 同值；web-next/web-koa 同步修改 |
| D-11 | diff 页控制台告警「Could not create web worker(s). Falling back to loading web worker code in main thread」——diff 计算压在 UI 线程，大 diff 易卡 | 未装配 `MonacoEnvironment.getWorker` | `monaco-lazy` 模块级装配 `getWorker`（`new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' })`，打包器产出独立 worker chunk） | 复跑 diff 页：告警消失，改为 `WorkerBasedDocumentDiffProvider` 计算；diff 渲染与装饰数不变 |
| D-12 | 窄屏（≤768）挤压：顶栏仓库名折行、过滤行「标签」文字被压成竖排 | 顶栏/过滤行无 `flex-wrap`，标签文本无 `nowrap` | 顶栏与过滤行加 `flexWrap: 'wrap'`、仓库名与标签文本加 `whiteSpace: 'nowrap'`、首页路径行加 `wrap` 且输入框 `flex:1;minWidth:200` | 1440/768/480 三档截图（responsive-768-log.png、responsive-480-log.png）复核不再折行/竖排 |
| D-13 | 控制台告警「[antd: Alert] `message` is deprecated. Please use `title` instead」（antd v6） | 5 处 `<Alert message=…>` 沿用 v5 属性名 | 全部迁移为 `title=`（branch-panel/log-page/settings-page/status-page/update-project-dialog）；`description` 语义不动 | ui 相关 198 用例通过，告警消失 |

### 5.2 R1 夹具与流程纠偏（非产品缺陷，记入以免后续轮次重复踩坑）

| 编号 | 现象 | 处置 |
|------|------|------|
| P-01 | 主仓 master 未设 upstream → 状态条不显示 outgoing 徽标（F-018 前置缺失） | `scripts/smoke-setup.ps1` 增加 `branch --set-upstream-to=origin/master|origin/feature`；当场对既有冒烟仓补设 |
| P-02 | F-004 期望副文本 `~/Github/rebased-smoke`，而冒烟仓在 `D:`、主目录在 `C:`，`~/` 相对化按目录边界判定后正确地不生效 | 建目录联接 `C:\Users\zhanglei1120\Github\rebased-smoke` → `D:\…\rebased-smoke`，以 home 下路径注册复核（repo-page-04.png 同时展示「home 下 → `~/Github/rebased-smoke`」与「非 home 下 → 原样绝对路径」两种正确形态） |
| P-03 | F-019 需 CLI 切分支，但工作区脏（夹具使然）导致 `git checkout feature` 被拒 | 改为 `git checkout -b <同内容分支>`（同提交无覆盖风险）验证「状态变更自动刷新」，再 `checkout master` 复原；夹具工作区未被破坏 |
| P-04 | F-012 CLI 追加提交时 `git commit`（无 pathspec）把已暂存的夹具条目（重命名/新增/util 修改）一并提交，暂存分组被清空 | 判定为**冒烟操作失误**（非产品缺陷）：已用 `git mv` + `git add` 重建「暂存三态」夹具（R/A/M）；后续轮次 CLI 追加提交一律带 `-- <pathspec>` |
| P-05 | 冒烟仓构造脚本首版 `Git` 函数与 `git` 可执行文件同名 → 递归调用（call depth overflow）；`git worktree remove` 误对主工作树执行 | 函数改名 `Invoke-Git`；清理阶段仅对附属工作树执行 remove。脚本 `scripts/smoke-setup.ps1` 现可一键重建全部冒烟仓（主仓 8 提交含合并、2 处 stash、预置 worktree、A/D/R 工作区态、冲突仓、320 提交大仓、浅克隆仓、裸远端、非 git/空目录） |

### 5.4 R2 缺陷登记（全部已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-14 | 打开「工作区已删除」文件的 diff 页整页报「内部错误」（`GET /diff 500`）——F-033 | `getFileVersions`/`getFileThreeVersions` 的工作区侧直读 `readFileSync`：文件已删即抛 ENOENT（非 GitExitError）→ 路由按未知错误映射 500（git 侧缺失已有容错，工作区侧漏了同类处理） | `readFileOrMissing` 增加 ENOENT → 空串分支（与 `git diff HEAD -- path` 的 D 语义一致）；三版本读取同样改走该助手 | `GET /diff?file=docs/gone.md` → 200 `{before:全文, after:""}`；页面左栏全红删除、右栏空（diff-page-05.png）；api 新增 3 用例（工作区删除 / HEAD 无而工作区有 / 三版本 working 空） |
| D-15 | 窄屏创建的 Monaco 编辑器放大窗口后不重排：1440 宽下 diff 仅 320px、右侧大片空白——F-033/F-035 观察到的布局异常 | `monaco.editor.create*` 未开 `automaticLayout`（缺省只在创建时量一次尺寸），容器（含窗口/侧栏/详情面板）尺寸变化不触发 `layout()` | DiffEditor 与 PlainEditor 均加 `automaticLayout: true`（Monaco 内置 ResizeObserver 驱动） | 1440×900 下 diff 容器 1424px、左右各 697px 满宽（diff-page-07/08/09.png）；窗口缩放/面板开合后不再需要刷新 |
| D-16 | 三版本对比中「两侧相同」的那一段只是空 diff，无任何文字标注，易与「正在加载」混淆——F-037 | `ThreeWayView` 仅渲染标题 + 空 MonacoDiffView，未判定两侧是否相同 | `CompareSegment` 比较 `before === after` 时在标题行追加「无差异」标注（`data-testid=<段>-identical`） | src/app.ts 三段视图：HEAD→暂存段标注「无差异」、暂存→工作区段显示 5 处新增（diff-page-09.png）；新增 2 用例（单维相同 / 两侧全同） |

| D-17 | blame 页整体报「git 命令失败 …`git log --no-walk` 退出码 128：fatal: bad object 0000…0000」——F-051「注解」入口 | `git blame` 对**工作区未提交行**输出零哈希伪提交（"Not Committed Yet"），`parentHashesOf` 未过滤即作为 `git log --no-walk <hash…>` 参数 → 任何含未提交改动的文件都 blame 失败（500） | `parentHashesOf` 先剔除零哈希（40/64 位全 0）并对这些行直接返回空父列表，仅把真实提交交给 git | `GET /blame?file=src/app.ts` → 200：未提交行 `hash=000…0`、author `Not Committed Yet`、`parents: []`，其余行父哈希正常；core 新增用例「未提交行（零哈希）不进入 git log 参数」 |
### 5.6 R3 缺陷登记（全部已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-19 | 「仅看已合并」把远程分支整组隐藏（显示 0/2、无匹配的远程分支），而 CLI `git branch -r --merged HEAD` 明确列出 origin/feature 与 origin/master——F-062 | core `mergedBranchNames` 只查本地（`git branch --merged`），api `toBranchRef` 又把远程分支硬编码 `mergedIntoHead:false` | core 增加 `git branch -r --merged` 查询并合并结果（远程项为全名）；api 去掉远程排除，按名单统一判定 | 表格：本地 6/7、远程 2/2；远程行亦出现已合并绿勾（branch-01/02.png）；core 新增用例「mergedBranchNames 含已合并的远程跟踪分支」 |
| D-20 | 「清理已合并（1）」承诺可清理，点击后整条操作失败：`git branch -d wt-branch` 退出码 1「cannot delete branch 'wt-branch' used by worktree」——F-066 | 候选集只排除当前分支，未排除被 worktree 检出的分支（git 必然拒绝） | 契约 `BranchRef.checkedOutInWorktree`；api 经 `listWorktrees` 标记；ui 清理候选排除该标记 | 复跑：按钮变「清理已合并（0）」且禁用（branch-05.png）；api 新增用例「getBranches 标记 checkedOutInWorktree」、ui 新增用例「清理候选排除 worktree 占用的已合并分支」 |
| D-21 | BranchPanel「与工作树差异」打开的文件 diff 显示 0 处差异，与 CLI `git diff wt-branch -- src/app.ts`（17 处新增）相悖——F-068 | api `getFileVersions` 的 from-only 分支被并入「工作区模式」并写死左侧 `HEAD`，忽略 `from`（仅 from+to 成对时才用 from） | from-only 左侧改取 `query.from`（`query.from ?? 'HEAD'`），保持 from/to 成对分支不变 | API：before 7 行 / after 24 行（此前两侧同内容）；页面 17 处新增与 CLI 一致（branch-07.png）；api 新增用例「from-only（分支 vs 工作树）：左侧取指定分支而非 HEAD」 |
### 5.5 R2 夹具纠偏

| 编号 | 现象 | 处置 |
|------|------|------|
| P-06 | 大仓 `rebased-smoke-big` 的大文件改动**在最后一个提交里**、工作区是干净的 → diff 页默认「工作区 vs HEAD」两侧相同、`/diff/stream` 返回 0 字节，「大 diff 流式渲染」根本无从触发（F-035 首轮实测） | 在大仓工作区重写 big.txt（620 行 → 620 行改写，`git diff --stat` = 620 插入/620 删除），使工作区大 diff 常驻；`scripts/smoke-setup.ps1` 后续应直接产出该工作区态 |
| P-07 | 分支比较需要「双向都有独有提交」的分叉分支，而冒烟仓各分支均为包含关系（比较后一侧恒空） | 用管道命令造分叉分支而不动工作区/index：`git commit-tree <tree> -p 79e9129 -m …` + `git branch diverge-test <新提交>`；CLI 复核 `rev-list --left-right --count master...diverge-test` = `1 1`（F-038 证据） |
| P-08 | 变更列表「管理列表」下拉的每个列表各有一组「重命名/设为默认/删除」，自动化按文本 `.first()` 命中了**默认列表**那一组，误把默认列表改名（产品行为正确，菜单以分组标题区分归属） | 改用 `li[data-menu-id$="rename:<listId>"]` 精确定位；已把默认列表改回「默认」并重建证据；后续交互定位一律带 id 或分组作用域 |
| P-09 | 状态页行内按钮密集（移动到列表/三版本/注解/历史占满行宽），按行中心坐标点击会命中按钮而非行本体，导致「双击跳 diff」看似失效 | 改为定位行内文件名文本后双击（真实用户路径）；产品侧双击文件名与整行空白处均可达 |
| P-10 | 大仓工作区曾无未提交改动（大改动已提交）+ 主仓缺「两个 hunk」文件，hunk 级暂存与流式大 diff 都无从触发 | 大仓补 `hunks.txt`（40 行，改动第 5/35 行 → git 切成 2 hunk）常驻工作区；主仓两 hunk 尝试因文件过短合并为 1 hunk，改在大仓承载 F-042 |### 5.3 R1 未覆盖项与后续计划

- **F-025（认证重试回路）跳过**：本机无「需认证的 HTTP 远端」（需 git 智能 HTTP + 401 挑战或自建 Basic 认证 git 服务器）；AuthDialog 装配、`AUTH_FAILED` 分流（host 自 context、不含 token）已由 api/auth 单测与 F-092 同级通道覆盖。后续若搭建本地认证 git 服务器再补测。
- **F-032~F-038（DiffPage 余下 7 行）**：两版本对比、A/D/R 两侧渲染、unified patch 预览、大 diff 分块流、折叠/上下文行数、三版本、与分支比较——下一轮按矩阵继续。
- **F-039 起（StatusPage 及之后 28 个页面）**：尚未执行；夹具已就绪（修改/暂存/新增/删除/重命名 + 未跟踪 + 忽略 + CRLF）。
- **断点（复现用）**：主仓 id `18726c5c-f4b2-499d-ac82-6eac8f46ec26`（D:\zhanglei1120\Github\rebased-smoke）；冲突仓 id `82168d54-37c4-45a6-b98d-89f515bcbda5`（当前干净，F-075/F-114 前需重新制造冲突）；大仓 id `7649bb35-612f-4949-9974-d498d68fb19d`。
- **回归基线**：`pnpm typecheck` 全绿；`pnpm test` 全绿（core 226 / api 367 / ui 616 / client + web-next 174 / web-koa 174）。
