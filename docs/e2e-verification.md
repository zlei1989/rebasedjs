# Rebased.js E2E 冒烟测试参照（MCP 模拟人工操作）

- **日期**：2026-09-10（功能矩阵定稿；执行结果按轮次回填，R1 已回填）
- **文档定位**：冒烟测试**参照文档**——先定义功能矩阵，执行后逐行回填结果，不得在本文件外另行扩展口径
- **范围**：`docs/pages-and-api-audit.md` §二/§四 全量（31 页面 / 36 功能域 → 功能点矩阵 **159 个测试行 + 11 个排除行**；terminal、local-history 2 个全域不做项无对应页面）
- **基准**：功能对齐 Java 版 Rebased（`D:\zhanglei1120\Github\rebased`）；终态口径以 `docs/pages-and-api-audit.md`（2026-09-21 终核版）为准
- **方式**：用 MCP（Playwright MCP 工具集）**模拟人工操作**在真实浏览器中按真实用户路径逐项冒烟——打开页面、点击、输入、弹窗、导航全走 UI；页面展示与仓库事实用 `git` CLI 互证（AGENT.md §冒烟测试口径）
- **应用**：web-next（http://localhost:3081）为默认被测端；web-koa（API :3082 + SPA :5173）按需对等抽查
- **端口变更**：2026-09-13 起两端口由 `:3030`（web-next）/`:3031`（web-koa）统一改为 `:3081`/`:3082`，本文档已同步；此前的历史截图地址栏与轮次记录仍显示旧端口（截图不重拍）
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
| 截图 | `browser_take_screenshot` | **注意落盘根**：Playwright MCP 的 `filename` 只允许写在它的输出根内（本机为 `D:\zhanglei1120\Github\deepseek-harness\.playwright-mcp\`），传 `docs/shots/<名>.png` 或绝对路径会被拒（`File access denied: … outside allowed roots`）。可用的两步法：① `filename` 传 `.playwright-mcp/shots/<页面slug>-<NN>.png`；② 收尾用 pwsh 复制进仓：`Copy-Item 'D:\zhanglei1120\Github\deepseek-harness\.playwright-mcp\shots\<名>.png' 'D:\zhanglei1120\Github\rebasedjs\docs\shots\' -Force`（R23 起每完成一节即复制，避免中途中断丢进度） |
| 控制台 / 网络核证 | `browser_console_messages` / `browser_network_requests` | 报错与 API 载荷核证 |
| CLI 互证 | pwsh → `git -C <冒烟仓> status/log/branch/stash/tag/worktree/remote` | 页面展示与仓库事实互证 |

### 1.2 判定口径

- **✅**：界面达到该行「预期最终正确效果」列描述的状态 + CLI 互证一致 + 截图已存 `docs/shots/` 对应文件——三者缺一不可
- **❌**：任一不满足——记根因与复现路径到 §五 执行记录（缺陷登记）
- **跳过 + 理由**：环境不具备（外部依赖：GitHub/GitLab 真实远端+令牌、gpg、Windows CRLF 等），必须在结果列写理由
- **每行一张最终正确效果图**：截图时机 = 该行全部操作步骤完成后的最终状态；过程态用 `<NN>b.png` 附加
- **过程图配额**：每行**最多 1 张** `<NN>b.png` 过程图；多产出的 `<NN>c`/`<NN>d` 默认不计入引用账目、收尾时删除——**除非**行内显式把它引用为「补证过程图」（R23 实例：`search-01c.png` 作为 pickaxe 单条结果的补证被引用保留，同批多产的 `shelf-02c/-02d` 则在收尾删除）
- **toast / Popconfirm 类证据的时序**（R23 实测口径）：antd toast 约 3 秒消失，故「动作 → 截图」之间不要插入多余调用（别在中间再跑一次断言或 hover），否则会拍到已经消失提示的空画面；Popup/Modal 类不消失，可从容取证
- **同一行内工具提示会压住按钮**（如行内「移除」的 Tooltip 盖住 Popconfirm 的「确定」）：点击前先把指针移到空白处（`hover body`）令 Tooltip 消失，再做点击
- **截图不得重复**：收尾用 `Get-FileHash` 全量自检，跨文件 SHA256 必须各不相同——两行的天然同画面（如同为默认列表页）必须换一个有意义的状态（换选中行 / 展开态 / hover 态 / 应用了某开关后的态）
- **toast 取证用「文本轮询」，不要用类名轮询**（R23 实测）：antd v6.6.3 的 toast 根节点是 `.ant-message.ant-message-list.ant-message-top`（**没有** v5 的 `.ant-message-notice-content`），且出现时机可比动作晚约 2.8 s（push 往返）；用 `document.body.innerText` 命中目标文案后**立即**截图
- **移开指针要移到角落**：`page.mouse.move(1434, 892)` + 等约 700ms；`browser_hover('body')` 不可靠（body 中心可能压在帮助图标上，把 Tooltip 拍进图）

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

> **R23 起**：`scripts/smoke-setup.ps1` 已扩写为一键产出「§1.3 基线 + 扩展夹具」（分叉分支 `diverge-test`、大仓 `hunks.txt` 双 hunk 与 `big.txt` 常驻大 diff、冲突仓四路冲突干净态），详见 §5.17；脚本为 UTF-8 **带 BOM**，编辑后务必保留。

### 1.4 执行流程（单轮冒烟）

1. `pnpm dev` 起服务（web-next :3081 / web-koa :3082），浏览器打开 `http://localhost:3081/`；
2. CLI 复位/构造冒烟仓；
3. 按矩阵逐行执行：入口 → 模拟人工步骤 → 等待 → 截图（最终正确效果）→ CLI 互证；
4. 每行回填「结果」列（✅/❌/跳过+理由）；❌ 行登记 §五 执行记录；
5. 一轮结束更新 §二 总览表状态；全部 ✅ 后关闭记录。

---

## 二、功能矩阵总览（31 页面）

> 行数 = 测试行（含跳过候补）；排除行见 §三。**状态列 = 最近一轮（R23，2026-09-12 起全量重跑）的实测结果**：未重跑到的页面仍保留 R1~R22 的收官状态，重跑完成后逐页改写。**2026-09-20 起**：溯源页（#16）整页重构为三栏工作台并删掉旧单列 `BlameView`，该页按**部分重跑 R24** 的新证据改写（见 §4.16 与 §5.34）——**3/4 重跑，F-104 本轮未重跑**（故该页状态列由 `✅ 4/4` 改为 `⚠️ 3/4`），其余页面状态不动。**站级合计不随之变动**：R23 那条「159 行 = ✅150 / ⏭9」是 R23 当轮的口径记录，不改写历史。

| # | 页面 | 阶段 | 路由/承载 | 模拟入口（一步到达） | 测试行 | 截图前缀 | 状态 |
|---|------|------|-----------|----------------------|--------|----------|------|
| 1 | RepoPage | P1 | `/` | 浏览器打开 :3081 首页 | F-001~F-008（8） | repo-page | ✅ 8/8 |
| 2 | LogPage | P1 | `/repos/:id` | RepoPage 打开冒烟仓 | F-009~F-028（20） | log-page | ⚠️ 19/20（F-020 ❌ 见 D-39） |
| 3 | DiffPage | P1 | `/repos/:id/diff` | StatusPage 双击变更文件 | F-029~F-038（10） | diff-page | ✅ 10/10 |
| 4 | StatusPage | P2 | `/repos/:id/status` | 顶栏「状态」 | F-039~F-051（13） | status-page | ✅ 13/13 |
| 5 | CommitDialog（等效内嵌提交框） | P2 | StatusPage 内 | StatusPage 提交框 | F-052~F-058（7） | commit | ✅ 7/7（F-056 的 gpg 分支跳过） |
| 6 | ResetDialog（内嵌模态） | P2 | LogPage 内 | 详情面板或提交行右键「Reset 当前分支到此处」 | F-059~F-061（3） | reset | ✅ 3/3 |
| 7 | BranchPanel | P2 | `/repos/:id/branches` | 顶栏「分支」 | F-062~F-072（11） | branch | ⚠️ 10/11（F-066 ❌ 见 D-40） |
| 8 | MergeDialog（页面化） | P2 | `/repos/:id/merge` | 顶栏「合并」 | F-073~F-075（3） | merge | ✅ 3/3 |
| 9 | RebaseDialog（内嵌模态） | P3 | LogPage 内 | 更多「变基」 | F-076~F-080（5） | rebase | ✅ 5/5 |
| 10 | StashPanel | P2 | `/repos/:id/stashes` | 顶栏「贮藏」 | F-081~F-085（5） | stash | ✅ 5/5 |
| 11 | TagPanel | P3 | `/repos/:id/tags` | 更多「标签」 | F-086~F-088（3） | tag | ✅ 3/3 |
| 12 | RemotePanel | P3 | `/repos/:id/remotes` | 更多「远程管理」 | F-089~F-092（4） | remote | ✅ 4/4 |
| 13 | PushDialog（内嵌模态） | P3 | LogPage 内 | 更多「推送」 | F-093~F-095（3） | push | ✅ 3/3 |
| 14 | PullDialog（内嵌模态） | P3 | LogPage 内 | 更多「拉取」 | F-096~F-097（2） | pull | ✅ 2/2 |
| 15 | UpdateProjectDialog（内嵌模态） | P3 | LogPage 内 | 更多「更新项目」 | F-098~F-100（3） | update | ✅ 3/3 |
| 16 | BlameWorkbench（原 BlameView，三栏工作台） | P3 | `/repos/:id/blame` | 更多「溯源」→ 左树选文件（或页内输路径） | F-101~F-104（4） | blame | ⚠️ 3/4 本轮重跑（F-104 本轮未重跑，沿用 R10；见 §5.34⑤） |
| 17 | HistoryPanel | P3 | `/repos/:id/history` | 更多「历史」→ 页内输路径 | F-105~F-107（3） | history | ✅ 3/3 |
| 18 | CommittedChangesPanel | P3 | `/repos/:id/committed` | 更多「已提交」 | F-108~F-110（3） | committed | ✅ 3/3 |
| 19 | SearchPanel | P3 | `/repos/:id/search` | 更多「搜索」 | F-111~F-113（3） | search | ✅ 3/3 |
| 20 | ConflictsPanel | P2 | `/repos/:id/conflicts` | 制造冲突自动跳入 / 操作条「去解决冲突」 | F-114~F-119（6） | conflicts | ✅ 6/6 |
| 21 | PatchPanel | P3 | `/repos/:id/patches` | 更多「补丁」 | F-120~F-123（4） | patch | ✅ 4/4 |
| 22 | ShelfPanel | P3 | `/repos/:id/shelves` | 更多「搁置」 | F-124~F-126（3） | shelf | ✅ 3/3 |
| 23 | WorktreePanel | P4 | `/repos/:id/worktrees` | 更多「工作树」 | F-127~F-129（3） | worktree | ✅ 3/3 |
| 24 | SubmodulePanel | P4 | `/repos/:id/submodules` | 更多「子模块」 | F-130~F-131（2） | submodule | ✅ 2/2 |
| 25 | IgnoreDialog | P3 | `/repos/:id/ignore` | 更多「忽略」 | F-132~F-133（2） | ignore | ✅ 2/2 |
| 26 | GitHubPanel | P3 | `/repos/:id/github` | 更多「GitHub」（github.com 远程才渲染） | F-134~F-139（6） | github | ✅ 2/6（F-136~F-139 跳过：需真实 github.com 仓库 + PAT） |
| 27 | GitLabPanel | P4 | `/repos/:id/gitlab` | 更多「GitLab」（gitlab.com 远程才渲染） | F-140~F-144（5） | gitlab | ✅ 1/5（F-141~F-144 跳过：需真实 gitlab.com 项目 + PAT） |
| 28 | GitConsole | P3 | `/repos/:id/console` | 更多「控制台」 | F-145~F-146（2） | console | ✅ 2/2 |
| 29 | QuickActionsMenu（等效聚合） | P2+ | 顶栏 5 按钮 + 更多菜单 18 项 | 顶栏按钮区 | F-147~F-148（2） | quick-actions | ✅ 2/2 |
| 30 | SettingsPage（拆两页：应用设置 `/settings` + 仓库设置 `/repos/:id/settings`） | P1/P2 | `/settings` 与 `/repos/:id/settings` | 首页「设置」→ 应用设置；顶栏「设置」→ 仓库设置 | F-149~F-155（7，落点见 §4.30 顶部说明） | settings / app-settings | ✅ 7/7 |
| 31 | ~~BrowsePanel~~（整页已删除） | P4 | ~~`/repos/:id/browse?rev=`~~ | —— | F-156~F-159（4） | browse（历史图） | ✅ 4/4（历史记录；能力现由 LogPage 就地快照栏承载，见 §4.31/§4.32 与 §5.29⑥） |

---

## 三、不测清单（排除行：11 + 全域 2）

> 依据 `docs/pages-and-api-audit.md` §1.3 / §四 / §5.3；排除行不截图、不执行，理由回填本表即可。

| # | 页面 | 功能点 | 状态 | 排除理由（审计出处） |
|---|------|--------|------|----------------------|
| E-01 | RepoPage | 列表项分支后缀/图标/失效标记 | ✅ 已落地 | 已实现并冒烟验过，见同文件 §5.28 ①（分支后缀 / 首字母渐变头像 / 失效标记与确认框）；审计出处 §4.1、§7.2 #8 |
| E-02 | LogPage | 分支折叠 / PermanentGraph 高级视图 | ✅ 已落地 | 已实现并冒烟验过，见同文件 §5.28 ②③（线性折叠/展开 与 分支过滤）；审计出处 §4.2、§7.9 |
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

- **入口**：`browser_navigate` → `http://localhost:3081/`（web-koa 对等抽查用 :5173）。
- **前置**：冒烟仓 `rebased-smoke` 已注册；另备一个非 git 目录（坏路径）、一个空目录、裸仓 `smoke-remote` 本地路径。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-001 | 打开路径表单（校验→验证→注册→跳日志页） | 输入非 git 目录路径 → 点「打开」→ 观察 toast；再输入 `D:\zhanglei1120\Github\rebased-smoke` → 「打开」 | 坏路径 → 红 toast「不是 git 仓库：…」；好路径 → 跳 `/repos/:id` 日志页 | ✅ | repo-page-01.png（红 toast「不是 git 仓库：D:\zhanglei1120\Github\rebased-smoke-nongit」）、repo-page-01b.png（成功跳日志页：`/repos/f761a9f6-…` 渲染 8 行提交） |
| F-002 | 最近列表（打开即注册/同路径复用/最近优先） | 首页看列表 → 移除冒烟仓 → 重新打开 → 回首页 → 再次打开同路径 | 列表出现冒烟仓且置顶；同路径再次打开不新增重复行（id 复用）（CLI） | ✅ | repo-page-02.png（移除后重开 → 列表 10 条、`rebased-smoke` 置顶；**同路径再次打开复用同一 id** `f761a9f6-5c91-4115-9261-69715687e875`，`config.json` 内该路径仅 1 条）。CLI 口径修正：**移除会删掉该 id**，移除后再打开是「新注册」（本轮实测新 id `a8129849-…`），故「id 复用」仅指未移除时的重复打开 |
| F-003 | 显示名（定案单级） | 注册时观察列表项显示名 | 显示名为目录名 `rebased-smoke`（单级，非三级回退） | ✅ | repo-page-03.png（列表项主文本 = 目录名 `rebased-smoke`，单级非三级回退；含行 hover 态） |
| F-004 | 路径副文本 `~/` 相对化 | 观察列表项副文本 | 副文本显示 `~/Github/rebased-smoke`（homeDir 注入） | ✅ | repo-page-04.png（同屏两形态：经 home 下目录联接注册 → `~/Github/rebased-smoke`；经 `D:\…` 注册 → 原样绝对路径；8.3 短名路径 `C:\Users\ZHANGL~1\…` 不作相对化） |
| F-005 | 列表上限 50 | 列表正常渲染；上限逻辑引服务端 `RECENT_LIMIT=50` 单测证据（不构造 50+ 仓） | 列表渲染正常、无报错；上限口径 = 50 | ✅ | repo-page-05.png（11 条渲染正常、无控制台报错）；口径证据：`packages/server/api/src/repo.ts:11` `RECENT_LIMIT = 50` + `repo.test.ts`「配置直写 60 条 → 返回 50 条」 |
| F-006 | 移除动作 + Popconfirm | 行内移除按钮 → Popconfirm 确认 | 行从列表消失、无报错；再次打开可重新注册（CLI） | ✅ | repo-page-06.png（Popconfirm「移除该仓库？」确认后行消失、列表 11→10、`GET /api/repos` 与 `config.json` 同步少一行；同路径重新打开可再次注册成功）。过程注记：移除按钮的工具提示会压住 Popconfirm 的「确定」，需先移开指针 |
| F-007 | 克隆对话框（URL + Directory） | 「克隆」→ Modal → 输入裸仓路径作 URL + 目标目录 → 克隆 | Modal 字段最小集；成功 → 列表新增该仓 + 跳日志页（CLI 目标目录为 git 仓） | ✅ | repo-page-07.png（克隆成功跳 `/repos/9b0168bb-…`；CLI：`D:\zhanglei1120\Github\rebased-smoke-clone` 为 git 仓、7 提交、`origin` 指向 `smoke-remote`）、repo-page-07b.png（Moda 填写态：URL=裸仓路径、目标目录） |
| F-008 | 初始化仓库入口 | 「初始化」→ Modal → 输入新目录 → 初始化 | 成功 → 跳日志页（空仓 unborn HEAD；CLI `git status` 互证） | ✅ | repo-page-08.png（初始化成功跳 `/repos/9918c699-…`，页面「暂无提交 / 该仓库还没有任何提交…」；CLI `## No commits yet on master`，`GET …/log` → `{"commits":[],"hasMore":false}`） |

### 4.2 LogPage（slug `log-page`；P1，仓库枢纽页）

- **入口**：RepoPage 打开 `rebased-smoke`（分页/滚动行用 `rebased-smoke-big`）。
- **前置**：主仓 8 提交含 1 合并提交、master/feature 分支、tag v1.0、本地领先 origin 1 提交。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-009 | 提交图真图渲染（lane/边路由） | 打开主仓日志页 → 观察 8 提交含合并 | 图列在合并处正确岔开/合拢，无重叠错位 | ✅ | log-page-01.png（8 行；逐行读 SVG：主道 x=9、feature 道 x=27，feature 两行行宽 56（双车道）→ 第 5 行合拢回 x=9，合并行含分叉 polyline，无重叠错位） |
| F-010 | 分支着色（ref 名 hash → HSB 色板） | 观察 ref chips 颜色 | chips 颜色按分支名稳定着色（与测试断言口径一致） | ✅ | log-page-02.png（chip 底色实测 = `colorForRef(名)`：master `#81a663`、feature `#9763a6`、origin/master `#a68e63`、wt-branch `#a67163`、merged-branch `#63a692`、origin/feature `#63a663`；tag chip 保持橙色预设） |
| F-011 | 虚拟滚动（固定行高窗口渲染） | 打开 `rebased-smoke-big` → 连续滚动 | 滚动流畅、行高 24 一致、无整页白屏 | ✅ | log-page-03.png（大仓：列表内容高 7680 = 320 行 × 24，而 DOM 常驻仅 35~36 行（虚拟窗口）；四段滚动逐次采样行高恒 = 24，首个可见行为 `chore: bulk commit 204`，无白屏） |
| F-012 | 首屏快照 + SSE 增量渲染 + hash 去重 | 打开日志页 → pwsh 在主仓追加 1 提交 → 等待 | 新提交行自动出现在顶部，无需刷新（CLI 互证新 hash） | ✅ | log-page-04.png（`git commit -m '…（F-012）' -- sse-probe.txt` 落 `8d65417`（作者 Other Dev）→ 页面**未刷新**自动出现该行置顶、行数 8→9；P-04 口径沿用：带 pathspec 提交，夹具暂存区 R/A/M 未被吞） |
| F-013 | 取消链路（断开即杀 git 进程） | 打开 `rebased-smoke-big` → 加载中立即导航离开 → pwsh 查进程 | 离开后无残留 `git log` 进程（CLI） | ✅ | log-page-05.png（离开后首页态）。CLI：导航离开后 `Get-Process git` 计数 = 0，无残留。**边界**：20ms 采样在打开→离开窗口内未捕获到 `git log` 进程（大仓 `git log` 进程窗口仅 ~140ms，短于一次导航往返），故「正在跑的进程被 kill」这一正向路径本轮未能实机触发；杀进程实现见 `core/src/exec.ts` 的 `killTree`（Windows `taskkill /T /F`）+ `exec.test.ts`「进行中 abort：以 130 拒绝」（用长命 `upload-pack` 触发） |
| F-014 | 行默认列 Subject + Author + Date | 观察行内容 | 三列可见（Hash 列省） | ✅ | log-page-06.png（行内容 = subject + ref chips + 作者 + 日期，无 Hash 列，符合口径） |
| F-015 | refs chips（分支默认开/tag 默认关） | 观察默认态 → 打开 tag 显示开关 | 默认只显分支 chips；开 tag 后 v1.0 出现 | ✅ | log-page-07.png（默认 6 个分支 chip、无 `v1.0`；开「标签」开关后 merge 行 refs 区变 `origin/master merged-branch v1.0`。注：tag chip 无 `data-testid`，断言口径为 refs 容器文本） |
| F-016 | 行点击 → 提交详情面板 | 点击合并提交行 | 面板完整：短 hash+复制、作者行、subject、双组 chips、父提交链接 | ✅ | log-page-08.png（点合并行：面板 `761961d` + 复制按钮、`Smoke Tester on 2026-09-12 at 17:42`、subject `Merge branch 'feature'`、分支 chips `origin/master merged-branch` + tag chip `v1.0`、父提交链接 `a49e2ff`/`e03962c`；CLI `git log -1 761961d` 的 parents 与其逐字一致；选中行 `data-selected=true`） |
| F-017 | 详情面板操作按钮 | 观察面板按钮区 | 「浏览快照 / 查看变更集 / 摘樱桃 / 还原 / Reset 当前分支到此处」按钮齐全可点 | ✅ | log-page-09.png（实测按钮集：`copy-hash`、浏览快照、查看变更集、摘樱桃、还原、`Reset 当前分支到此处`——四行要求项齐全且均可用，另含「查看变更集」） |
| F-018 | 顶栏状态条（分支名 + 徽标） | 观察顶栏 | 分支名 `master` + outgoing 绿徽标（本地领先 1） | ✅ | log-page-10.png（顶栏 `首页 \| rebased-smoke \| master`；`[data-testid=outgoing]` 存在、`incoming` 不存在；CLI `rev-list --left-right --count origin/master...master` = `0 1`） |
| F-019 | 状态变更自动刷新（事件驱动） | pwsh 检出 `feature` → 等待 | 状态条分支名自动变 `feature`，无需刷新 | ✅ | log-page-11.png（夹具工作区脏，直接 `checkout feature` 会被 git 拒——沿 R1 的 P-03 处置改为 `git checkout -b f019-probe`（同内容分支）→ **未刷新**页面状态条自动变 `f019-probe`、outgoing 徽标随上游缺失消失、chips 自动多出 `f019-probe`） |
| F-020 | `refs.changed` 订阅 | pwsh 新建/删除分支 → 等待（页面全程不刷新） | ref chips 自动跟随变化（CLI） | ✅ | log-page-12.png（**双向实时实测**：页面加载完成后用 CLI `git branch -D f020-fixed-probe` → chips **6.0 s** 内消失；再 `git branch f020-fixed-probe HEAD` → **6.8 s** 内重新出现，全程未刷新；画面顶部行 chips = `rebase-topic / origin/rebase-topic / f020-fixed-probe`。修复前同场景等待 22 s 无变化——根因与修复落点见 §5.20 D-39） |
| F-021 | `?select=<hash>` 深链 | navigate `/repos/:id?select=<某hash>` | 该行选中态 + 详情面板自动展开 | ✅ | log-page-13.png（`?select=761961d81ca2801637bea2ef42c7a3ca7211e670`：目标行 `data-selected=true` 带选中底色、详情面板同时展开为该提交） |
| F-022 | 顶栏入口 5 按钮 | 观察顶栏按钮区 | 「状态/分支/合并/贮藏/设置」五按钮存在 | ✅ | log-page-14.png（顶栏实测 `aria-label`：撤销最近提交 / 变更 / 分支 / 合并 / 贮藏 / 设置 / 更多 + 首页链接——「变更」即状态页入口，五个要求入口齐备；截图含「合并」按钮悬停提示） |
| F-023 | 「更多」菜单 18 项 | 展开「更多」下拉 | 18 项齐全（拉取/推送/更新项目/远程管理/变基/标签/溯源/历史/已提交/搜索/补丁/搁置/控制台/忽略/GitHub/GitLab/工作树/子模块） | ✅ | log-page-15.png（本仓（本地 file 远程）**渲染 16 项**：溯源/历史/已提交/搜索/变基/标签/拉取/推送/更新项目/远程管理/补丁/搁置/控制台/忽略/工作树/子模块；GitHub/GitLab 两项受检测门约束，见 F-134/F-140——18 为含两种托管面板的全集上限） |
| F-024 | OperationStatus 操作条（kind + 中止） | 进入 rebase 冲突（见 F-076 前置）→ 观察操作条 → 点「中止」 | 操作条显示进行中操作 + 中止按钮；中止后恢复干净态（CLI） | ✅ | log-page-16.png（冲突仓检出 `feature` → 界面「更多→变基」onto=master → 冲突自动跳 `/conflicts`（4 路冲突、提示「变基进行中…」）→ 返回日志页顶栏显示 `(detached) \| 变基中（第 1/1 步）` + 红「中 止」；点中止 → 确认框「确定中止当前操作？工作区将回到操作前状态」→ CLI：`.git/rebase-merge` 清除、分支回 `feature`、`shared.txt` 回 feature 版、工作区干净） |
| F-025 | 远程操作认证重试回路 | 向需认证的 HTTP 远端 push（依赖外部凭据服务；不具备 → 跳过） | 401 → AuthDialog 弹出（host 自 context、不含 token）→ 录入后 retry 重放 | ✅ | remote-04.png（本机起恒 401 的 git smart-HTTP 服务 `http://127.0.0.1:9418`，加远程 `auth-probe` → 日志页「拉取」触发 → 401 `AUTH_FAILED` → 「需要认证」对话框（主机自 `context.host` 预填 `127.0.0.1`、表单内不含 token）→ 填 `smoke-tester` / `smoke-token-f092` →「保存并重试」；服务端请求日志两次请求对比：`auth:null`（首请）→ `auth:"Bearer smoke-token-f092"`（重放），`config.json` → `auth.accounts` 落盘 `{host:127.0.0.1, account:smoke-tester, token:smoke-token-f092}`。边界同 R8：服务恒 401，「重放成功」以「重放确实发生且携带新凭据」为证。冒烟后已删除临时账户与 `auth-probe` 远程） |
| F-026 | 按需加载更早提交（页大小 ≤500 + skip 游标） | 打开 `rebased-smoke-big` → 滚到列表底部（或点「加载更多」手动兜底） | 首屏 50 行 → 触底自动追加（页大小 50→100→200→400→500，skip 逐页累加），一路到服务端 `hasMore=false`：最早一条（`chore: bulk commit 1`）可见、按钮转「已到最早的提交」且禁用 | ✅ | log-page-18.png（大仓 320 提交实测：首屏 50 行 → 触底自动追加 → 列表内容高 1200→3600→7680（= 50→150→320 行）；网络实测档位 `limit=50&skip=0` → `limit=100&skip=50` → `limit=200&skip=150`，末页返回 170 条 < 200 → `hasMore=false`；滚到底后最早一行 `feat: 新增 big.txt 与 hunks.txt 初版` 可见、按钮转「已到最早的提交」且 `disabled`） |
| F-027 | 过滤（author / path） | 输入作者名 → Enter；清空恢复 | 列表只剩该作者提交；清空后全量恢复 | ✅ | log-page-19.png（作者过滤 `Other` → 仅 1 行 `chore(smoke): SSE 增量提交（F-012）`，与 CLI `git log --author=Other` 一致；路径过滤 `src/util.ts` → 1 行 `feat(core): 新增应用入口与工具函数`，与 `git log -- src/util.ts` 一致；两项清空后 9 行全量恢复） |
| F-028 | 行右键菜单形态 | 右键提交行 | 菜单项齐全：检出（游离 HEAD）/从此处新建分支/从此处新建标签/在浏览器中打开/Push up to Commit/Fixup/Squash/Reword/Drop/Squash/Fixup Commit | ✅ | log-page-20.png（右键实测 14 项 + 3 条分隔线：检出此提交（游离 HEAD）/从此处新建分支…/从此处新建标签…/摘樱桃/还原/Reset 当前分支到此处/浏览快照/Fixup Commit/Squash Commit/Push up to Commit/Reword Commit/Drop Commit/Squash Commit（并入父提交）/Fixup Commit（并入父提交）；**无「在浏览器中打开」**——本仓为本地 file 远程，符合 D-09 的注入契约） |

### 4.3 DiffPage（slug `diff-page`；P1）

- **入口**：StatusPage 双击变更文件（F-029~F-034、F-036~F-038）；任意两版本从 CommittedChangesPanel 文件点击；三版本从 StatusPage 行「三版本」。
- **前置**：主仓有修改/暂存/新增/删除/重命名文件；`rebased-smoke-big` 有大文件变更（流式行）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-029 | Monaco DiffEditor（懒加载/行号/高亮/只读） | StatusPage 双击修改文件 → diff 页 | Monaco 渲染满高、行号+语法高亮、只读、vs-dark 暗色与应用一致 | ✅ | diff-page-01.png（状态页双击 `src/app.ts` → `/diff?file=src%2Fapp.ts`；`.monaco-diff-editor` 1424×818 满高、两侧编辑器均 `monaco-editor vs-dark`、body `#141414` 与应用暗色一致；decorations 5 插入 = CLI `git diff --stat` 的 `1 file changed, 5 insertions(+)`；只读口径见 `monaco-lazy.tsx:75` `readOnly:true` 与 `diff-viewer.tsx:142`）。**2026-09-16 复跑更正**：本行原写的「语法高亮」在此前各轮**并不成立**（两侧只有单调文本色，控制台持续报 `toUrl` TypeError；根因与修法见 P-30）。修复后实测 `proxyGateway` 仓 `…/diff?file=lib%2Fconvert%2Fstructured-output.js&from=e03b800f786dae1db3f368eccbe634bee107a233&to=aa995904ecc09786c45be8620d8f299e79eb4852`：`.monaco-diff-editor.side-by-side` 两侧已渲染、decorations **7 插入 / 5 删除**（= CLI `git show --stat` 的 `12 +++++-----`）、可见 token class **6 种**（`mtk1/5/6/7/8/9`，修复前恒为 1 种 `mtk1`）、页面控制台 **0 error / 0 warning** |
| F-030 | 并排/行内切换 + 忽略空白 | 依次切换「行内」「忽略空白」开关 | 默认并排；行内切换生效；忽略空白后空白差异消失 | ✅ | diff-page-02.png（默认「并排」；为验证忽略空白，临时给 `src/app.ts` 第 2 行加 3 个行尾空格 → `git diff --stat` 变 6 插入/1 删除，页面 decorations 同步 `ins=6 del=1`；开「忽略空白」后变 `ins=5 del=0`（空白差异消失），切「行内」后单栏成对显示。取证后已把空格还原、`git diff --stat` 回到 5 insertions） |
| F-031 | staged / 工作区切换（三态映射） | 切换 staged 开关 | staged 开 = HEAD vs 暂存区；关 = HEAD vs 工作区（CLI diff 互证） | ✅ | diff-page-03.png（状态页**双击「已暂存」组的 `src/util.ts`** → `/diff?file=src%2Futil.ts&staged=1`，右侧分段选中「已暂存」、4 处插入 = CLI `git diff --cached --stat`；同一文件切「工作区」→ 仍 4 处（HEAD vs 工作区，二者内容相同）；反向用 `src/app.ts` 实测：工作区模式 5 插入 = `git diff`，切「已暂存」→ 0 处 = `git diff --cached` 为空） |
| F-032 | 任意两版本对比（from/to 成对） | CommittedChangesPanel 点文件 → `/diff?file&from=<父哈希>&to=<提交>` | 两侧正确 = 该提交 vs 其父提交 | ✅ | diff-page-04.png（已提交页选 `77e62c4` → 点 `src/app.ts` → `?file=src%2Fapp.ts&from=761961d…&to=77e62c4…`；左栏 6 行（= `git show 761961d:src/app.ts`）、右栏 7 行且含 `APP_VERSION`（= `git show 77e62c4:src/app.ts`），2 处插入；from/to 成对时「工作区/已暂存」分段隐藏（仅给 from 时仍显示，此时切「已暂存」会被服务端拒绝并在整页显示错误）） | |
| F-033 | 新增/删除/重命名两侧渲染 | 打开 A/D/R 文件 diff | A 侧/D 侧缺失正确；R 显示 renameFrom | ✅ | diff-page-05.png（**D**：`docs/gone.md` 工作区删除 → 左栏 4 行全文/右栏空，4 删除装饰，页面无报错，API `{before: 4 行, after: ""}`——D-14 未见回归；**A**：`src/new-file.ts`（已暂存新增）→ 左栏空/右栏全文（API `before:""`）；**R**：已提交页点 `R docs/old-name.md → new-name.md` → `?renameFrom=docs%2Fold-name.md`，页面显示提示行「该变更涉及重命名：docs/old-name.md → docs/new-name.md（改名前的历史请到「历史」页查看）」且**不做伪 diff**（两侧 0 行）） | |
| F-034 | unified diff 文本视图 | StatusPage 选中文件 → 行内补丁预览（`/diff/patch` 通道） | unified 文本正确渲染（`@@` 头 + +/- 行） | ✅ | diff-page-06.png（状态页选中 `src/app.ts` → 展开 hunk：正文为 `@@ -4,4 +4,9 @@ export const APP_VERSION = '1.0.0';` + 空格上下文行 + 5 个 `+` 行 + `\ No newline at end of file`，与 CLI `git diff` 逐行一致；通道实测 `GET …/diff/patch?file=src%2Fapp.ts&staged=false` → 200） | |
| F-035 | 大 diff 分块流渲染（DiffStreamView） | 打开 `rebased-smoke-big` 大文件 diff → 等待全文 | 先语言 diff 只读渐进累积分块 → 全文到达切换标准视图 | ✅ | diff-page-07.png（大仓 `big.txt`：网络实测同时走 `…/diff?file=big.txt&staged=false` 与 `…/diff/stream?file=big.txt&staged=false`；流侧实收 **2 个 `diff.chunk` 帧**（16724 + 53320 字符，wire 75020 B）渐进累积，全文到达后切标准 Monaco diff 视图（620 行改写：左 `rewritten for large diff streaming` / 右 `working tree rewrite（大 diff 常驻）`）） | |
| F-036 | word diff/同步滚动/未变更区折叠（上下文行数） | 逐一切换「空白字符/上下文行数」选项并滚动 | 词级高亮内建；双侧联动滚动；未变更区只展开改动附近（默认 5 行上下文） | ✅ | diff-page-08.png（大仓 `big.txt`：词级高亮内建（44 `char-insert` + 44 `char-delete` 与行级装饰并存）；左栏滚到 2400px 后**两侧同显第 127~170 行**（联动滚动）；`hunks.txt` 上实测「上下文 5 行」→ 可见行 1-10/30-41（11-29 收缩），切「上下文 2 行」→ 可见行 3-7/33-37（仅变更区 ±2）；「空白字符」切「空白显示」后可见空白符号）。**2026-09-16 口径修订**：原先那个「折叠」勾选框（接 Monaco `folding`）已删除——本仓无折叠区提供者、实测无任何可见效果；未变更区折叠由「上下文行数」独占表达（见 §5.31 3.1） | |
| F-037 | 三版本对比（本地/暂存/HEAD） | StatusPage 行「三版本」→ `/diff?three=1` | 两段对比（HEAD→暂存、暂存→工作区）；单维差异另段「无差异」 | ✅ | diff-page-09.png（`src/app.ts` 行「三版本」→ `?file=src%2Fapp.ts&three=1`：`three-way-head-staged` 段标「无差异」（该文件无暂存改动）、`three-way-staged-working` 段 5 处插入（= 工作区改动）；与 CLI（`git diff --cached` 空 / `git diff` 5 插入）一致） | |
| F-038 | 与分支比较（hunk 应用/回退经 StatusPage 通道） | BranchPanel 行「比较」→ 日志页对比视图 | 双 range 双向提交差异视图正确（hunk 应用/回退通道见 F-042） | ✅ | diff-page-10.png（分支页 `diverge-test` 行「比较」→ `?compare=diverge-test`：视图标题「与分支 diverge-test 比较」，分区「分支独有」1 条 `3b0244b`、「当前独有」2 条 `8d65417`/`77e62c4`；与 CLI `rev-list --left-right --count master...diverge-test` = `2 1` 完全一致；当前分支 `master` 行「比较」按钮 `disabled`） | |

### 4.4 StatusPage（slug `status-page`；P2）

- **入口**：顶栏「状态」→ `/repos/:id/status`。
- **前置**：主仓置好 修改/暂存/未跟踪（含一个已忽略文件）；变更列表至少 1 个非默认。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-039 | 变更分组列表（已暂存/工作区/未跟踪） | 打开状态页观察分组 | 三组按 XY 码正确分组；已忽略文件不展示（CLI status 互证） | ✅ | status-page-01.png（三组 3/2/3：已暂存 `R src/feature-renamed.ts` / `A src/new-file.ts` / `M src/util.ts`；工作区 `D docs/gone.md` / `M src/app.ts`；未跟踪 `? crlf.txt` / `? scratch/` / `? untracked.txt`——与 `git status --porcelain=v1` 逐条一致；`ignored.log`（CLI `!!`，`check-ignore` 命中 `.gitignore:1:*.log`）**未展示**） | |
| F-040 | 变更列表子分组与管理 | 新建变更列表 → 行「移动到列表」→ 观察子标题分组 → 重命名/删除 | 非默认列表子标题分组；默认列表平铺；操作后 CLI 互证 | ✅ | status-page-02.png（「管理列表→新建列表」建「冒烟列表」→ `src/app.ts` 行「移动到列表」→ 工作区组出现子标题「冒烟列表（1）」，默认列表项 `docs/gone.md` 仍平铺；重命名对话框（`cl-rename-input`，标题「重命名列表」）改为「冒烟列表-改名」→ 子标题同步；删除该列表后**行回平铺**，CLI `config.json` 该仓 `changelists` 只剩 `default`（名「默认」）且 `assignments` 为空） | |
| F-041 | 文件级暂存/取消暂存/放弃修改 | 逐一点行内三按钮（暂存/取消/放弃） | 条目按状态分派 restore/clean；CLI status 每步互证 | ✅ | status-page-03.png（四步逐条 CLI 互证：① 工作区勾 `README.md` → 组级「暂 存」→ `M  README.md`；② 已暂存勾 `src/util.ts` → 「取消暂存」→ ` M src/util.ts`；③ 勾 `docs/gone.md` → 「放 弃」+ 确认框「放弃选中修改？不可恢复」→ 文件恢复（`docs/gone.md` 重新出现、D 态消失）；④ 勾未跟踪 `scratch/` → 「删除」+ 确认 → 目录被删、未跟踪 3→2。取证后已用 CLI 复位夹具（重删 `docs/gone.md`、重建 `scratch/todo.md`）） | |
| F-042 | hunk 级暂存（行内 hunk 选择） | 补丁预览按 hunk 勾选 → 暂存选中 | 仅选中 hunk 进暂存区（CLI `git diff --cached` 互证） | ✅ | status-page-04.png（大仓 `hunks.txt`（两 hunk）勾 hunk 1 → 「暂 存」→ CLI：`git diff --cached` **仅含第 5 行改动**（`-hunk line 5` / `+hunk line 5 CHANGED (hunk 1)`），工作区余第 35 行 hunk，`status` = `MM hunks.txt`；已暂存组 0→1、补丁预览自动重取为 1 个 hunk） | |
| F-043 | 行内补丁预览 | 选中文件 → 观察预览；变更文件后重选 | unified patch 渲染正确；staging/commit 后失效重取 | ✅ | status-page-05.png（hunk 展开后 unified 正文 `@@ -32,7 +32,7 @@ hunk line 31` + 3 行上下文 + `-hunk line 35` / `+hunk line 35 CHANGED (hunk 2)` + 3 行上下文；**失效重取**由 F-042 同一次实测覆盖：暂存 hunk1 后预览由 2 hunk 自动变为 1 hunk） | |
| F-044 | 提交框（message + amend/signOff/noVerify） | 填 message → 点提交 | 提交成功 → 框清空（key remount）；CLI log 出现新提交 | ✅ | status-page-06.png（提交信息「feat(smoke): 状态页提交冒烟（F-044）」→ 落盘 `4e875bb`，`git show --name-status` = `M README.md` / `R100 src/feature.ts→src/feature-renamed.ts` / `A src/new-file.ts`（与提交前暂存组三行一一对应）；提交框 value 清空、已暂存组 3→0） | |
| F-045 | 跳 DiffPage | 双击文件行（行内无「差异」按钮；单击只选中看补丁预览） | 跳 `/diff?file=` 且两侧正确 | ✅ | status-page-07.png（双击工作区 `src/util.ts` 文件名 → `/diff?file=src%2Futil.ts`（默认「工作区」模式）、4 处插入 = CLI `git diff --stat -- src/util.ts` 的 `4 insertions(+)`） | |
| F-046 | 未跟踪行「忽略」一键入口 | 未跟踪行「忽略」→ Modal.confirm | `.gitignore` 追加该路径；行消失；重复操作幂等（CLI） | ✅ | status-page-08.png（未跟踪 `untracked.txt` 行「忽略」→ 确认框「忽略文件? 将给 .gitignore 追加 /untracked.txt 行」→ 确定：CLI `.gitignore` 末尾出现 `+/untracked.txt`、`M .gitignore` 进入工作区组（2→4 行）、该文件从未跟踪列表消失；**幂等**：再 `POST …/ignore/add {path}` 两次均 200 且 `/untracked.txt` 行计数仍为 1） | |
| F-047 | 三版本对比入口 | 行「三版本」按钮 | 跳 `/diff?file=&three=1` 三版本视图 | ✅ | status-page-09.png（工作区 `src/util.ts` 行「三版本」→ `/diff?file=src%2Futil.ts&three=1`；`three-way-head-staged` 段标「无差异」、`three-way-staged-working` 段 4 处插入，与 CLI（`git diff --cached` 空、`git diff` 4 插入）一致） | |
| F-048 | Create Patch from changes | 勾选 ≥1 文件 → 组级「创建补丁」→ Modal 输入名 | 成功跳 `/patches` 且列表含新补丁（CLI） | ✅ | status-page-10.png（勾 `src/app.ts` + `src/util.ts` → 组级「创建补丁」→ Modal「对勾选的 2 个文件创建补丁（工作区 diff）」输入 `smoke-changes` → 跳 `/patches` 且列表 1 项「smoke-changes 764 B」；CLI：`~/.rebasedjs/patches/f761a9f6-…/smoke-changes.patch` 764 B，首行 `diff --git a/src/app.ts b/src/app.ts`） | |
| F-049 | Shelve Changes | 页头「搁置」→ Modal 输入名 | 成功跳 `/shelves` 且列表含新搁置（CLI） | ✅ | status-page-11.png（页头「搁置」→ 名称 `smoke-shelf-1` → 跳 `/shelves`，列表 1 项「smoke-shelf-1 \| 2 个未跟踪」；CLI：`~/.rebasedjs/shelves/f761a9f6-…/smoke-shelf-1/` 含 `patch.diff` 1129 B + `untracked/crlf.txt` + `untracked/scratch/todo.md`；搁置为**快照复制**——保存后 `git status` 工作区逐条不变） | |
| F-050 | Stash Files | 页头「存入贮藏」→ Modal 填可选信息 | 成功跳 `/stashes` 且列表含新 stash（CLI `stash list`） | ✅ | status-page-12.png（页头「存入贮藏」→ 信息 `smoke stash from status page` → 跳 `/stashes`，列表 3 条；CLI：`stash@{0}: On master: smoke stash from status page` 置顶，工作区已跟踪改动全部清空（仅余未跟踪），`.gitignore` 的忽略行随之回到未忽略态） | |
| F-051 | Annotate / Show History 入口 | 行「注解」→ 返回后行「历史」 | 「注解」→ `/blame?file=`；「历史」→ `/history?file=` | ✅ | status-page-13.png（工作区 `src/app.ts` 行「注解」→ `/blame?file=src%2Fapp.ts`；返回后行「历史」→ `/history?file=src%2Fapp.ts` 列出 2 条 `77e62c4` / `f55c880`，与 CLI `git log --oneline -- src/app.ts` 逐条一致） | |

### 4.5 CommitDialog（等效内嵌提交框；slug `commit`；P2）

- **入口**：StatusPage 内嵌提交框（审计口径：模态形态未做，提交框为定案等效形态）。
- **前置**：主仓已配身份；另备一个未配身份的空仓验证身份预检；GPG 行依赖本机 gpg；CRLF 行依赖 Windows。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-052 | 提交（信息必填/身份预检） | 未配身份仓提交 → 观察引导；主仓填 message 提交 | 未配身份 → 引导去设置页提示；正常提交成功（CLI） | ✅ | commit-01.png（在 `rebased-smoke-noident`（未配 user.name/email、暂存 `A a.txt`）填信息提交 → 红 toast「未配置 user.name 或 user.email，请先在设置页配置」，仓库无新提交；同端点直调亦 400 `INVALID_QUERY` 同文案）→ 主仓提交 `660e7c7` 成功（`git log -1` 作者 Smoke Tester） | |
| F-053 | amend（改上次提交） | 勾选 amend + 新 message → 提交 | 上次提交 message 被替换、无新提交（CLI log 互证） | ✅ | commit-02.png（先暂存 `src/util.ts` 探针改动 → 勾 amend + 新信息「feat(smoke): amend 后的新信息（F-053）」→ 提交：`rev-list --count` 11→11（无新提交）、`git log -1` = `5887f10` 信息被替换、`git show --name-only HEAD` = `src/app.ts` + `src/util.ts`（新暂存内容并入该提交）；提交框清空、amend 复选框随重挂载复位） | |
| F-054 | sign-off / 跳过 hooks | 勾选 sign-off 提交 | log 见 Signed-off-by；noVerify 经 hook 仓验证（可跳过+理由） | ✅ | commit-03.png（① 勾 signOff 提交 → `git log -1 --format=%B` 含 `Signed-off-by: Smoke Tester <smoke@example.com>`（`5e203ea`）；② 装 `.git/hooks/pre-commit`（打印「F-054 pre-commit hook: 拒绝提交」并 `exit 1`）→ 不勾 noVerify 提交：toast「git 命令失败：git commit -m … 退出码 1：F-054 pre-commit hook: 拒绝提交」且 `rev-list --count` 不变（被拒）；勾 noVerify 后同一提交成功 `719b984`；取证后已删除该 hook） | |
| F-055 | amend 历史提交（amend 到…） | 提交框「amend 到…」下拉选目标 → 提交 | 目标提交信息重写、中间提交重放（CLI log 互证） | ✅ | commit-04.png（「amend 到…」候选 = **未发布提交** `origin/master..HEAD` 五笔；选最老候选 `fix(core): 合并后修正启动横幅` → 目标被重写为 `5b64383`（信息替换为「…（F-055 amend 到历史提交后）」且并入 `A f055-folded.txt` + `M src/app.ts`），其后 5 笔中间提交（SSE/F-044/F-053/F-054×2）全部重放为新 hash，提交总数 13 不变、无 `.git/rebase-merge` 残留。**过程与边界**：首次以 `src/app.ts` 为载荷时因该文件被中间提交改过而 rebase 冲突 → 自动跳 `/conflicts`（属正确行为）；中止后仓库停在「新提交已落在 tip」的中间态（见 §5.17 P-12），改用新增文件为载荷后一次通过） | |
| F-056 | GPG 签名 / commit template | 设置页配 `commit.template` 等白名单键 → 提交 | 提交链路正常不受扰（CLI config 互证；gpg 签名依赖本机密钥，否则跳过） | ⏭ 跳过（gpg 部分）｜✅（template 部分） | 本机无 gpg（`Get-Command gpg` 不存在）→ 签名提交跳过；已完成：设置页 `commit.template` 行填入 `.gitmessage` → 保存 → CLI `git config --local --get commit.template` = `.gitmessage`，随后提交链路正常（`53047d3`） | |
| F-057 | CRLF 提示（三选 Modal） | Windows 下暂存 CRLF 文件 → 点提交 | 内联警告 + 三选 Modal（修复并提交/原样提交/取消）；非 Windows 跳过+理由 | ✅ | commit-06.png（暂存夹具的 CRLF 文件 `crlf.txt` 后点提交 → Modal「检测到 CRLF 行尾符」：说明文案 + 三选「修复并提交 / 原样提交 / 取消」→ 选「原样提交」后提交落盘 `996030d`、`git show --name-only HEAD` = `crlf.txt`） | |
| F-058 | commit & push（提交并推送） | 提交框「提交并推送」 | commit 先落盘 → push 当前分支上游；pushed/up-to-date/rejected 三态提示正确（CLI 远端互证） | ✅ | commit-07.png（**收尾重拍版**：截图拍到 toast「已提交并推送」+ 已暂存（0）/工作区（0）归零 + 提交框清空；该次走的是当前分支 `rebase-topic`（有上游），CLI：本地 = 远端 = `be95d0e`、`rev-list --left-right --count origin/rebase-topic...rebase-topic` = `0 0`）。**首轮（master 路径）证据**：「提交并推送」→ 本地 `d5ab22d` 与裸远端 `smoke-remote` 的 HEAD **同 hash**、`origin/master...master` = `0 0`、`status -sb` 无进出；再以「回执探针」复跑一次同样 `0 0`（`20fd3f7`）。注：重拍后主仓的 `master` 仍落后其自身远端 5 个提交（F-074 等批次遗留，与本次操作无关），而 `rebase-topic` 与其上游 0/0 | |

### 4.6 ResetDialog（slug `reset`；P2）

- **入口**：LogPage 详情面板或提交行右键「Reset 当前分支到此处」（同一「重置到」内嵌模态）；Undo Commit 走顶栏 Popconfirm。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-059 | Reset soft / mixed / hard | 详情面板「Reset 当前分支到此处」→ 依次三模式执行 | 各模式行为正确（soft 留暂存/mixed 留工作区/hard 全清；CLI 互证） | ✅ | reset-01.png（对 `HEAD~1`（`d5ab22d`）依次三模式：**soft** → `M  README.md`（暂存保留）；**mixed** → ` M README.md`（工作区保留、暂存清空）；**hard** → 工作区干净且 `README.md` 回 HEAD 版本（F-058 探针行被丢弃）；hard 模式弹窗内出现「我了解 hard 将丢弃未提交改动」勾选门，未勾选时「确 定」为 disabled） | |
| F-060 | Reset Current Branch to Here（等价入口） | 详情面板按钮 → 内嵌模态弹出 | 模态正常弹出（右键菜单形态未做，面板按钮为等价入口） | ✅ | reset-02.png（详情面板「Reset 当前分支到此处」→ 内嵌模态「重置到」：目标短 hash + 主题 `d5ab22d docs(smoke): 提交并推送冒烟（F-058）` + 三模式单选（mixed 为默认）） | |
| F-061 | Undo Commit | 顶栏 Popconfirm → 确认 | soft reset HEAD~1，改动回暂存区（CLI） | ✅ | reset-03.png（顶栏「撤销最近提交」→ Popconfirm「将撤销最近提交并保留改动到暂存区」→ 确定：`git log -1` 由 `d5ab22d` 回退到 `996030d`，被撤销提交的改动以 `M  docs/new-name.md` 回到暂存区——soft reset 语义） | |

### 4.7 BranchPanel（slug `branch`；P2）

- **入口**：顶栏「分支」→ `/repos/:id/branches`。
- **前置**：主仓 master/feature/远程跟踪分支/标签/recent checkout；分叉场景行 F-070 需先构造远端分叉。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-062 | 分组（本地/远程/最近检出/标签）与过滤 | 观察四组 → 文本过滤 → 「仅看已合并」开关 | 四组正确；过滤与已合并开关生效 | ✅ | branch-01.png（**2026-09-12 按当前夹具重拍**：四组 = 最近检出 9 / 本地 12 / 远程 8 / 标签 3；文本过滤 `probe` → 最近检出 2/9、本地 2/12、远程 4/8（标签组 0 命中即整组不渲染），逐项吻合 CLI——本地 `f019-probe`/`rebase-probe-local` = 2、远程 `origin/fetch-probe`/`-r8`/`-r11`/`rebase-probe` = 4；「仅看已合并」→ 本地 7/12、远程 4/8 = CLI `git branch --merged HEAD`（7，含当前分支 `rebase-topic`）与 `git branch -r --merged HEAD`（4），D-19 的远程侧未回归。R23 首轮记录的四组/过滤计数（本地 8、过滤 `feat` 等）属重建前的旧夹具，以本次实测为准；同图另可见工具栏过滤框已随面板统一为 small 档） | |
| F-063 | 行内信息（current/上游徽标/已合并图标） | 观察各分支行 | current 标记、ahead/behind 徽标、已合并绿勾正确 | ✅ | branch-02.png（`master`「当前」+ 上游徽标 `origin/master ↓2` + 已合并绿勾；绿勾集合与 CLI `--merged` 完全一致；未合并的 `diverge-test` 无勾） | |
| F-064 | 创建/删除/重命名/设上游 | 新建 Modal（起始点 + 检出开关）→ 删除（未合并 Popconfirm force 提示）→ 重命名 → 设上游 | 各操作 CLI `branch` 互证 | ✅ | branch-03.png（建 `smoke-created@diverge-test`（`3b0244b`）→ 改名 `smoke-renamed`（旧名 `show-ref` 失败）→ 设上游 `origin/master`（`config branch.*.merge=refs/heads/master` 落盘）→ 未合并分支删除 Popconfirm「该分支未合并，删除将使用强制删除」→ 确认后分支消失；四步 CLI 互证） | |
| F-065 | 检出三态（既有/新建并检出/detached） | 检出既有分支 → 新建并检出 → 标签行「检出」（detached） | 三态切换正确（CLI HEAD 互证） | ✅ | branch-04.png（三态：检出既有 `diverge-test` → `HEAD=3b0244b`；「新建并检出」`smoke-new-checkout` 入最近检出；标签 `v1.0` 检出 → CLI `## HEAD (no branch)` 指向 `761961d`，界面该行无「当前」标记） | |
| F-066 | 查找已合并 / 清理已合并与过时分支 | 开「仅看已合并」→ 「清理已合并（N）」批量删除 | 批量删除非当前已合并分支（CLI 互证） | ✅ | branch-05.png（**修复后实测**：按钮「清理已合并（5）」→ 确认框「清理 5 个已合并分支？不可恢复」→ 实际恰好删除 5 个 → 绿色回执「已清理 5 个已合并分支」，按钮回落「清理已合并（0）」并禁用；CLI（`git branch --merged` / `git branch -vv` / `git worktree list`）逐条互证「承诺集合 == 实删集合」。修复要点见 §5.20 D-40：候选集合在 ui 层单一来源（排除当前分支、worktree 占用者、**上游领先者**），容器改为逐条容错 + 恒定回执——失败项的集合仍会出现在回执里（见 §4.7 口径）） |
| F-067 | 与当前分支比较 | 行「比较」→ 日志页对比视图 | 双 range 双向提交差异；「当前」分支禁用 | ✅ | branch-06.png（非当前分支「比较」→ `?compare=diverge-test`：分支独有 1 / 当前独有 8，与 CLI `rev-list --left-right --count master...diverge-test` 的 `8 1` 完全一致；当前分支 `master` 行「比较」为 disabled） | |
| F-068 | 与工作树差异 | 行菜单「与工作树差异」→ 差异 Modal → 文件行 | 清单含未提交变更、R/C 带 renameFrom；文件行 → `/diff?from=<分支>` | ✅ | branch-07.png（行菜单「与工作树差异」（`wt-branch`）→ 模态清单 9 个文件，含 `R100 src/feature.ts → src/feature-renamed.ts` 的 renameFrom 呈现，与 CLI 逐一一致；点 `src/app.ts` → `/diff?file=src%2Fapp.ts&from=wt-branch`，左 7 行/右 13 行 = CLI `--numstat` 的 6 增 1 删。**数字口径**：本轮工作区已干净，故是 6 增 1 删而非旧记录的 17 增——D-21 的语义（左侧取分支而非 HEAD）仍被区分：未修复时会显示 0 差异） | |
| F-069 | 弹窗 Fetch | 页头「Fetch」 | fetch 全部远程 → refs.changed → 列表刷新（CLI 远端互证） | ✅ | branch-08.png（先在裸远端推入 `fetch-probe`（`aadeb37`）→ 页头 Fetch → 远程组 2→3 出现 `origin/fetch-probe`；CLI `refs/remotes/origin/fetch-probe` = `aadeb37`，与远端同 SHA） | |
| F-070 | force-push 后修复 | 构造远端分叉 → 行内「force-push 修复」 | fetch → 本地重置到上游 → 本地独有提交 cherry-pick 重放（CLI 互证） | ✅ | branch-09.png（构造分叉：远端 `master` 强推改写为 `a91ade7` + 本地 3 笔（`7d4190a`/`7a4bc30`/`56eadea`）→ 行内「force-push 修复」→ 确认框说明「重置到上游 + 重放本地独有提交」→ toast「已重置并重放 3 个本地提交」；CLI：`master` = `a91ade7` + 3 笔、`rev-list --left-right --count` = `3 0`、无 `.git/sequencer` 残留、工作区干净） | |
| F-071 | 检出并变基到当前 | 远程行下拉「检出并变基到当前」（本地名 Modal） | 检出（远程 → 新本地分支）→ rebase onto 原当前分支（CLI） | ✅ | branch-10.png（**夹具纠偏**：旧夹具的 `origin/fetch-probe` 与本仓 `master` 无共同祖先（CLI `master...origin/fetch-probe: no merge base`），照原样跑必然整段重放并与子模块路径冲突，故先 `git rebase --abort` 复原，再另造干净远端分支 `origin/rebase-probe`（= origin/master + 1 提交 `9743264`）→ 远程行菜单「检出并变基到当前」→ 本地名 Modal → 新分支 `rebase-probe-local` 检出；CLI：HEAD 为该新分支、原 `master` 是其祖先、远端提交重放其上（`25131f7` 的父 = `56eadea`）） | |
| F-072 | 检出并更新 | 本地行菜单「检出并更新」 | 检出 → fetch 跟踪分支 + 策略更新；up-to-date →「已是最新」（CLI） | ✅ | branch-11.png（`master` 行菜单「检出并更新」→ 检出 master + fetch 跟踪分支；已同步 → toast「已检出 master（已是最新）」；CLI `## master...origin/master [ahead 3]`（`3 0`，无 behind）） | |

### 4.8 MergeDialog（slug `merge`；P2，页面化）

- **入口**：顶栏「合并」→ `/repos/:id/merge`（open 常驻，取消 = 返回日志页）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-073 | 合并方向选择 | 打开合并页观察两组列表 | 本地分支（排除当前）+ 远程分支（origin/xxx）两组齐全 | ✅ | merge-01.png（选择器两组：本地 7 个（当前分支 `master` 已排除：diverge-test、f019-probe、rebase-probe-local、smoke-new-checkout、stash-branch-f083、tmp-refs、tmp-refs2 等）+ 远程 4 个（origin/feature、origin/master、origin/rebase-probe、origin/fetch-probe）） | |
| F-074 | merge 策略 / commit 选项 | 选目标分支 → 勾 no-ff/squash/no-commit → 填信息 → 执行 | 成功返回日志页；CLI 互证合并结果与选项效果 | ✅ | merge-02.png（选 `diverge-test` + 勾 no-ff + 自填提交信息 → 执行成功回日志页；CLI：合并提交 `fb9833f` 有 **2 个父**（`56eadea` + `3b0244b`），`diverge-test` 成为 HEAD 祖先——no-ff 生效） | |
| F-075 | 进行中状态联动（中止/冲突跳转） | 用 `rebased-smoke-conflict` 合并 feature → 观察跳转 | 冲突 → 自动跳 `/conflicts`；进行中操作条提示 + 中止入口 | ✅ | merge-03.png（冲突仓在 master 上合并 `feature` → **自动跳 `/conflicts`**：四路冲突 AA `both-added.txt` / UD `deleted-by-them.txt` / UU `manual-merge.txt` / UU `shared.txt` + 各行的用我们的/用他们的/手动合并/完成合并 + 页内提示「合并进行中…」；CLI `MERGE_HEAD` = `5271e87`）；merge-03b.png（日志页操作条「合并中 + 中 止 + 去解决冲突」） | |

### 4.9 RebaseDialog（slug `rebase`；P3，内嵌 LogPage 模态）

- **入口**：更多「变基」（简单/交互双模式）。
- **前置**：交互行需多提交目标区间；冲突行用冲突仓。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-076 | rebase onto（目标基选择） | 更多「变基」→ 输入 onto → 开始 | 变基完成，log 图重排正确（CLI） | ✅ | rebase-01.png（更多「变基」→ 简单模式 onto=`master` → 「开 始」；CLI：`rebase-topic` 的两笔重放到 `master` 之上（`1e4a222`/`e4ac279`），`master` 成为 HEAD 祖先） | |
| F-077 | 交互式列表（pick/reword/squash/fixup/drop + 上移/下移） | base 输入 → 观察 todo 列表 → 改动作 → 上移/下移 | 列表正确；首行禁上移、末行禁下移；无效 base 显式报错 | ✅ | rebase-02.png（交互模式 base=`HEAD~2` → todo 两行；**首行「上移」禁用、末行「下移」禁用**，下移后顺序互换且禁用态随位置迁移；动作下拉 5 项 pick/reword/squash/fixup/drop；非法 base → 弹窗内 `rebase-todo-error` 显式报错（文案为 git stderr：`fatal: ambiguous argument 'no-such-ref-f077..HEAD'`）） | |
| F-078 | continue / abort / 冲突联动 | 冲突仓交互变基 → 解决 → 「完成合并」；另测 abort/skip | continue 泛化成功回日志页；abort 经操作条；skip 丢弃当前继续（CLI） | ✅ | rebase-03.png（冲突仓变基冲突 → 页内「变基进行中…继续变基」+「跳 过」；**跳过**：Popconfirm「跳过当前提交（其变更将被丢弃）？」→ rebase 结束、该提交被丢弃（分支停在 master tip）；再造冲突后用「用他们的/用我们的」解决 4 个文件 → 「继续变基」→ `88d2bd3` 重放于 `f5fdef8` 之上、工作区干净；**中止**经日志页操作条 Popconfirm → 回到 `5271e87`、无 rebase 残留） | |
| F-079 | auto-squash / fixup、squash by subject | 暂存内容 → 行右键「Fixup Commit」→ 折入 | `fixup!/squash!` 提交折入目标、信息=目标原文（CLI） | ✅ | rebase-04.png（暂存内容 → 行右键「Fixup Commit」→ 确认框 → 折入目标 `0be02ce`：目标现含 `f079-fixup.txt`、**信息仍为目标原文**，其后提交重放为新 hash） | |
| F-080 | 单提交编辑直通（reword/drop/squash/fixup） | 行右键逐一执行（reword 经 Modal 收集新信息） | 各动作落盘正确（根提交无父 → INVALID_QUERY 提示）（CLI） | ✅ | rebase-05.png（四动作逐一落盘：**drop**（C4 移除且其文件消失）、**reword**（Modal 预填目标信息 → 写新信息）、**squash**（C5 并入父：两文件合一、信息合并、提交数 -1）、**fixup**（C6 并入父：保留父信息）；根提交 squash → 400 `INVALID_QUERY`「squash/fixup 目标须有父提交（当前分支历史内）」且仓库分毫未动） | |

### 4.10 StashPanel（slug `stash`；P2）

- **入口**：顶栏「贮藏」→ `/repos/:id/stashes`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-081 | stash save（message/-u/--keep-index） | 页内「保存贮藏」卡片（内联表单，非弹窗）→ 填说明 → 勾「包含未跟踪文件」/「保持暂存区」 | stash 入列，选项生效（CLI `stash list`/`stash show` 互证） | ✅ | stash-01.png（说明 `smoke-stash-f081` + 勾「包含未跟踪文件」+「保持暂存区」；CLI：`stash@{0}: On …: smoke-stash-f081`、`git stash show -u --stat stash@{0}` = `README.md` + `.gitmessage` + `scratch/todo.md` + `untracked.txt`（未跟踪确实随档）；且 `git status` 仍为 `M  README.md`——keep-index 生效、暂存区保持不动） |
| F-082 | pop / apply / drop | 行内 pop → 再 apply → drop（Popconfirm） | 行为正确（pop 移除、apply 保留、drop 删除；CLI 互证） | ✅ | stash-02.png（① apply：条数不变且内容落盘；② pop：Popconfirm「确定弹出 stash@{0}？弹出后将移除该贮藏」→ 6→5 且落盘；③ drop：Popconfirm「确定删除 stash@{0}？」→ 5→4 且内容**不**入工作区；三次 CLI 逐次互证） |
| F-083 | stash as branch | 行「转分支」Modal → 执行 | 新分支出现且 stash 消费（CLI `branch` 互证） | ✅ | stash-03.png（分支名 `stash-branch-f083`；CLI：`HEAD` = `stash-branch-f083`（已检出）、该贮藏被消费（`stash list` 少一条）、工作区出现贮藏内容） |
| F-084 | Unstash As 对话框 | 行「Unstash As…」→ 选目标本地分支 → 执行 | 检出目标分支 + apply，不 drop（CLI） | ✅ | stash-04.png（选目标本地分支 → 顶部绿条「已检出 `unstash-target-2` 并应用贮藏」；CLI：HEAD = `unstash-target-2`、贮藏内容落盘、**贮藏未 drop**（条数不变））；stash-04b.png（对话框选分支过程）。注：目标分支与贮藏基点不一致时走 409 冲突提示且贮藏保留 |
| F-085 | 查看差异 | 行「查看差异」Modal | `git stash show -p` unified 补丁正确展示 | ✅ | stash-05.png（「贮藏差异：stash@{1}」Modal 全文补丁，与 CLI `git stash show -p stash@{1}` 逐行一致：`index 085be41..d38fe37`、hunk `@@ -9,3 +9,4 @@`、`+F-081 keep-index probe line`；修复 D-25 前此处正文恒空白） |

### 4.11 TagPanel（slug `tag`；P3）

- **入口**：更多「标签」→ `/repos/:id/tags`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-086 | 创建标签（含附注） | 创建 Modal → name + ref（默认 HEAD）→ message 非空即附注 | 列表出现新标签；附注/轻量区分正确（CLI `tag` 互证） | ✅ | tag-01.png（建附注标签 `v9.9.9-smoke`（列表带「附注」徽标 + 附注全文）与轻量标签 `v9.9.9-light`（ref 填 `HEAD~2`）；CLI `for-each-ref`：前者 `objecttype=tag`→`fb9833f`（=当时 HEAD），后者 `objecttype=commit`→`7a4bc30`（=HEAD~2），`tag -l -n1` 附注正文一致）；tag-01b.png（创建对话框填写态） |
| F-087 | 删除标签（本地/远程） | 行内 Popconfirm 删除本地 → 再测「删除远程」 | 本地删除成功；删除远程 = push 空 ref（CLI 远端互证） | ✅ | tag-02.png（本地删 `v9.9.9-light` → 列表 3→2、CLI `tag -l` 同步；「删除远程」确认框「确定从远程删除标签 v9.9.9-smoke？」→ toast「已删除远程标签 v9.9.9-smoke」、`ls-remote --tags origin` 不再含该标签而**本地标签保留**。注：D-26 未见回归） |
| F-088 | 推送标签（单个/全部） | 行内推送单个 → 页头「推送全部」（Popconfirm） | 远端出现标签（CLI `ls-remote` 互证）；认证回路正常 | ✅ | tag-03.png（单推 `v9.9.9-smoke` → 远端仅该 ref（含 `^{}` 解引用行）；「推送全部标签到远程仓库？」→ 远端 = `v1.0` + `v9.9.9-light` + `v9.9.9-smoke`。注：D-27 未见回归；本机为 file:// 裸远端，认证回路（token 注入）由 F-092 同级通道与 api 单测覆盖） |

### 4.12 RemotePanel（slug `remote`；P3）

- **入口**：更多「远程管理」→ `/repos/:id/remotes`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-089 | 远程添加/删除/编辑 | 添加新远程 → 编辑 setUrl（同写 fetch/push）→ 删除（Popconfirm） | 各操作正确（CLI `remote -v` 互证） | ✅ | remote-01.png（添加 `smoke-aux` → `file:///…/smoke-remote-aux`，编辑改为 `…-aux2`；CLI 逐步互证：`remote -v` 的双行（fetch/push）**同步改写**、删除确认「确定删除远程 smoke-aux？」后仅剩 `origin`） |
| F-090 | fetch（spec/全远程/单远程） | 顶部 fetch 全部 → 行内单远程 → 定制 spec | updatedRefs 展示 + `refs.changed` 推送列表刷新（CLI） | ✅ | remote-02.png（「Fetch 全部」→ 回执列出 updatedRefs（`origin/fetch-probe-r8`、`refs/tags/v9.9.9-light`）；行内单远程 → updatedRefs 为空；「定制 Fetch…」refspec `+refs/pull/9/head:refs/remotes/origin/pr-9` → CLI 建立 `origin/pr-9` = `5eb67ac`，与远端 `refs/pull/9/head` 同 SHA）；remote-02b.png（定制 spec Modal）。注：定制入口为 D-28 新增能力，本轮未见回归 | |
| F-091 | shallow 识别 / unshallow | 打开 `rebased-smoke-shallow` 远程页 → 观察徽标 → unshallow | 顶部「浅克隆（历史截断）」徽标；unshallow 后消失（CLI） | ✅ | remote-03b.png（浅克隆态：橙色「浅克隆（历史截断）」徽标 + 「解除浅克隆」按钮）→ remote-03.png（点击后徽标**即时**消失、按钮随条件卸载）；CLI：`rev-parse --is-shallow-repository` true→false、`rev-list --count` 1→7。注：徽标即时消失依赖响应 shallow 回写缓存（D-29）——本轮未见回归 |
| F-092 | HTTPS 认证对话框 / token 存储 | 向需认证远端操作触发 401（依赖外部凭据服务；否则跳过） | AuthDialog 弹出 → token 写回账户存储 → retry 重放成功 | ✅ | remote-04.png（**与 F-025 同一次实测、本轮复用未重拍**：本地恒 401 的 git smart-HTTP 服务 `http://127.0.0.1:9418/auth.git`，加远程 `auth-probe` 后日志页「更多→拉取」→ 401 `AUTH_FAILED` → AuthDialog「需要认证」（主机 `127.0.0.1`、账户/令牌输入框为空、界面不含 token）→ 填 `smoke-tester`/`smoke-token-f092` → 「保存并重试」；401 服务请求日志：首次 `auth=null` → 重放 `"auth":"Bearer smoke-token-f092"`（token 注入端到端证据）；`config.json` → `auth.accounts` 落盘该条目）。边界：服务恒 401，故以「重放确实发生且携带新凭据」为证；冒烟后已清理（远程与账户均删除并复验 `auth.accounts` 为 0 条） |

### 4.13 PushDialog（slug `push`；P3，内嵌模态）

- **入口**：更多「推送」。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-093 | push（远程/分支选择、setUpstream/forceWithLease） | 推送 Modal → 选远程 + 分支输入 → 默认勾 setUpstream → 推送 | 推送成功 + 上游设置落盘（CLI 远端互证） | ✅ | push-01.png（Modal：远程 `origin`、分支预填 `rebase-topic`、`set-upstream` **默认勾选**；CLI：远端新建 `rebase-topic`=`80b63f4` **与本地 HEAD 同 SHA**、`branch.rebase-topic.remote=origin` 与 `merge=refs/heads/rebase-topic` 落盘、`status -sb` = `## rebase-topic...origin/rebase-topic`）；push-01b.png（Modal 态） |
| F-094 | rejected push → 自动 Update 联动 | 分叉场景推送 → 观察自动弹 Update（merge/rebase）→ 选 merge | 更新成功自动续推原推送体；conflicts 引导解决（CLI） | ✅ | push-02.png（造分叉（远端 `d91794f` / 本地 `21efcbb`）后推送 → **自动弹**「推送被拒 — 更新项目」（merge 默认选中 / rebase 可选 / Reset to tracked）→ 选 merge → toast「更新并推送完成」；CLI：本地 = 远端 = `ed52e8f`，合并提交**双父** `21efcbb` + `d91794f`、两侧文件均在）；push-02b.png（被拒弹窗态）。冲突引导见 F-114~F-119 |
| F-095 | push tags / force-push 后修复（通道验证） | 验证两通道可达：TagPanel 推送全部、BranchPanel force-push 修复 | 两通道各自完成（证据同 tag-03/branch-09；本行截等效通道完成态） | ✅ | push-03.png（本行真跑 force-with-lease：amend 改写合并提交后本地 `5c7c07a` vs 远端 `ed52e8f` → 勾「force-with-lease：安全强推」→ toast「推送完成」、远端 `rebase-topic` 由 `ed52e8f` 改为 `5c7c07a` 与本地一致）；push-03b.png（勾选态）。标签通道证据 tag-03.png（F-088）、分支面板强推修复通道证据 branch-09.png（F-070） |

### 4.14 PullDialog（slug `pull`；P3，内嵌模态）

- **入口**：更多「拉取」。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-096 | pull（远程选择、rebase 选项） | 拉取 Modal → 选远程（分支随当前分支上游，无分支选择器）→ 勾 rebase → 拉取 | 拉取成功合入；rebase 模式生效（CLI 互证） | ✅ | pull-01.png（造分叉（本地 `d9e20e4` ahead 1 / 远端 `f1698e5` behind 1）→ 勾「使用 rebase 而非 merge」→ toast「拉取完成」；CLI：历史变**线性**——本地提交被重写为 `5f1f717` 并直接落在远端提交 `f1698e5` 之上、`rev-list --parents` 只有一个父、**未新增合并提交**）；pull-01b.png（Modal 勾选态）。**口径更正（实测）**：该 Modal **只有远端 Select**（`pull-remote-select`）+ rebase 勾选，**没有分支选择器**——分支取自当前分支的上游跟踪，行文「选远程/分支」应读作「选远程（分支随上游）」 |
| F-097 | fetch 全远程 / fetch spec 定制（通道验证） | 验证承载通道：RemotePanel 顶部 fetch 全部 + spec 定制 | 通道完成（同 remote-02 证据；本行截 RemotePanel fetch 成功态） | ✅ | pull-02.png（RemotePanel「Fetch 全部」成功态：toast「fetch 完成，更新 1 个引用」；CLI：UI fetch 建立 `origin/fetch-probe-r11` = `f1698e5`，与远端 `refs/heads/fetch-probe-r11` 同 SHA）。定制 spec 通道证据 remote-02.png / remote-02b.png（F-090） |

### 4.15 UpdateProjectDialog（slug `update`；P3，内嵌模态）

- **入口**：更多「更新项目」。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-098 | merge/rebase 策略选择 | 打开更新对话框 → 观察策略选项 | 二选一、默认 merge | ✅ | update-01.png（「更新项目」对话框：说明「更新方式（fetch 全部远程后合入当前分支）」，**merge 默认选中**、rebase 可选，并附「Reset to tracked：`rebase-topic` → `origin/rebase-topic`」说明） |
| F-099 | 更新会话（进度/结果汇总） | 执行更新 → 观察结果面板 | fetched 引用数 + pull 状态（updated 已合入/up-to-date 已最新）汇总；footer 变「关闭」 | ✅ | update-02.png（「更新结果」面板：`fetch 更新 1 个远程引用：refs/remotes/origin/rebase-topic` + 绿条「已合入当前分支」，footer 变「关 闭」；CLI：生成合并提交 `ca1efbc`（双父 `5f1f717` + `ab55a1b`），远端提交成为本地祖先）。P3 观察：结果渲染完成前有极短窗口 footer 同时存在「关 闭」与「确 定」，稳定后只剩「关 闭」，属渲染瞬时态、不计缺陷 |
| F-100 | Reset to tracked | 左下「Reset to tracked」→ Modal.confirm（danger） | reset --hard upstream、丢弃工作区/暂存（CLI）；无上游不渲染 | ✅ | update-03.png（危险确认框「Reset 到上游分支？」+「将丢弃 `rebase-topic` 的工作区/暂存变更，硬重置到 `origin/rebase-topic`；此操作不可恢复」（primary=danger）→ 确定；CLI：HEAD = `ab55a1b` = 上游、README 探针行消失、`f100-staged-probe.txt` 消失、`status` 仅剩 3 个未跟踪）。**无上游不渲染**：`rebased-smoke-big`（master 无 upstream、无远程）打开同一对话框时 `reset-to-tracked` 查无、说明也缺失 |

### 4.16 BlameWorkbench（slug `blame`；P3，三栏工作台）

- **入口**：更多「溯源」→ `/repos/:id/blame`；左栏（HEAD 文件树）选文件或页内「输入文件路径」框（两者都写回 `?file=`）；也可带 `?file=&select=&view=` 深链直达，旧 `?rev=<hash>` 读到即规范化为 `select=<hash>&view=annotate`。
- **形态**：左树（文件，固定看 HEAD）｜中栏（该文件的提交清单，`--follow`）｜右栏（操作条四出口 + 「本文件改动」/「与最新版本差异」/「逐行注解」三标签）；页面动作一律 replace 回写地址。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-101 | 注解展示（右栏「逐行注解」标签） | 左树点 `AGENT.md` → 切「逐行注解」→ 点第 8 行 | 行列表：行号/短哈希徽标/作者/日期/内容，按选中提交那一版列出；点行选中它归属的提交 | ✅ | blame-01.png（三栏总览（暗色）：左树选中 `AGENT.md`、中栏 12 条提交（首条 `b96148e` 派生选中、带 `data-selected="true"`）、右栏操作条 + 「本文件改动」Monaco 差异）；blame-04.png（「逐行注解」：点 `blame-line-7`（归属 `8536a91`）→ 地址变 `?file=AGENT.md&view=annotate&select=8536a916…`、该行选中数 1、**中栏同时高亮 `8536a91`**——这就是从「这一行是谁写的」直接跳到「那次提交改了什么」的主链路）。**互证**：`git log --follow --oneline -- AGENT.md` = **12 条**，与中栏条数一致（顶条 `b96148e`）；`git show -s 8536a91` = `fix(core): abort 陈旧 pid 守卫与未合并状态解析，AGENT.md 路径更新`，与注解行的短哈希归属一致 |
| F-102 | 选中提交级出口与点击联动（轮换旧「注解行内三联动」） | 中栏点第 2 条提交（`?select=` 变）→ 切「与最新版本差异」→ 逐条走操作条四出口 → 深链旧 `?rev=` | 「日志定位」→ 日志页选中该提交；「差异页」→ **新标签页** DiffPage（`from=父&to=该提交`，根提交 `root=1`）；「文件历史」→ `/history?file=`；「受影响」→ 全量变更文件 Modal。切标签只写 `?view=` 并只拉当前标签的数据 | ✅ | blame-02.png（「与最新版本差异」标签：右栏工具条与 Monaco 差异就位，`[data-testid="blame-view-latest"]` 真实渲染、**高 580 落在右栏 646 之内**——Task 6 的高度契约修复在浏览器里被证实）；blame-05b.png（旧 `?rev=` 深链规范化后的落点）：`?file=docs/manual.md&rev=8d6d961` → 地址被改写成 `?file=docs%2Fmanual.md&select=8d6d961&view=annotate`，落在「逐行注解」1519 行（web-next 同形）。**点选复现**：无 `?select=` 时首条派生选中（`blame-commit-0` 带 `data-selected="true"`），点第 2 条 → `?select=6e1807493cf0050e9178a4e4935a8d9427a60416`。**四出口齐备**以 `blame-action-log` / `blame-action-diff` / `blame-action-affected` / `blame-action-history` 四个 testid 全在盘为证（blame-01.png 同屏可见，见 §5.34 范围项 6）。**淘汰说明**：旧单列页的「行内哈希徽标 → 日志 `?select=`／行内「差异」／行内「历史」」三联动已随 `BlameView` 一并删除（提交 `c824bcd`），能力升格为本行的选中提交级四出口 |
| F-103 | Show All Affected（受影响文件） | 操作条「受影响」→ Modal 看清单 → 点文件 → Esc 关闭 | 提交全量变更文件 Modal；文件点击 → **新标签页**打开该文件在这次提交里的差异 | ✅ | blame-03.png（**根提交态**——选中根提交 `13a68f62…`（`.agent/AGENT.md` 的唯一提交）时点操作条「受影响」：「受影响文件（13a68f6）」Modal：**52 个文件行**（`affected-file-0…51`），状标全为 `A`，首行 `A .agent/AGENT.md`；Esc 可关。**互证**：`git show --name-only 13a68f62` 恰 **52** 条（含 `.agent/AGENT.md` 等），与清单逐条一致）。**降级口径**：该提交是根提交（`13a68f62…` 无父版本），清单里的文件点击走 `root=1` 分支——差异页只给提示行，与 F-102「差异页」同一三态出口 |
| F-104 | previousLineno 边界 | 抽查重命名/边界行注解 | 注解近似正确（orig 近似边界口径，抽查即可） | ⏭ 本轮未重跑（沿用 R10） | 本行本轮**未重跑**（见 §5.34⑤）：近似边界判据落在未改动的 `blame-annotate-table` 行渲染上，API 侧 `previousLineno` 对改动行给 1、3、未改动行给 null（R10 口径）。按 §1.2 的 ✅ 定义「界面 + CLI 互证 + 截图」三者缺一不可，本轮既没重走、旧单列图 `blame-04.png` 也已被三栏态同名覆盖 ⇒ **不判 ✅、如实记未重跑** |

### 4.17 HistoryPanel（slug `history`；P3）

- **入口**：更多「历史」→ `/repos/:id/history`，页内路径输入。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-105 | 文件历史列表 | 打开某文件历史 | 条目：短哈希 + subject + 作者 + 日期 | ✅ | history-01.png（`src/util.ts` 文件历史（3）：`4a05343` / `86962c0` / `f55c880` 各带 subject + 作者 + 日期，与 CLI `git log --format='%h \| %s \| %an \| %ad' -- src/util.ts` **逐条一致**——条目数随夹具推进增加，2026-09 复核为 3 条） |
| F-106 | 重命名跟随（`--follow`） | 打开被重命名文件的历史 | 改名前的提交同样列出 | ✅ | history-02.png（`src/feature-renamed.ts` → 文件历史（3）：`199ecaf`（改名本身）+ `e03962c` + `fc459ff`（原 `src/feature.ts` 的提交），与 CLI `git log --follow` 一致；而**不跟随**的 `git log -- <path>` 只有 1 条（`199ecaf`）——跟随生效） |
| F-107 | 版本 diff 联动 | 条目点击 → 双击 → 行内「Annotate」 | 点击 → 日志 `?select=`；双击 → DiffPage from/to；Annotate → `/blame?file=&rev=`（读到即规范化，落到三栏工作台的「逐行注解」标签） | ✅ | history-03.png（三条联动实测：① 单击 `86962c0` 条目 → `/repos/:id?select=86962c065a8a…`；② 双击同条目 → `/diff?file=src%2Futil.ts&from=199ecaf47…&to=86962c065a…`（Monaco 双侧已渲染）；③ **该图即此态**——点 `f55c880` 条目的「Annotate」→ `/blame?file=src%2Futil.ts&rev=f55c88022af…`，页面**真正加载该修订版本**：显示 **4 行**（= `git show f55c880:src/util.ts` 的 4 行），而非 HEAD 的 5 行。①② 以跳转后 URL + DOM 断言，图内为 ③）。**三栏重构后的落点**：同一个 `?rev=` 深链现在被规范化成 `?select=f55c880…&view=annotate`，落到三栏工作台右栏的「逐行注解」标签（浏览器实测见 §5.34 范围项 10/11 与其 `blame-05b.png`）。**边界**：`--follow` 列出的**改名之前**条目（该版本尚无此路径）点 Annotate 会以 500 `GIT_ERROR` 报错并直接显示 git 原文；追改名前的行归属请改用旧路径） |

### 4.18 CommittedChangesPanel（slug `committed`；P3）

- **入口**：更多「已提交」→ `/repos/:id/committed`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-108 | 按提交浏览已提交变更 | 打开页面 → 观察左栏 → 分页「加载更多」 | 提交列表左栏 + 分页正确 | ✅ | committed-01.png（**图为大仓翻页后态**：`rebased-smoke-big` 的「提交列表（50）」→ 点「加载更多」→「提交列表（100）」，行数 50→100（该仓 320 提交）——分页无法用 CLI 互证，故选它做截图；主仓侧以 DOM+CLI 互证：左栏「提交列表（26）」26 条短哈希+subject+作者+日期，与 `git rev-list --count HEAD` = 26 一致（**计数随夹具推进变化**：2026-09 复核该仓为 26 提交），首条 `4db0f92`、末条根提交 `56f751a`） |
| F-109 | 目录树组织变更文件 | 观察右栏目录树 | 目录节点 + A/M/D/R 徽标 + renameFrom；目录缺省展开可折叠 | ✅ | committed-02.png（选 `199ecaf` → 「变更文件（3）」：目录节点 `src` **缺省展开**，内含 `R src/feature.ts → feature-renamed.ts`（renameFrom 呈现）、`A new-file.ts`；根级 `M README.md`，与 CLI `git show --name-status` 一致。折叠实测：点 `src` 节点 → 文件行 3→1，再点恢复 3） |
| F-110 | 与 diff 查看器联动 | 点目录树文件 | 跳 `/diff?file&from=<hash>~1&to=<hash>` 两侧正确 | ✅ | committed-03.png（点 `README.md` → `/diff?file=README.md&from=5f6451617…&to=199ecaf…&files=["README.md","src/feature-renamed.ts","src/new-file.ts"]`；两侧互证：`git show 5f64516:README.md` **3 行** vs `git show 199ecaf:README.md` **5 行**（新增 `F-041 文件级暂存探针行`），页面左右两侧行数与内容一致） |

### 4.19 SearchPanel（slug `search`；P3）

- **入口**：更多「搜索」→ `/repos/:id/search`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-111 | 提交搜索（grep / pickaxe） | 双模式 Segmented 各搜一次；输入非法正则 | 结果列表正确；非法正则 → 400 提示 | ✅ | search-01.png（「信息 grep」搜 `smoke` → **15 条**（**计数随夹具推进变化**：2026-09 复核为 15 条），与 CLI `git log --grep=smoke` 的 15 条**逐条一致**；切「内容 pickaxe」搜 `staged new file` → 1 条 = `199ecaf`，与 `git log -S'staged new file'` 一致；非法正则 `[unclosed` → 面板红字「搜索表达式不是合法的正则表达式：[unclosed」）。**口径更新**：旧记录的 9 条与 pickaxe 词 `staged-only` 均系历史重写前的结果，现历史下分别为 15 条与 0 命中；search-01b.png（非法正则红字态）、search-01c.png（pickaxe 单条结果态，补证） |
| F-112 | 结果 → 日志页 | 点结果行 | 跳 `?select=<hash>` 且该行选中 | ✅ | search-02.png（点 pickaxe 的单条结果 `199ecaf` → `/repos/:id?select=199ecaf47568a14953509655da2d3e367e821c8c`，DOM 断言 `[data-selected="true"]` 命中 **1** 行（目标行选中）） |
| F-113 | 分支快速搜索 | 输入即滤本地分支 → 点行 | 检出并回日志页（quickswitch）；当前分支仅导航（CLI） | ✅ | search-03.png（输 `diverge` → 列表即时滤为 `diverge-test` 一项 → 点击 → 切回日志页 `/repos/:id`（无残留参数）且 CLI `rev-parse --abbrev-ref HEAD` = `diverge-test`（HEAD=`3b0244b`）；再点当前分支项 → 仅导航无副作用；冒烟后已用同一入口切回 `stash-branch-f083-r5b`）。**夹具口径**：旧记录的 `fetch-probe-local` 在现夹具中已不存在（本地 17 分支无 `fetch-*`），故改用 `diverge-test`；search-03b.png（quickswitch 落地后的日志页态，补证） |

### 4.20 ConflictsPanel（slug `conflicts`；P2）

- **入口**：`rebased-smoke-conflict` 合并/变基触发冲突自动跳入；或操作条「去解决冲突」。
- **前置**：冲突仓重新构造（master 与 feature 同区域修改）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-114 | 冲突文件列表 + 类型徽标 + 目录分组 | 观察列表 | stages 组合类型徽标正确；按目录子标题分组（带计数） | ✅ | conflicts-01.png（夹具四类冲突一次呈现：「冲突文件（4）」按「根目录（4）」分组；徽标与 `git status` 完全对应——`双方修改`=UU shared.txt/manual-merge.txt、`对方删除/我方修改`=UD deleted-by-them.txt、`双方新增`=AA both-added.txt；UD 行的「用他们的」禁用并额外提供「删除该文件」）**（R23 复跑：同一夹具四路冲突同屏，徽标与 CLI 逐条一致）** |
| F-115 | 整侧解决（ours/theirs/delete） | 行内 ours → 另文件 theirs → 另文件 delete | 对应侧禁用逻辑正确；解决后 CLI 互证 | ✅ | conflicts-02.png（shared.txt「用我们的」→ CLI 落盘 `master side`、脱离未合并；both-added.txt「用他们的」→ `feature version`；deleted-by-them.txt「删除该文件」（Popconfirm「确认以删除解决该冲突？」）→ 文件删除且暂存为 `D`；列表 4→1，`git diff --name-only --diff-filter=U` 同步收缩）**（R23 复跑：三侧解决路径均 CLI 互证，处理顺序 ours→theirs→delete）** |
| F-116 | 3-way 手动合并（MergeView） | 「手动合并」→ 全屏 Modal | 左 ours/右 theirs/底部结果编辑；保存 manual 策略（CLI） | ✅ | conflicts-03.png（「手动合并：manual-merge.txt」全屏 Modal：左「当前分支」ours=line1~3 master、右「合并来源」theirs=line1~3 feature、底部「合并结果」可编辑（Monaco）；编辑为 `line1 master / line2 feature / line3 resolved-by-hand` 后「保存」→ CLI 落盘逐行一致且该路径脱离未合并）**（R23 复跑：Modal 三栏（ours/theirs/结果）与保存落盘逐行一致）** |
| F-117 | 完成合并（continue 泛化） | 全部解决 → 「完成合并」 | merge/rebase/cherry-pick/revert 共用 continue → 回日志页（CLI） | ✅ | conflicts-04.png（冲突清零后「完成合并」可点 → 自动回日志页；CLI：生成合并提交 **`aa621c1 Merge branch 'feature'`**（旧记录的 `05a16f7`/`ec1320f` 系历史重写前结果）、`.git/MERGE_HEAD` 清除、`status` 干净、四项解决结果全部保留（shared=master side / both-added=feature version / manual=手动合并内容 / deleted-by-them 仍不存在））；conflicts-04b.png（完成合并后的日志页态，补证） |
| F-118 | 跳过（skip） | rebase 冲突 → 底部「跳过」（Popconfirm） | 丢弃当前变更继续后续（CLI）；merge 无 skip 按钮 | ✅ | conflicts-05.png（变基冲突时面板底部为「跳 过」+「继续变基」，面板提示「变基进行中：解决全部冲突后点击「继续变基」；中止请返回日志页操作条。」；图为**先解决一个文件（shared.txt 用我们的）后剩 3 个冲突**的态，用以与 `rebase-03.png` 的四冲突态区分）；点「跳过」→ 确认框「跳过当前提交（其变更将被丢弃）？」（`conflicts-05b.png`）→ CLI：`.git/rebase-merge` 清除、`feature` 落到 master 提交 `f5fdef8`、**被跳过的提交 `5271e87` 已不在历史**（`merge-base --is-ancestor 5271e87 HEAD` exit=1）、`shared.txt` 为 master 版本、工作区干净。对照：F-114~F-117 的 merge 冲突态**无**「跳过」按钮（仅「完成合并」） |
| F-119 | 合并状态联动 | 观察进行中提示与操作条 | 进行中提示页内可见；中止入口在 LogPage 操作条 | ✅ | **两种进行中态都实测**：① **merge 态**（`conflicts-06.png`，收官重拍）：冲突仓在 master 上合并 `feature` → 自动跳 `/conflicts` → 日志页顶栏橙色「**合并中**」+ 红色「中 止」+ 蓝色「去解决冲突」（rebase 态没有后者），面包屑为 `master`；截图时 CLI `status` = `AA both-added.txt / UD deleted-by-them.txt / UU manual-merge.txt / UU shared.txt`、`MERGE_HEAD` = `5271e876…`（= feature `5271e87`）；经界面「中 止」→ 确认框「确定中止当前操作？工作区将回到操作前状态」→ 确定：工作区 clean、HEAD `f5fdef8`、`MERGE_HEAD/MERGE_MSG/MERGE_MODE` 全不存在、无未合并项。② **rebase 态**（本轮早段实测）：顶栏橙色「变基中（第 1/1 步）」+「中 止」（API `/operation` 返回 `{kind:"rebase",step:1,total:1}`）→ 中止后 rebase 状态清除、分支回 `feature`（`5271e87`）、`shared.txt` = `line3 feature`、工作区干净；`conflicts-06b.png` 为**中止确认框**（本轮在同一 merge 态下点「中 止」的 Popconfirm：「确定中止当前操作？工作区将回到操作前状态」→ 确定后 CLI：工作区 clean、HEAD `f5fdef8`、`MERGE_HEAD/MERGE_MSG/MERGE_MODE` 全不存在、无未合并项）。冲突页内的提示随操作类型变化：「合并进行中：解决全部冲突后点击「完成合并」；中止请返回日志页操作条。」/「变基进行中：解决全部冲突后点击「继续变基」；…」（conflicts-01.png / conflicts-05.png） |

### 4.21 PatchPanel（slug `patch`；P3）

- **入口**：更多「补丁」→ `/repos/:id/patches`（创建也可从 StatusPage 组级入口）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-120 | 创建补丁（unified diff 三态导出） | 创建 Modal → 依次工作区/暂存/提交区间三态 | 列表出现补丁；三态内容正确（CLI 文件互证） | ✅ | patch-01.png（三态各建一枚且与 CLI **逐字节相同**（SHA256 全等）：`f120-worktree` 384 B = `git diff HEAD`；`f120-staged` 165 B = `git diff --cached`（只含 `f120-staged.txt`）；`f120-range` 328 B = `git diff HEAD~2 HEAD`（`local-f096.txt`/`remote-f096.txt` 两个新文件）；Modal 内「工作区/暂存/提交区间」三选一，提交区间展开起点/终点输入（`patch-create-from`/`patch-create-to`，可空默认 HEAD））；patch-01b.png（创建 Modal 态） |
| F-121 | 应用补丁（check 先行） | 应用已有补丁 → 再测空补丁 | `git apply --check` 先行；应用成功；空补丁 no-op；失败诚实报错 | ✅ | patch-02.png（重置工作区（`git reset --hard` + 清理）后应用 `f120-worktree` → 状态页显示 `工作区（1）README.md M` + `未跟踪（1）f120-staged.txt ?`，即 README 改动回写、`f120-staged.txt` 复原且内容一致（`staged probe for patch`）；**二次应用** → toast「补丁无法应用：error: patch failed: README.md:9」且 `--numstat` 保持 2/0（check 先行、零变更））；patch-02b.png（二次应用失败提示态）；空补丁另证：`f121-empty`（0 B）→ API 200 且 `git status --porcelain` 前后**逐字相同**（no-op） |
| F-122 | 补丁列表管理 | 观察列表 → 删除（Popconfirm）→ 重名创建 | 名/大小/时间齐全；删除成功；重名 → INVALID_QUERY 提示 | ✅ | patch-03.png（列表 5 项均带名称/大小/时间（含 0 B 的 `f121-empty` 与既有 `smoke-changes-r3`）；重名建 `f120-worktree` → toast「补丁已存在：f120-worktree」且**原补丁仍 384 B**（未被截断，D-31 未回归）；「确定删除补丁 f121-empty？」Popconfirm → 确认后文件消失（列表 5→4→3，磁盘 `patches/<repoId>/` 同步））；patch-03b.png（重名提示态） |
| F-123 | 导入补丁到搁置 | 行内「导入搁置」 | 成功跳 `/shelves`，同名搁置存补丁全文（CLI） | ✅ | patch-04.png（点 `f120-worktree`「导入搁置」→ toast「已导入搁置：f120-worktree」并跳 `/shelves`（图为落地后的搁置列表）；CLI：`shelves/<repoId>/f120-worktree/patch.diff` 384 B，与补丁 **SHA256 相同**（`3FD2C9D2…21C5`）、首行 `diff --git a/README.md b/README.md`） |

### 4.22 ShelfPanel（slug `shelf`；P3）

- **入口**：更多「搁置」→ `/repos/:id/shelves`（保存也可从 StatusPage 页头「搁置」）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-124 | 搁置保存（工作区+暂存+未跟踪随档） | 保存 Modal 输入名 | 列表出现搁置；内容含工作区+暂存 diff + 未跟踪文件（CLI） | ✅ | shelf-01.png（保存 Modal 输入 `f124-shelf`（testid `shelf-save-name`）→ 列表出现「3 个未跟踪」；CLI：`shelves/<repoId>/f124-shelf/patch.diff` **378 B** 与 `git diff HEAD` **逐字节相同**（SHA256 全等），`untracked/` 含 3 份原件（`f120-staged.txt` 23 B、`f124-untracked.txt` 20 B、`scratch/todo.md` 14 B）；搁置语义为**快照复制**——保存后 `git status --porcelain` 分毫不动）；shelf-01b.png（保存 Modal 态） |
| F-125 | 恢复 / 删除 | 行内 restore → 再 drop（Popconfirm） | 恢复回写工作区；同名冲突不覆盖；删除成功（CLI） | ✅ | shelf-02.png（**同名不覆盖两重实测**：① 工作区已有同样改动时点「恢复」→ 400「补丁无法应用：error: patch failed: README.md:9」（check 先行、`git status` 零变更；该错误**内联显示在 Popconfirm 内**而非 toast）；② 未跟踪同名文件（`f124-untracked.txt` 被改成 `MODIFIED AFTER SHELF`）→ 恢复后**保持用户版本**、未被存档覆盖；缺失的 `scratch/todo.md` 被回拷（内容 `- shelf probe`）；reset 后再恢复 → README + `f124-staged.txt` 完整回写（`f120-staged.txt` 亦从 `untracked/` 回拷）；「确定删除搁置 f124-shelf？」→ 目录移除、列表 3→2）；shelf-02b.png（恢复确认框态） |
| F-126 | Unshelve 联动 | restore 后回 StatusPage | 工作区变更自动进入状态页（events 刷新） | ✅ | shelf-03.png（双标签实测事件刷新（**第二轮取证**）：标签 1 停在 `/status`（已暂存 0 / 工作区 0 / 未跟踪 0）→ 标签 0 在 `/shelves` 恢复 `f120-worktree` 搁置 → **未刷新**标签 1 即变为 工作区（1）`README.md M` + 未跟踪（1）`f120-staged.txt`；同页 `performance.now()` 由 **6 s → 18 s** 证明未整页重载——SSE `repo.state-changed` 推送生效（服务端每 2 秒比对状态，有变化才推）。第一轮（恢复 `smoke-shelf-r3` → 工作区 1 + 未跟踪 3）为同法复现，本轮取其变体做唯一化） |

### 4.23 WorktreePanel（slug `worktree`；P4）

- **入口**：更多「工作树」→ `/repos/:id/worktrees`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-127 | 工作树列表 | 观察列表 | path/branch/detached 徽标 +「当前」标记（CLI `worktree list` 互证） | ✅ | worktree-01.png（三行与 CLI `git worktree list` 逐项一致：主工作树「当前」绿标 + `stash-branch-f083-r5b` + `4db0f92`；`rebased-smoke-wt` + `wt-branch` + `77e62c4`；另建分离头工作树 → 「分离」橙标 + `bf7794e`）。P3 观感：主工作树路径显示为反斜杠 `D:\…`（来自 repo 路径），其余来自 `git worktree list` 的为正斜杠 `D:/…`，同一列表两种风格 |
| F-128 | 工作树创建 | 创建 Modal → 互斥 Radio（关联已有/新分支） | 创建成功；仓库内/嵌套路径被阻止（CLI） | ✅ | worktree-02.png（Modal：「关联已有分支 / 创建新分支」互斥 Radio（切到后者后分支输入 testid 变为 `worktree-create-new-branch`）；新建 `rebased-smoke-wt-new` + 新分支 `wt-new-branch` → 列表 3→4（CLI `worktree list` 出现该行且目录已填充）；**仓库内嵌套路径**（`…\rebased-smoke\nested-wt`）→ 400「路径无效：D:\…\nested-wt」被拒且无副作用（两种模式各测一次，均 400 INVALID_QUERY））；worktree-02b.png（Modal 态） |
| F-129 | 移除 / 清理 | 行内移除（`--force` 支持）→ prune | 移除与清理正确（CLI） | ✅ | worktree-03.png（脏工作树（README 有未提交改动 + 未跟踪文件）移除：不带 force → **500**「移除工作树失败：fatal: 'D:/…/rebased-smoke-wt' contains modified or untracked files, use --force to delete it」且列表不变；在确认框勾选「强制移除（--force）」→ 列表 4→3、CLI `worktree list` 同步少一行且目录已删；手工删目录造成 prunable 条目 → 「确定清理失效工作树？」→ 列表 3→2、CLI 回到 2 行）；worktree-03b.png（确认框勾选态）。注：force 勾选框为 D-32 补的 UI 入口 |

### 4.24 SubmodulePanel（slug `submodule`；P4）

- **入口**：更多「子模块」→ `/repos/:id/submodules`。
- **前置**：主仓已 add 本地子模块。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-130 | 子模块状态列表（四态徽标） | 观察列表（含空格/点号路径） | 未初始化/已检出/提交漂移/冲突四态徽标正确（CLI `.gitmodules` 互证） | ✅ | submodule-01.png（四态**同屏**：`vendor/sub-module`「冲突」`0000000`、`vendor/dir.with.dots`「未初始化」`17512d9`（点号路径）、`vendor/ok-sub`「已检出」`150e186`、`vendor/drift-sub`「提交漂移」`9c9a9ae`；与 `git submodule status` 前缀 `U / - / 空格 / +` 逐一对应；API 侧返回 `conflict/uninitialized/checked-out/different-commit` 四值）。**夹具为可复现构造**：`git -c protocol.file.allow=always submodule add D:\zhanglei1120\Github\smoke-sub3 vendor/ok-sub` 造「已检出」、`smoke-sub4 → vendor/drift-sub` 内再提交一格造「漂移」、`vendor/sub-module` 用两条分叉分支各改 gitlink（`git update-index --cacheinfo 160000,…`）后 merge 得 `U`。跑完已 `merge --abort` + `submodule deinit` + `git rm` 移除四态夹具并复原 `.gitmodules`，`submodule status` 回到基线两行 |
| F-131 | 子模块更新（init/update） | 行内更新 → 全量（recursive Checkbox） | init/recursive 生效（CLI 互证） | ✅ | submodule-02.png（顶部「递归更新」Checkbox + 「更新全部」；行内「更新」作用于未初始化的 `vendor/dir.with.dots` → CLI：`submodule status` 由 `-17512d9` 转为 ` 17512d9 (heads/master)`、目录出现 `.git` 与 `index.js`、列表徽标转为「已检出」；勾「递归更新」+「更新全部」→ `vendor/drift-sub` 由漂移 `+9c9a9ae` 归位索引值 `0b08015`（`+`→空格）、列表刷新为「已检出」；已冲突的 `vendor/sub-module` 保持 `U`（gitlink 冲突非 update 可解））；submodule-02b.png（勾选态）。P3 观察：「更新全部」**非乐观刷新**——服务端逐个 `git submodule update` 耗时数秒，期间列表仍显示旧值（POST 返回后即正确，按钮有 acting 禁用态），取证须等 POST 落地 |

### 4.25 IgnoreDialog（slug `ignore`；P3）

- **入口**：更多「忽略」→ `/repos/:id/ignore`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-132 | 创建/编辑/模板（双 target） | 双 target 切换 → 模板替换预览（Node/Python/通用）→ 保存 | `.gitignore`/`.git/info/exclude` 写入正确（CLI 文件互证） | ✅ | ignore-01.png（编辑器 Modal：双 target Radio `.gitignore` / `.git/info/exclude`、模板 Select（Node.js/Python/通用）；① `.gitignore` 目标：追加 `f132-probe/` 保存 → CLI 该文件 **39→51 B** 且尾部出现该行；② 切 `.git/info/exclude` → 内容区**随之载入该文件原文**（240 B，切换即换文件）→ 三模板替换预览实测为 **Node.js 9 行 / 87 B**、**Python 13 行 / 139 B**、**通用 11 行 / 105 B**，存 Python → 该文件 **240→155 B、13 行**、首行 `# Python 字节码与虚拟环境`；两 target 互不影响，跑完已复位）。**口径更正**：内容区实为 antd `Input.TextArea`（rows=10），**不是**带行号的 Monaco（旧记录括注有误） |
| F-133 | 一键忽略文件/目录 | StatusPage 未跟踪行「忽略」→ Modal.confirm | 追加 `/path` 幂等；重复操作不重复写（CLI） | ✅ | ignore-02.png（状态页未跟踪行（`.gitmessage`）「忽略」→ 确认框「忽略文件? 将给 .gitignore 追加 /.gitmessage 行」→ 确定 → CLI `.gitignore` **51→64 B**、末行 `/.gitmessage`、该文件从未跟踪列表消失（**3→2**，同屏剩 `scratch/` 与 `untracked.txt`））；ignore-02b.png（确认框态）；**幂等**：同路径再 `POST …/ignore/add` → 200 且该行计数仍为 **1**。跑完 `.gitignore` / `.git/info/exclude` 均由备份复位为 39 B / 240 B |

### 4.26 GitHubPanel（slug `github`；P3）

- **入口**：更多「GitHub」（仅 github.com 形态远程才渲染；无 → 行 F-134 验证检测门后其余按跳过处理）。
- **前置**：F-136~F-139 需真实 github.com 远端 + PAT（Settings 账户卡片录入）；不具备 → 跳过+理由。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-134 | 检测门（远程形态才渲染） | 在非 github 仓看「更多」→ 再看 github 远程仓 | 非 github 仓不渲染该项；github.com 远程仓渲染 | ✅ | github-01.png（`rebased-smoke-clone` 加 `https://github.com/example/rebased-smoke.git` 远程后，「更多」菜单出现「GitHub 面板」（第 15 位）→ **17 项**）；github-01b.png（主仓为本地 file 远程 → 菜单 **16 项、无该项**）；`GET …/github/status` → `{detected:true, repo:{owner:'example', name:'rebased-smoke', remoteUrl:'https://github.com/example/rebased-smoke.git'}}`。跑完已移除该远程 |
| F-135 | 账户/token 认证 + 降级卡 | 打开面板（无令牌）→ 观察 → Settings 账户卡片录 PAT | 检测三态（远程+令牌）正确；无令牌 → 提示卡「去设置」；录 PAT 后回面板重检测 | ✅ | github-02.png（无令牌：卡 `[data-testid="github-auth-failed"]`「GitHub 认证失败 / 未配置 GitHub 令牌，请在设置中添加」+「去设置」，与 `GET …/github/prs` → 401 `AUTH_FAILED` 的 message **同文案**）→ 点「去设置」→ `/settings` 账户卡「添加账户」（testid `account-host-input`/`account-name-input`/`account-token-input`；主机 `github.com` + 账户 `smoke-probe` + 假 PAT）→ 账户行**仅掩码** `ghp_***` → 回面板**重检测**：卡片变为「**GitHub 认证失败：Bad credentials**」= API 401 同文案——证明令牌被读取并真的打到 github.com，失败点从「未配置」前移到凭据本身。冒烟后已删除该临时账户（`auth.accounts` 回到 0）；github-02b.png（**录假 PAT 后回面板重检测态**：卡片描述变为「GitHub 认证失败：Bad credentials」，非账户录入表单）。注：卡片文案取自服务端 message，为 D-33 修复口径 |
| F-136 | PR 列表/详情/时间线/评论 | 真实远端 → 列表点击选中 → 详情 + 时间线 tab → 发评论 | 时间线 issue comments + review summaries 合并（旧→新）；空评论拦截 | 跳过：需**真实 github.com 仓库 + 有效 PAT**（本轮复核边界：环境无 `GITHUB_TOKEN`/`GH_TOKEN`、无 `gh` CLI、无 `credential.helper`/`.git-credentials`；夹具远程 `example/rebased-smoke` 不存在，录假 PAT 后 github 实测返回 `Bad credentials`——失败点在凭据本身而非环境）。端点齐备（`github/prs`、`prs/N`、`timeline`、`files`、`comments`（GET 405，写端点）、`review`、`merge`、`checkout`），映射由 api/github 单测覆盖 | — |
| F-137 | PR 审查（approve/request changes） | 详情内审查 | reviewDecision 徽标正确 | 跳过：同 F-136（需真实 PR 与写权限 PAT） | — |
| F-138 | PR diff 视图 + 行级评论 | 文件行级视图 → 逐 hunk 观察 → 行级评论（新侧行号 Select + 发送） | 逐 hunk 两侧 MonacoDiffView + 绝对行号头行；评论线程按 hunk 挂靠并落地 | 跳过：同 F-136；HunkDiffView 的 hunk 解析/行级挂靠由 ui（github-panel.test.tsx）与 api 单测覆盖 | — |
| F-139 | 三种合并策略 + 检出 PR 分支 | merge/squash/rebase 各测 → 检出 PR | 三策略合并正确（warning 路径）；检出 = fetch `+refs/pull/N/head` + `checkoutNewBranch('pr-N')`（CLI） | 跳过：同 F-136。检出通道的 git 侧（`fetchRemote` 带 `+refs/pull/N/head` → `FETCH_HEAD` 指向目标提交）已在 core 单测实测（见 F-090 定制 refspec 同源能力） | — |

### 4.27 GitLabPanel（slug `gitlab`；P4）

- **入口**：更多「GitLab」（仅 gitlab.com 形态远程才渲染）。
- **前置**：F-141~F-144 需真实 gitlab.com 远端 + PAT；不具备 → 跳过+理由。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-140 | 检测门 + 账户认证 | 非 gitlab 仓 vs gitlab 远程仓入口；无令牌降级卡 | 检测门与降级卡同 GitHub 口径 | ✅ | gitlab-01.png（**无令牌降级卡态**：「GitLab 认证失败 / 未配置 GitLab 令牌，请在设置中添加 / 去设置」，与 `GET …/gitlab/mrs` → 401 `AUTH_FAILED` 的 message 同口径（D-33 修复后）；检测门实测为 `rebased-smoke-big` 加 `https://gitlab.com/example/rebased-smoke.git` 远程后「更多」菜单出现「GitLab 面板」（17 项）、`gitlab/status` → `{detected:true}`——该菜单态本行无独立截图，图中画面为面板降级卡。跑完已移除该远程） |
| F-141 | MR 创建/列表/详情/评论 | 新建 MR Modal（源/目标分支 + 标题 + 描述）→ 列表四徽标 → 详情时间线 → 评论 | 各环节正确；时间线 notes+reviews 合并 | 跳过：需**真实 gitlab.com 项目 + 有效 PAT**（同 F-136 边界，本轮复核无可用凭据；夹具远程 `example/rebased-smoke` 不存在）。MR 端点与 notes/reviews 合并映射由 api/gitlab 单测覆盖 | — |
| F-142 | MR diff 视图 + 行级讨论 | 行级视图 → 行级讨论（position new_path/new_line） | 与 GitHub 共用 HunkDiffView；讨论锚点与提交落地 | 跳过：同 F-141；共用 HunkDiffView 的渲染由 ui 单测覆盖 | — |
| F-143 | MR 审查 / 合并 | approve/request changes → merge（squash?） | 三映射端点正确；reviewState 徽标；合并成功 | 跳过：同 F-141 | — |
| F-144 | MR 检出 | 检出 MR | fetch `refs/merge-requests/:iid/head` + `checkoutNewBranch('mr-N')`（CLI） | 跳过：同 F-141。检出通道的 git 侧已由 core 单测实测（`fetchRemote` + `refs/merge-requests/:iid/head`，见 gitlab.ts 同款调用） | — |

### 4.28 GitConsole（slug `console`；P3）

- **入口**：更多「控制台」→ `/repos/:id/console`。
- **前置**：先执行若干 git 操作（含带 `-c`/extraheader 的远程操作）再进入。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-145 | git 命令输出展示（环形缓冲 + token 剥离） | 打开控制台 → 观察列表 → 刷新 | 列表（时间/args/退出码/耗时/stderr 尾）齐全；`extraheader` 明文不存在（token 剥离） | ✅ | console-01.png（先跑 status/标签/工作树/日志 + 「更新项目」（`fetch --all`，带令牌注入）再进页面：**100 条**记录（环形缓冲），每行含 时间 + args + 退出码 + 耗时，失败行带 stderr 尾——图为失败行 `#82`：`--no-pager -c … fetch --all │ 1 │ 3.6 s │ fatal: Cannot prompt because user interactivity has been disabled. … could not read Username for 'http://127.0.0.1:9419' … error: could not fetch probe-remote`。**token 剥离**：API JSON 与页面文本对 `extraheader`（大小写不敏感）、`Authorization:`、token 明文均 **0 命中**；**反向实证**：401 探针服务器日志记录到 `"auth":"Bearer f145-secret-token-value"`（`GET /acme/probe.git/info/refs?service=git-upload-pack`）——注入确实发出去了，只是不下行。跑完删账户 + 移除探针远程） |
| F-146 | 输出折叠（`-c key=value`） | 观察含 `-c` 的条目 | 整对参数折叠为 `-c …` 占位 | ✅ | console-02.png（**100/100 行**均呈现 `--no-pager -c … <子命令>`：`-c … rev-parse --absolute-git-dir`、`-c … for-each-ref --format=%(refname)%00%(objectname) refs/heads refs/remotes refs/tags refs/stash`、`-c … status --porcelain=v2 -z --branch` 等；`-c …` 出现行数 = 100，与条目数一致；API 原始 args 中 `-c` 与 `core.pager=cat` **成对存在**——仅 UI 呈现折叠） |

### 4.29 QuickActionsMenu（slug `quick-actions`；P2+，等效聚合）

- **入口**：LogPage 顶栏按钮区（独立组件明确不做，等效 = 顶栏 5 按钮 + 更多菜单 18 项 + OperationStatus 操作条）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-147 | 分支快捷弹窗（等效 = 顶栏「分支」） | 顶栏「分支」→ 分支页 | 等效承载可达（同 branch-01 证据；本行截顶栏入口态） | ✅ | quick-actions-01.png（LogPage 顶栏入口态：悬停 `button[aria-label="分支"]` → Tooltip「打开分支页：查看本地/远程分支并执行新建、检出、合并等操作」；点击 → 直达 `/repos/:id/branches`（**等价承载可用**）；分支页功能证据见 branch-01/02.png（F-062 起）） |
| F-148 | 操作聚合（等效 = 顶栏 + 更多菜单 + 操作条） | 展开顶栏按钮区 + 更多菜单 | 5 按钮 + 18 项全量入口聚合在位（同 log-page-14/15 证据；本行截聚合展开态） | ✅ | quick-actions-02.png（同屏聚合：顶栏动作按钮 **撤销最近提交/变更/分支/合并/贮藏**（图标按钮带 `aria-label`，悬停 `贮藏` 显示 Tooltip「打开贮藏页：把未提交的改动暂存起来，或把已有贮藏重新应用回工作区」）+ 工具位 首页/设置/更多 + 「更多」展开 **16 项**（主仓为本地 file 远程）——溯源/历史/已提交/搜索/变基/标签/拉取/推送/更新项目/远程管理/补丁/搁置/控制台/忽略/工作树/子模块）。**计数实测**：无托管远端 16 / 仅 github 17（github-01.png）/ 仅 gitlab 17（F-140）/ **两者皆有 18**（用双托管远程的 clone 仓实测）→「18 为含两种托管面板的全集上限」成立；操作条证据沿用 conflicts-06.png |

### 4.30 SettingsPage（slug `settings`；P1/P2）

> **§5.25 拆分后本节的页面归属**：设置页按**作用域**拆成两页——`/settings` = **应用设置**（应用设置卡片 /
> 保护分支 / Git 可执行文件 / 账户，全部与应用配置 `~/.rebasedjs/config.json` 相关，与 repoId 无关），
> `/repos/:id/settings` = **仓库设置**（Git 配置（仓库级）9 键 / GPG 提交签名，写本仓库 `.git/config`）。
> 下表 7 行的**功能与预期效果不变**，但落点变为：F-149 / F-151 / F-153 / F-155 → `/settings`；
> F-150 / F-154 → `/repos/:id/settings`；F-152（config-store 持久化）两页都适用。
> 入口：首页「设置」→ `/settings`；日志页顶栏设置图标 → `/repos/:id/settings`；两页顶部互跳。
> **截图口径**：下表 F-149/F-150/F-154 引用的 `settings-01.png`、`settings-02.png`、`settings-06.png` 是**拆分前**的单页截图（同屏既有应用级卡片又有仓库级卡片与对应顶栏）；拆分后的对应图为 `app-settings-01-dark.png`（应用设置页四卡片）与 `repo-settings-02-light.png`（仓库设置页 9 键 + GPG）。

- **入口**：顶栏「设置」→ `/repos/:id/settings`（key=repoId 切仓强制重挂载）；应用设置页在 `/settings`（首页「设置」进入）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-149 | 应用设置读写 | 切 logInEditor 开关 → 刷新后仍保持；观察 recentRepoIds 生效 | 应用设置持久化正确 | ✅ | settings-01.png（**应用设置卡片特写**：「在编辑器中查看提交日志」true→false → 刷新页面后 `aria-checked=false` 仍保持；CLI：`config.json` → `settings.logInEditor=false`；同卡片「界面主题」Segmented（**自动/明亮/暗色**，三选项为 §5.22 变更② 后的新 UI）在位；recentRepoIds 由其消费方「首页最近仓库列表」印证——页面行数与 config 的 **11 条**逐项一致）。**口径更正**：旧记录写「8 条」，后为 10 条，2026-09 复核为 **11 条**（随夹具开仓推进递增）；整页暗色态见 `app-settings-01-dark.png`。冒烟后已把开关复位为 true |
| F-150 | git 配置白名单 9 键读写 | ConfigRow 逐行：生效值 + local 覆盖输入 + 保存 | 保存写仓库配置成功（CLI `git config` 互证）；含 gpgsign/signingkey/commit.template | ✅ | settings-02.png（**「Git 配置（仓库级）」卡片特写**（本轮取 `rebased-smoke-shallow-r6`，testid `repo-config-card`）9 行：user.name / user.email / core.autocrlf / pull.rebase / commit.gpgsign / user.signingkey / commit.template / fetch.prune / init.defaultBranch，每行显示生效值 + 覆盖输入 + 保存；初值未变化时 **9/9 保存按钮均为禁用**）；写入实测：`fetch.prune` 填 `true` → 保存按钮转为可用 → 保存成功 → CLI `git config --local --get fetch.prune` = `true`，行内「生效值」同步显示 `true`；跑完已 `--unset fetch.prune` 复位。整页暗色态见 `repo-settings-01-dark.png` |
| F-151 | 账户/令牌管理 | 添加/覆盖 host+account+token → Popconfirm 删除 | 列表正确；token 仅掩码不下行；配置文件 0600（CLI 文件互证） | ✅ | settings-03.png（**账户卡片特写**（testid `accounts-card`）：添加 `example.com` + `smoke-f151` + 令牌 → 行显示 `toke***`（**仅掩码，token 不下行**）；同名再存（换 `NEWTOKEN-f151`）→ 仍只 1 条、预览更新为 `NEWT***`；Popconfirm「确定删除账户 smoke-f151（example.com）？」→ 删除后「暂无账户」、`config.json` 的 `auth.accounts` 归零）。权限：`config-store` 每次写盘 `chmodSync(file, 0o600)`（POSIX）；Windows 下 ACL 仅 SYSTEM/Administrators/当前用户（无 Everyone），等价收敛；文件无 BOM |
| F-152 | 集中存储（config-store） | 修改任一应用设置 → 重启服务 → 复查 | 配置集中于 config-store 持久化（口径由单测锁定，页面验证持久化即可） | ✅ | settings-04.png（**真重启**实测：切主题为「明亮」→ `data-theme=light`、body `rgb(255,255,255)`、Segmented 停在「明亮」→ 停掉整棵 dev 进程树（`terminate_background_job` 杀掉 `pnpm dev` 与 `pnpm --filter @rebased/web-koa dev:web`，**三个端口 3081/3082/5173 实测均无监听**）→ 原地重启新进程（**6.9 s 就绪**、`/api/settings` 200、SPA 5173 → 200）→ 重开设置页**仍为亮色**（`data-theme=light`、Segmented 停在「明亮」；图为重启后同页**视口 1280×800** 的快照，与切换瞬间的 1440×900 态区分）、`logInEditor=false` 亦保持；重启后 `settings/gpg-config`、`commit/amend-targets`、`browse/content` 全部 200、dev 日志 **0 条 404**（与 D-43「偶发、未复现」的定性一致）。**冒烟后已把主题切回「暗色」并把 logInEditor 复位 true**，`GET /api/settings` → `theme:"dark"` / `logInEditor:true` / `patterns:[]`）。**重启注意事项见 D-43**：硬杀后 `.next` 缓存可能不一致导致二级嵌套 API 404 |
| F-153 | git 可执行文件检测/引导 | 观察「Git 可执行文件」卡片 | PATH 查找 `git` + 版本输出 + 已检测徽标 | ✅ | settings-05.png（卡片：`已检测` 徽标 + `git（PATH 查找）` + `git version 2.47.0.windows.2`）；API `{"exec":"git","version":"git version 2.47.0.windows.2","ok":true}` 与 CLI 同值；未检测态引导文案由 `resolveGitExecutableInfo` ok=false 分支承载（api 单测覆盖） |
| F-154 | GPG 专属配置对话框 | 「GPG 提交签名」卡片 → 「配置…」Modal → 勾选 + 密钥下拉 | 状态行正确；密钥下拉列 secret keys；无密钥 → Alert 禁启用；取消勾选仅写 false 不清 key（CLI config 互证） | ✅ | settings-06.png（卡片状态行「未启用 / commit.gpgsign 为 false/未设置」；Modal：启用勾选框 + 密钥下拉 + 说明「配置与 git config 同步（commit.gpgsign / user.signingkey）」；本机无 gpg CLI → API `keys:[]` → Alert「未找到可用的 gpg 密钥（gpg --list-secret-keys 无结果或 gpg 不可用…）」且**勾选框与密钥下拉均禁用**；「确 定」仍可点——「取消勾选 → 只写 false 不清 key」本身是合法操作）。CLI 实测「取消勾选仅写 false 不清 key」：先设 `commit.gpgsign=true` + `user.signingkey=DEADBEEF1234` → `PUT settings/gpg-config {"enabled":false}`（**不带 key**）→ 200 `{enabled:false, key:'DEADBEEF1234', keys:[]}`，CLI 复核 `commit.gpgsign=false` 而 `user.signingkey` **保留**；冒烟后已清掉该临时 key（另注：带 `key:''` 会被 schema 以 400 拒，等价语义须省略 key 字段） |
| F-155 | 保护分支设置 | 卡片输入正则列表（含一个非法正则）→ 保存 | 非法标红禁保存；合法保存成功；联动：已发布到匹配远程分支的提交编辑 → 「不可重写」拦截提示 | ✅ | settings-07.png（**页面级取景**（应用设置页 `[data-testid="protected-branches-card"]`）：输入 `main` + `[unclosed` → 卡片内红字「非法正则：[unclosed」且「保 存」禁用）；settings-07b.png（**保护分支卡片特写**：同为非法态，红字与禁用的「保 存」清晰可辨；内容区是 antd `Input.TextArea`（testid `protected-patterns-input`），非 Monaco）；② 改为合法单条 `stash-branch-f083-r5b` → 保存成功，CLI `config.json` → `protectedBranchPatterns=["stash-branch-f083-r5b"]`；③ **联动实测**：对**已推送到 `origin/stash-branch-f083-r5b`** 的提交 `bf7794e`（`chore(remote): F-096 远端提交`）右键 → Reword Commit（`reword-message-input`）→ `POST commit-edit {"hash":"bf7794e…","action":"reword","message":"f155-reword-probe-should-be-blocked"}` → **400 `INVALID_QUERY`「目标提交已推送到受保护分支，不可重写」**，CLI 复核 `origin/stash-branch-f083-r5b` 仍 `bf7794e chore(remote): F-096 远端提交`（分毫未变）；settings-07c.png（右键菜单态，14 项）。冒烟后规则已清空（`patterns=[]`）。**夹具注**：本轮受保护模式取当前分支名 `stash-branch-f083-r5b`（`origin` 指向 `D:\zhanglei1120\Github\smoke-remote` 的裸仓），旧记录里的 `origin/master` / `761961d` 已随夹具推进失效 |

### 4.31 BrowsePanel（slug `browse`；P4）——整页形态已删除（2026-09-16）

> **页面删除说明**：本节的独立整页 `/repos/:id/browse?rev=` 已按用户口径删除（应用内没有任何入口；详情面板「浏览快照」开的是**就地快照栏**，唯一指向整页的「在新标签页打开」按钮也已删除）。下表的 4 行是**删除前的历史验证记录**（browse-01~04.png 仍在盘），能力本身原样保留在 LogPage 就地快照栏（见 §5.29 与其 ⑥）——文件树与只读内容视图共用同一 `SnapshotTreeColumn` / `ReadonlyTextView`，端点 `GET /browse`、`GET /browse/content` 未动。

- **入口（删除前）**：LogPage 详情面板「浏览快照」→ `/repos/:id/browse?rev=<hash>`（现为就地展开 `?snap=<hash>`）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-156 | 文件树浏览（目录聚合 + 初始一层展开） | 打开快照浏览 → 观察文件树 → 展开目录 | `ls-tree -r` 聚合：目录在前字母序、初始一层展开；子模块/符号链接仅徽标 | ✅ | browse-01.png（`?rev=master` → **文件（18）**：目录 `assets/docs/src/vendor` 在前且字母序、目录**初始一层展开**；2 个 gitlink 带「子模块」徽标（`vendor/dir.with.dots`、`vendor/sub-module`）；与 CLI `ls-tree -r master` 的 18 条逐项一致；根提交 **`56f751ab`** 对照 `ls-tree -r` 的 3 个文件（`README.md`、`docs/gone.md`、`docs/old-name.md`）一致。**口径更正**：旧记录的「17 个文件 / 4 个 gitlink / 根提交 3236538」均已过期（四态子模块夹具已移除、历史被重写） |
| F-157 | 文件内容只读查看 | 点文本文件 → 再点二进制文件 | 该版本内容正确展示（`git show <rev>:<file>`）；二进制（含 NUL）仅提示不渲染 | ✅ | browse-02.png（点 `README.md` → 右栏渲染该版本内容，与 `git show master:README.md` **逐字一致**（`# Rebased Smoke` + F-041/F-054/F-056/F-058 各探针行）；点 `assets/logo.bin`（含 NUL）→ 仅提示「二进制文件，不支持文本预览」且**不渲染 `<pre>`**；API `browse/content` 返回 `{content, binary:true}`，二进制以 `binary` 标志交由 UI 抑制渲染） |
| F-158 | 降级边界 | 无效 rev → 路径越界 → 空版本 | 无效 rev → INVALID_REF 提示；越界 → INVALID_QUERY；空版本空态 | ✅ | browse-03.png（① 无效 rev `deadbeef…` → 页面红字「无效的 ref：deadbeef…」，API 400 `INVALID_REF`；② 路径越界 `../../secret.txt` 与绝对路径 `C:\Windows\win.ini` → 均 400 `INVALID_QUERY`「非法的文件路径」（**参数名是 `file`**，用 `path` 会 400——勿误判）；③ 未输入 rev → 空态「输入 ref 开始浏览快照 / 以该提交为根只读浏览文件树，不触碰工作区」，且**不发 browse 请求**；空仓 `rebased-smoke-init` 的 `rev=HEAD`（unborn）→ 400 `INVALID_REF`「无效的 ref：HEAD」） |
| F-159 | 入口与导航边 | 详情面板「浏览快照」→ 回日志页 | 入口与回边均可用（边 #22） | ✅ | browse-04.png（日志页详情面板（`?select=4db0f92e68f1330cac6a6fa83adff06424f8ace0`）→ 点 `[data-testid="browse-snapshot"]`「浏览快照」→ `/browse?rev=4db0f92e68f1330cac6a6fa83adff06424f8ace0`（**文件（22）** = 截图当时的提交快照 `4db0f92`，与 CLI `ls-tree -r 4db0f92` 的 22 条逐条一致；该提交后主仓又落了 F-130 子模块夹具的两个提交，当前 `HEAD` 亦为 22 条）→ 点「返回日志」→ 回 `/repos/:id`（**无残留参数**）。**计数随夹具推进变化**：旧记录为 28 条） |

---

## 五、执行记录与缺陷登记

> 按 AGENT.md §冒烟测试记录规范回填：① 范围清单逐项 ✅/❌/跳过+理由；② 操作路径（点击/输入序列）；③ 证据（浏览器状态 + CLI 输出互证）；④ 未覆盖项与后续计划。

| 轮次 | 日期 | 执行范围（F-xx…） | 结果汇总（✅/❌/跳过） | 缺陷登记（根因/修复/复验） |
|------|------|-------------------|------------------------|----------------------------|
| R1 | 2026-09-10 | F-001~F-028（RepoPage 8 + LogPage 20）、F-029~F-031（DiffPage 3）；暗黑/明亮双主题与 1440/768/480 三档宽度抽查 | ✅ 30 / 跳过 1（F-025） | D-01~D-12（已修复并在当轮复验；逐条明细已归档，见 §5.24） |
| R2 | 2026-09-10 | F-032~F-038（DiffPage 7）+ F-039~F-051（StatusPage 13）+ F-052~F-058（CommitDialog 7） | ✅ 27 / 跳过 0.5（F-056 的 gpg 分支） | D-14~D-17（已修复并复验）；夹具纠偏 P-06~P-10（见 §5.17） |
| R3 | 2026-09-10 | F-059~F-061（ResetDialog 3）+ F-062~F-068（BranchPanel 7） | ✅ 10（ResetDialog 3/3、BranchPanel 7/11） | D-19~D-21（已修复并复验）；F-069~F-072 待续 |
| R4 | 2026-09-10 | F-069~F-072（BranchPanel 余下 4 行）+ F-073~F-075（MergeDialog 3 行） | ✅ 7（BranchPanel 11/11、MergeDialog 3/3 收官） | D-22（已修复并复验）；远端分叉/新分支由 rebased-smoke-other 克隆构造；冲突仓停在 merge 冲突态供 F-114~F-119 复用 |
| R5 | 2026-09-10 | F-076~F-080（RebaseDialog 5 行：onto/交互式 todo/continue·skip·abort/auto-squash/单提交编辑四动作） | ✅ 5（RebaseDialog 5/5 收官） | D-23（已修复并复验）；夹具纠偏 P-11（见 §5.17） |
| R6 | 2026-09-11 | F-081~F-085（StashPanel 5 行：save 三选项 / pop·apply·drop / 转分支 / Unstash As… / 查看差异） | ✅ 5（StashPanel 5/5 收官） | D-24、D-25（已修复并复验）；环境说明 E-01（Next dev 代码框多字节 panic） |
| R7 | 2026-09-11 | F-086~F-088（TagPanel 3 行：创建轻量/附注、删除本地/远程、推送单个/全部） | ✅ 3（TagPanel 3/3 收官） | D-26、D-27（已修复并复验）；夹具：file:// 裸远端 `D:\zhanglei1120\Github\smoke-remote` |
| R8 | 2026-09-11 | F-089~F-092（RemotePanel 4 行：远程 CRUD / fetch 三形态 / shallow·unshallow / 401 认证回路） | ✅ 4（RemotePanel 4/4 收官） | D-28、D-29（已修复并复验）；F-092 用本地恒 401 服务（`http://127.0.0.1:9418`）触发真实认证回路 |
| R9 | 2026-09-11 | F-093~F-100（PushDialog 3 + PullDialog 2 + UpdateProjectDialog 3：推送/上游设置/强推/被拒自动更新；拉取与 rebase；更新策略·结果汇总·Reset to tracked） | ✅ 8（三页各自收官：push 3/3、pull 2/2、update 3/3） | 本轮无新缺陷；夹具：由 `rebased-smoke-other` 推送远端侧提交制造分叉与领先态，`rebase-topic` 经 F-093 建立上游（后续需要「无上游」形态时改用 rebased-smoke-big） |
| R10 | 2026-09-11 | F-101~F-104（BlameView 4 行：注解列表 / 三联动 / 受影响文件 / previousLineno 边界）+ F-025 补测（认证重试回路，用本地 401 服务解除原「跳过」） | ✅ 5（BlameView 4/4 收官；LogPage 20/20） | 本轮无新缺陷；每行均与 CLI（`blame`/`blame --line-porcelain`/`show --name-status`）逐项互证 |
| R11 | 2026-09-11 | F-105~F-110（HistoryPanel 3 + CommittedChangesPanel 3：文件历史 / --follow 跟随 / 版本 diff 联动；提交浏览与分页 / 目录树 / diff 联动） | ✅ 6（两页各自收官：history 3/3、committed 3/3） | 本轮无新缺陷；F-108 分页在 321 提交的大仓实测 50→100；P3 观察（不改）：溯源/历史页的页内路径输入不回写 URL（`?file=` 仅作入口深链），刷新后回到入口态 |
| R12 | 2026-09-11 | F-111~F-113（SearchPanel 3 行：grep/pickaxe 双模式与非法正则、结果→日志、分支快速搜索） | ✅ 3（SearchPanel 3/3 收官） | D-30（已修复并复验）；两模式结果均与 CLI 逐条互证 |
| R13 | 2026-09-11 | F-114~F-119（ConflictsPanel 6 行：冲突列表与徽标 / 整侧解决 / 3-way 手合并 / 完成合并 / 跳过 / 状态联动与中止） | ✅ 6（ConflictsPanel 6/6 收官） | 本轮无新缺陷；夹具重建为一次性呈现 AA/UD/UU 四路冲突 + rebase 冲突，每步均与 CLI 互证 |
| R14 | 2026-09-11 | F-120~F-126（PatchPanel 4 + ShelfPanel 3：补丁三态创建/应用/列表管理/导入搁置；搁置保存/恢复与删除/事件联动） | ✅ 7（两页各自收官：patch 4/4、shelf 3/3） | D-31（已修复并复验）；F-126 用双标签页实测 SSE 事件驱动刷新 |
| R15 | 2026-09-11 | F-127~F-129（WorktreePanel 3 行：列表徽标 / 创建与路径校验 / 移除·强制移除·清理） | ✅ 3（WorktreePanel 3/3 收官） | D-32（已修复并复验） |
| R16 | 2026-09-11 | F-130~F-133（SubmodulePanel 2 + IgnoreDialog 2：四态徽标与更新 / 双 target 编辑与模板 / 一键忽略幂等） | ✅ 4（两页各自收官：submodule 2/2、ignore 2/2） | 本轮无新缺陷；子模块四态夹具由 `protocol.file.allow=always` 新增子模块 + 两侧分叉 gitlink 合并构造 |
| R17 | 2026-09-11 | F-134~F-135（GitHubPanel 检测门 + 账户认证降级卡）、F-140（GitLabPanel 同口径）+ F-136~F-139 / F-141~F-144 边界核实 | ✅ 3 / 跳过 8（缺真实托管仓库与 PAT） | D-33（已修复并复验）；github.com 经假 PAT 实测可达（返回 `Bad credentials`） |
| R18 | 2026-09-11 | F-145~F-146（GitConsole 2 行：命令记录展示与 token 剥离、`-c` 成对折叠） | ✅ 2（GitConsole 2/2 收官） | D-34（已修复并复验） |
| R19 | 2026-09-11 | F-147~F-148（QuickActions 等效聚合 2 行：顶栏分支入口、顶栏+更多菜单+操作条聚合） | ✅ 2（QuickActions 2/2 收官） | 本轮无新缺陷；菜单项数随宿主检测（16/17 项，18 为含两种托管面板的上限）已在行内说明 |
| R20 | 2026-09-11 | F-149~F-155（SettingsPage 7 行：应用设置读写 / git 配置 9 键 / 账户令牌 / config-store 重启持久化 / git 可执行文件 / GPG 配置 / 保护分支与联动拦截） | ✅ 7（SettingsPage 7/7 收官） | 本轮无新缺陷；F-152 真杀进程重启后复查，F-155 用「已推送提交 Reword」实测联动拦截 |
| R21 | 2026-09-11 | F-156~F-159（BrowsePanel 4 行：文件树 / 只读查看与二进制 / 降级边界 / 入口与回边） | ✅ 4（BrowsePanel 4/4 收官） | 本轮无新缺陷；树与内容均与 `ls-tree -r` / `show <rev>:<file>` 互证，越界与绝对路径均被 `INVALID_QUERY` 拦下 |
| R22 | 2026-09-11 | **全站流体布局与密度几何验收**（非 F-xx 功能行）：六档宽度 × 明暗 × 24 路由 + 6 个状态（含 GitHub/GitLab 展开差异、认证/重置弹窗、EllipsisText 浮层）+ 两条例外断言；web-koa 对等抽查 | ✅ 576/576 格（web-next 384 + web-koa 192） | 修复前基线 375/384：`stashes` 行在 360/480 顶宽（`scrollWidth 492 > clientWidth 360/480`）→ 该行加 `wrap`；另 4 格为断言测量竞态（已修断言）。见 §5.16 |
| **R23** | **2026-09-12** | **全量重跑（159 行全跑完 + 收官抽查）**：按 §1.3 用 `scripts/smoke-setup.ps1` 复位重建全部冒烟仓后，从 F-001 起按矩阵顺序跑完 **F-001~F-159**（31 个页面全覆盖：RepoPage 8 / LogPage 20 / DiffPage 10 / StatusPage 13 / CommitDialog 7 / ResetDialog 3 / BranchPanel 11 / MergeDialog 3 / RebaseDialog 5 / StashPanel 5 / TagPanel 3 / RemotePanel 4 / PushDialog 3 / PullDialog 2 / UpdateProjectDialog 3 / BlameView 4 / HistoryPanel 3 / CommittedChangesPanel 3 / SearchPanel 3 / ConflictsPanel 6 / PatchPanel 4 / ShelfPanel 3 / WorktreePanel 3 / SubmodulePanel 2 / IgnoreDialog 2 / GitHubPanel 6 / GitLabPanel 5 / GitConsole 2 / QuickActions 2 / SettingsPage 7 / BrowsePanel 4）；另完成收官抽查：**明亮主题 8 张**（§5.18①）、**响应式 6 张**（§5.18②，`scrollWidth <= clientWidth+1` 全通过），并重拍 F-058 回执与 F-119 换态图。截图**全量重拍 196 张**（归档时删除 1 张失效证据图，账目 195 张；**2026-09 复核在盘 206 张**——其后批次又落盘若干图，见 §5.19：引用=在盘、无缺失、无重复 SHA、无孤儿。**2026-09-13 全量重拍后为 205 张，见 §5.26**） | ✅ **150** / ❌ **0** / ⏭ **9**（F-056 的 gpg 分支 + F-136~F-139、F-141~F-144 共 8 行需真实托管仓库与 PAT） | **新登记缺陷**：D-39（`refs.changed` 后 chips 不刷新）、D-40（「清理已合并（N）」计数与执行集不一致）、D-41（并发下 `.git/index.lock` raw 报错透出，P3）、D-42（配置 BOM 化 → 全站 400 且文案误导，P2）、D-43（硬杀 dev 后 `.next` 缓存不一致 → 二级嵌套 API 404，P2）、D-44（`conflicts-06.png` 与 `log-page-16.png` 同图，证据链重复）——**D-39~D-42 与 D-44 已于本轮修复并复验（修复落点/回归守卫/实测见 §5.20），D-43 复核两次未复现、按偶发登记**；**流程/夹具纠偏 P-12~P-29**（见 §5.17）；**主题/响应式/账目** 三节见 §5.18~§5.19 |

**收官复核（R21 末）**

- **主题**：明亮主题下复核本轮新增页面——冲突页/子模块/快照浏览/补丁/工作树（`theme-light-conflicts.png`、`theme-light-submodules.png`、`theme-light-browse.png`、`theme-light-patches.png`、`theme-light-worktrees.png`），均 `data-theme=light` + body `#ffffff`、无暗色残留；连同 R1 的 `theme-light-log/diff/settings.png` 覆盖三类渲染面（列表 / Monaco / 表单）。复核后已切回暗色。
- **响应式**：768 与 480 两档复核日志页与设置页（`responsive-768-light-log.png`、`responsive-480-light-log.png`、`responsive-768-light-settings.png`）——顶栏按钮与过滤行按 `flex-wrap` 折行、提交主题省略号截断、详情面板纵向堆叠，`documentElement.scrollWidth` 均未超出视口（无横向滚动）。
- **截图账目**：`docs/shots/` 共 183 张，文档引用 175 个文件名**全部存在**；跨文件 SHA256 无重复；无未被引用的孤儿截图。

**全量收官（R21 末）**：159 行 F-001~F-159 = ✅ 150 / 跳过 9（F-136~F-139、F-141~F-144 共 8 行缺真实托管仓库与 PAT；F-056 的 gpg 分支）；31 个页面全部走到收官状态。缺陷累计 D-01~D-34（全部修复并复验）+ 环境说明 E-01。

### 5.16 R22 全站流体布局与密度六档验收（Task 16，2026-09-11）

> 本轮不按 F-xx 功能行冒烟，而是对「全站流体布局与密度统一」重构做**几何验收**：六档宽度 × 明暗两主题 × 每个页面与状态，逐格断言页面级横向溢出为 0。入口：`scripts/check-fluid-layout.mjs`（Playwright 驱动，先 `pnpm dev` 起真实服务）。
> 被测端：web-next `http://localhost:3081`（六档 × 明暗）、web-koa `http://localhost:5173`（其 SPA 固定暗色，故只跑暗色）；夹具：既有主冒烟仓 `rebased-smoke`（id `18726c5c-f4b2-499d-ac82-6eac8f46ec26`，`sub-b @ 4f27441`，23 提交、2 stash、2 tag、2 shelf、2 worktree、2 submodule），**未**重建夹具。
>
> **夹具耦合（跑之前先看这条）**：内容级就绪门要求夹具里**真的有那些内容** —— browse 的树节点、settings 的 git 配置行（键集由代码里的 `CONFIG_KEYS` 决定，与夹具无关）、status 的变更行、stashes、tags、patches、shelves、worktrees、submodules、console 的历史记录。其中 stash / 未跟踪文件 / tag / patch / shelf / worktree / submodule 都是**可变状态**：一旦有人 drop 掉一个 stash、把未跟踪文件提交掉或删掉 tag，对应的格子会**如实判红**（提示「内容级就绪选择器未出现」）而不是静默跳过 —— 那一格此时没有可量的数据，绿了才是错的。排查顺序是先看夹具（`git stash list` / `git status --porcelain` / `git tag` …），不要先动门。另注：本轮期间实测到**另一个会话在同一夹具仓库上来回 checkout 分支**（`git reflog`：`master ↔ sub-b`），那会让日志页/对比页的内容中途换一批；跑验收前请确认没有别的会话在使用该夹具。

#### ① 范围清单（逐项 ✅/❌/跳过+理由）

**核心断言**：`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`（+1 容亚像素）。

| 覆盖项 | 档位 | 结果 |
|--------|------|------|
| 24 个页面：`/` 首页、`/repos/:id` 日志页、browse·blame·branches·committed·history·search·merge·remotes·conflicts·diff·settings·stashes·status·tags·patches·shelves·console·ignore·github·gitlab·worktrees·submodules | 360 / 480 / 768 / 1024 / 1440 / 1920 × 暗 + 明 | ✅ **384/384 格**（**Fix round 3 定稿版脚本整轮实跑**：一次通过、0 格重试、0 格未测量、0 格溢出；**数字逐次记账见 ③** —— 早先那个 384/384 出自加严前的脚本、Fix round 2 run C 的那个出自上一版脚本，两者都不能与这次混用） |
| 静态加载不产生的日志页状态：`?select=`（选中提交）、`?compare=`（分支对比） | 同上 | ✅ |
| `/github`、`/gitlab` 两面板**展开「查看差异」**（渲染共享 `hunk-diff-view`，无别的路由覆盖它） | 同上 | ✅ |
| 认证弹窗（推送被服务端 401 AUTH_FAILED → 容器开 AuthDialog） | 同上 | ✅ **仅**证明弹窗打开时「弹窗背后的页面」不溢出（弹窗内部另论，见下方口径说明与 ④） |
| 重置弹窗（选中提交 → 「Reset 当前分支到此处」→ ResetDialog） | 同上 | ✅ 同上（页面级口径，**不含**弹窗内部） |
| `EllipsisText` 悬停浮层（溢出必弹 + 内容=完整值；两个站点各测，正反两半都被实测到） | 同上 | ✅ |
| 例外①：log 两栏在 `collapseBelow` 以下纵向堆叠且各占满宽度、以上左右并排 | 同上（双向断言） | ✅ |
| 例外②：Monaco 内容宽于编辑器和宿主不溢出 + 拖动其横向滚动条内容真位移 + 页面级仍为 0 | 同上 | ✅ |
| web-koa 对等抽查（全部 24 路由 + 6 个状态，暗色） | 360 / 480 / 768 / 1024 / 1440 / 1920 | ✅ **192/192 格**（**Fix round 3 用当前脚本** `node scripts/check-fluid-layout.mjs --app=koa` 整轮重跑：0 格溢出、0 格重试、0 格未测量。早先那个 192/192 出自 Fix round 1 的脚本，与这次不是同一把尺子 —— 见 ③） |
| **跳过**：conflicts 页的「冲突行」状态 | — | 跳过：需仓库停在冲突态；本轮不动共享夹具（用户可能正在使用），空态已断言。后续用 `rebased-smoke-conflict` 现造冲突态补测 |
| **跳过**：Monaco 在 1440/1920 档的「内部横向滚动」 | — | 非跳过而是否定式通过：该两档长行放得下（内容 889px ≤ 编辑器 937px），断言按分支记 pass（本档无需内部滚动） |
| **按路由的密度断言**（终修新增，`assertDensity()`）：每格文本的**主导**基准字号 = 该路由的密度归属 —— compact **12px**，只有设置页 **14px** | 同上（与溢出断言同一时刻、同一页面状态取样） | ✅ **384/384 格**（同一整轮；`/merge`、`/diff`、`committed` 三处本轮修复的路由均在其中，逐格实测见 ③ 的密度记账）。**这条断言此前不存在**：`/repos/:id/merge` 曾整条路由没有密度归属、以 antd 默认 14px 渲染，而当时的 576 格溢出矩阵**全绿** —— 溢出为 0 与密度正确是两件独立的事，这是唯一能看见后者的断言 |

> **两条 Modal 格的口径（重要，勿按字面读成「弹窗内容也不溢出」）**：本轮的断言对象始终是 `document.documentElement.scrollWidth`。antd v6 的 `.ant-modal-wrap` 是 `position: fixed; overflow: auto` —— **弹窗内部的横向溢出被这层包裹容器自己吃掉**，不可能增长文档滚动宽；测量助手在列越界元素时也刻意跳过 `position: fixed` 的元素（浮层是「页面之外」的一层，不参与文档级判定）。因此这两格能证明的只有「**弹窗打开时它背后的页面**没有横向溢出」，**不能**证明「弹窗自己的内容没有横向溢出」。后者的度量对象应是 `.ant-modal-wrap` / `.ant-modal` 自身的 `scrollWidth vs clientWidth`，本轮未做，已列入 ④ 未覆盖项。

#### ② 操作路径（点击/输入序列）

1. `pnpm dev`（web-next :3081 / web-koa API :3082）+ `pnpm --filter @rebased/web-koa dev:web`（SPA :5173）；三个端口启动前均为空闲，无需 kill。
2. 断言脚本自动驱动：`PUT /api/settings {theme}` 切主题（跑完还原）→ 逐格 `goto(<路由>)` → **两段式就绪门**（先等该路由的页面壳 `data-testid`，再等**内容级**条目选择器如 `row-stash-*`/`tag-row-*`/`config-input-*` 真的命中，命中数记进明细、大列表另有命中数下限）→ 等布局静止（滚动量/高度/节点数连续两次采样一致）→ 读 `scrollWidth`/`clientWidth`。只等页面壳会量到数据未到的页面，而空页永远不溢出（该格的绿等于没证明任何东西），故内容级选择器一条未命中（或低于下限）即判该格红。
   - **就绪门与主题门串联（Fix round 2 补）**：主题探针迟迟不落时脚本会兜底整页重载一次；重载会把页面打回「数据还没到」的状态，所以「导航 + 就绪门 + 等静止」与主题门由同一个入口串联，**只要这一轮发生过整页重载，就绪门就整套重跑**才允许测量。绕过这条规则的后果是实测过的：在「重载后直接测量」的旧流程下，`settings` 格在内容 **0 条**的空页上被判**通过**（`scrollWidth == clientWidth`）—— 正是内容级就绪门要堵的那种假绿。
   - **环境中断可整格重跑一次（判定类失败不重试）**：dev 服务按需编译、或别的会话重启 dev 服务 / 改被测代码时，页面会**整页不渲染**（本轮实测到 `ERR_CONNECTION_REFUSED`（dev 服务正在重启）与 github/gitlab 系列接口 404 这类瞬时现象）。脚本对**中断类**失败（就绪选择器未出现、`page.goto` / `page.waitForSelector` 超时、执行上下文被导航打断、主题没落地）把整格重跑一次 —— 重新导航 + 完整两段式就绪门 + 全部断言与测量，**每格最多重试一次**。其中「就绪选择器未出现」**包含内容级门的 0 命中**（`内容级就绪选择器未出现`，命中数 0；实测见过 `dark/1920 console` 首轮 `ready=0`、重跑后通过）：它与「整页没渲染」在本环境里常常是同一件事，而重试**同样**要过完整的两段式就绪门，**不可能凭重试拿到一个空洞的绿**。**已测量且溢出、例外断言失败、命中数低于下限（命中了但 < `min`）都是结论，判红即定、永不重试**；每次尝试的预算一字未改，两次都没过照样判红。尝试次数与**首轮**失败原因写进明细 JSON（`attempts` / `firstAttemptReason`），并在汇总里**逐格列出**「重试后通过 / 两次均失败」、在**每档进度行**与**矩阵**（`✅↻` 记号）里也露出，避免把重试后的绿读成一次通过。
   - **两栏宿主的采样窗口（Fix round 3 补）**：`log-select` 的提交详情栏在首帧后会**短暂整块消失再回来**（D-38，实测 ~0.5s 的窗口），此刻采样「两栏宿主」会得到与布局无关的红，而紧接着的页面级溢出断言更会量在一个「详情栏还没装回来」的页面上（空页永不溢出 → 白通过）。故例外① 先看宿主在不在：**在 → 与改动前一模一样地直接量**（不等待、不额外 `settle`）；**缺席 → 有界地等它回来（10s，与等 Monaco 懒加载同一口径）并等布局静止后再量**，等待耗时写进该格的通过原因（真等过才写，避免每个两栏格都带一句「等了 5ms」把真信号淹掉）。宿主**确实**不出现时照旧判红 —— 负向验证：把「在不在」的判据与等待选择器同时换成必然不命中的值 → 该格如实报「未找到 split-side-host / split-main-host 宿主（采样时缺席，再等 10000ms 仍未出现）」。判定没有放宽。
   - **按路由的密度断言（终修新增，与溢出断言同一时刻、同一页面状态取样）**：取样 = `document.querySelectorAll('body *')` 中「可见 + 自带非空文本节点」且**不在 `.monaco-editor` 子树内**的元素（编辑器字号由 Monaco 自己决定，属组件内部例外）；统计各 `computed fontSize` 的个数，判据是 **12px 与 14px 谁是众数**（紧凑页也有 14px 的卡片标题、默认档页也有 12px 的次要文本，故「出现了 12px」没有判别力）。期望档 = 该路由的密度归属：默认 12px（compact），只有设置页路由 14px（`density="default"` 豁免）；期望档计数不严格多于另一档（含两档相同）即判红，且**不参与重试**（`isStall()` 明确排除 `密度断言:` —— 密度档位不会因为再导航一次而改变）。取样覆盖 **portal**：`/merge` 这类「背后文档为空、只有一个常驻 Modal」的路由由弹窗文本判定密度，这正是终修修掉的那条链路。若 `.monaco-editor` 之外**一个 12px/14px 文本节点都没有**，先**有界重采一次**（≤5s；实测有 3 格在 antd 样式尚未注入的瞬间被采样，直方图全是浏览器默认的 16px / 13.3px），仍然没有才记 `no-sample`（不判红，但在汇总里**逐格列出**，不静默跳过）。逐格结果（期望档、各档主导值、12px/14px 计数）打印在汇总的「按路由的密度断言」一节，并落在明细 JSON 的 `density` 字段。
   - **页面 JS 异常分两栏记录**：真异常照旧列出；唯一被过滤的良性噪声是 Monaco 的 diff worker 取消（`Canceled`，stack 落在 `monaco-editor` 的 `computeDiff`）—— 实测**每次渲染 diff 都会发生**（本轮 3 个含 Monaco 的格子 × 6 档 × 2 主题 = 36 格），而页面完全正常。判据锚在 stack 上而不是消息文本上，避免把同名真缺陷一起过滤掉。
3. 状态格的真实点击序列：
   - **GitHub 展开差异**：`goto /repos/:id/github` → 点 PR 行 `[data-testid="github-pr-row-7"]` → 点 Tab「文件」→ 点「查看差异」`[data-testid="github-diff-toggle-0"]` → 等 `hunk-diff-block-0`（GitLab 同序列，iid=9）。
   - **认证弹窗**：`goto /repos/:id` → 顶栏「更多」→ 菜单「推送」→ 弹窗「确定」→（`POST …/push` 被脚本打桩成 401 AUTH_FAILED）→ 出现「需要认证」弹窗。
   - **重置弹窗**：`goto /repos/:id?select=<最长 subject 的提交>` → 提交详情面板点「Reset 当前分支到此处」（`[data-testid="reset-here"]`）→ 出现「重置到」弹窗。
   - **EllipsisText 浮层**：同上开弹窗后，hover 弹窗内溢出量最大的 `span.ant-typography-ellipsis`（`scrollIntoViewIfNeeded` 后 hover），读 `ant-tooltip-open` 与浮层文本。
   - **Monaco**：`goto /repos/:id/diff?file=src/app.ts&from=<prev>&to=<head>` → 拖动该编辑器**自己的**横向滚动条滑块（`.scrollbar.horizontal .slider`）+120px → 读 `.view-lines` 的 x 位移。
4. 打桩说明：GitHub/GitLab 面板需真实令牌（本机没有），脚本只打桩**宿主 API 数据**（status/prs/detail/timeline/files/review-comments），布局断言落到的仍是真实组件与真实 DOM；推送接口打桩为 401，**没有真的 push，夹具仓库未被改动**。

#### ③ 证据（浏览器状态 + CLI 输出互证）

**几何断言**（脚本输出，逐格 `scrollWidth`/`clientWidth`）—— **按脚本版本分别记账**（这一节最容易读错的地方：同一个「384 格」在不同版本下含义不同）：

| 记录 | 脚本/树 | web-next 结果 | 关键事实 |
|------|---------|---------------|----------|
| 首轮提交版（`e55f138`） | 就绪门只有页面壳级 | `384/384` | 这是**加严前**的数字：当时 `ready` 只等页面壳，可能量到「数据还没到」的页面（空页永不溢出）。**不能**当作加严后的结果引用 |
| 控制器复跑（Fix round 1 之后） | 内容级就绪门 + Monaco/阈值守卫 | `381/384` | 3 格红，**全部是断言脚本自身的缺陷、没有一格是溢出**：`dark/480` 与 `light/1024` 的 `diff` 撞 Playwright strict mode（`locator('.monaco-editor').nth(N).locator('.scrollbar.horizontal .slider')` resolved to 3 elements —— 拖动定位歧义，位置随 diff 布局落位而变）；`dark/768` 的 `state:ellipsis-tooltip-submodule` 是**就绪超时**（该页接口是全夹具最慢的一个），不是溢出 |
| **Fix round 3（最终答案，两个 app 同一把尺子）** | 本版脚本（`renderMatrixCell` 如实标注 + 两栏宿主按稳定态采样） | **web-next `384/384`**（另 **web-koa `192/192`**，同一版脚本同一轮） | **两半都整轮跑完、`scrollWidth == clientWidth` 逐格成立：溢出 0 格 / 重试 0 格（`attempts` 无一为 2）/ 未测量 0 格**。产物 `fluid-r7-next.json`+`.md`、`fluid-r7-koa.json`+`.md`。内容级命中数逐档一致（browse 20、conflicts 1、settings 9、stashes 2、status 7、tags 2、patches 4、shelves 2、console 100、worktrees 2、submodules 2、`state:ellipsis-tooltip-submodule` 2）；良性 `Canceled` 36 格（3 个含 Monaco 的格子 × 6 档 × 2 主题），真页面异常 0 格。**这一行才是本节「当前跑出来多少」的答案**；上一行（run C）的 384/384 出自上一版脚本，保留为历史记录 |
| Fix round 2 · run C（`1f7669d` 版 = 上述修复 + 「环境中断整格重跑一次」） | 同一把尺子，且这一次环境安静 | **`384/384`** | 384 格全部通过、`scrollWidth == clientWidth` 逐格成立、0 格需要重试（明细 JSON：`attempts` 无一为 2） |
| Fix round 2 · run A（`11aaaa7` 版） | 定位歧义修复 + 重载后重跑就绪门 + 内容命中数下限 | `377/384` | 7 格红，**一格都不是溢出**（4 格因页面没渲染而无测量结果、3 格 `scrollWidth == clientWidth`）：整轮跑期间**另一会话正在改 `packages/client/ui/src/domain/commit-graph.tsx`**，运行中记录到该模块的 `ReferenceError`（`laneAreaWidth` / `viewportWidth` / `rowMaxLaneOf` / `CHIP_GAP` / `LISTY_ROW_HEIGHT_THEME` is not defined），页面整页不渲染（`data-theme=null`） |
| Fix round 2 · run B（`11aaaa7` 版） | 同上 | `374/384` | 10 格红，同样**无一是溢出**：诊断信息（新增的「本格 HTTP 异常」）直接指出根因 —— `ERR_CONNECTION_REFUSED`（`_next/static/chunks/...` 与页面本身：**dev 服务当时正在重启**）与 github/gitlab 系列接口瞬时 `404`；同轮另有 `page.goto: Timeout 25000ms` 若干 |
| **Final fix pass（终修答案，两个 app 同一把尺子，含**按路由的密度断言**）** | 终修版脚本（`d12c268`：`assertDensity` + 样式未落地时有界重采；`page-shell` 断言改正向实效断言） | **web-next `384/384`**（十二块各 `32/32`）+ **web-koa `192/192`** | **两半都整轮跑完：溢出 0 格、密度失败 0 格、密度 `no-sample` 0 格、未测量 0 格；重试 1 格**（`dark/360 shelves`，首轮为环境中断 —— 该轮跑期间本次修复的注释刚改动过 `log-page.tsx` / `repo-status-bar.tsx`，dev 按需重编译；重试后通过、判定类失败照旧不重试）。产物 `fluid-finalfix-next.json`+`.md`、`fluid-finalfix-koa.json`+`.md`。**这一行是本节「当前跑出来多少」的答案**（历史行保留） |

- **A/B 两轮红的性质（必须连着读）**：这两轮跑在**同一工作区有别的会话在改被测代码 / 重启 dev 服务**的窗口里。异常一旦出现，页面**整页不渲染**：`data-theme` 为 `null`、任何 `data-testid` 都不出现 → 就绪门不可能出现 → 该窗口内的格子必然红。逐格错误行（run A）：`dark/360 state:auth-dialog`（`执行异常：page.evaluate: Execution context was destroyed, most likely because of a navigation`，同格 HTTP 异常为页面卸载导致的 `/log/stream`、`/events` ERR_ABORTED）、`dark/360 state:reset-dialog`（`page.goto: Timeout 25000ms exceeded`）、`dark/360 state:ellipsis-tooltip`（`reset-here` 就绪超时 26862ms + 主题未生效 `data-theme=null`）、`light/1024 state:reset-dialog`（`page.waitForSelector: Timeout 10000ms exceeded`）、`light/1024 state:ellipsis-tooltip`（`page.goto: Timeout 25000ms exceeded`）、`light/1440 stashes`（`stash-save-button` 就绪超时 31023ms + `data-theme=null`）、`light/1440 state:github-expanded-diff`（`github-pr-row-7` 就绪超时 25782ms + `data-theme=null`）。**没渲染的格子 `scrollWidth`/`clientWidth` 记为 `null`（没有测量结果，不是「测出 0 溢出」）**，拿到数字的三格都是 `scrollWidth == clientWidth`。
  **独立佐证（同一次会话内的对照）**：这些格在**同一轮的其他档位全部通过**（例如 `state:ellipsis-tooltip` 在 run A 的 dark 480/768/1024/1440/1920 与 light 360/480/768/1440/1920 都通过）；定向复跑时 `state:reset-dialog`（与 `state:ellipsis-tooltip` **同一个 URL、同一条就绪门**）通过而后者失败；整轮后单独探针实测 `?select=` 页的 `reset-here` 在 **9/9** 次导航里都出现（7.5–9.7s），另实测到该窗口下单次 `goto` 10.6s / 就绪 20.7s。结论：A/B 两轮的红是**运行窗口内的环境中断**（并发编辑、dev 服务重启、按需编译），既不是溢出，也不是就绪门本身的缺陷 —— **run C 在环境安静时同一把尺子给了 384/384**。这正是脚本加上「环境中断可整格重跑一次」的原因（见 ② 的说明与 `isStall()`）。
- **`Canceled` 页面异常**（本轮起单独记账、不再污染异常清单）：Monaco 的 diff worker 取消。判据是 stack（`Canceled` → `monaco-editor` 的 `computeDiff`），不是消息文本。run A 命中 35 格、run C 命中 **36 格**，分布为 `diff × 12`、`state:github-expanded-diff × 12`、`state:gitlab-expanded-diff × 12`（即 3 个含 Monaco 的格子 × 6 档 × 2 主题；run A 少的那 1 格正是当时整页没渲染的 `light/1440`）；同一次导航里 diff 完全正常（几何与拖动断言均通过）。run C 另有 2 格记录到一条真异常 `Internal Next.js error: Router action dispatched before initialization.`（`dark/360 status`、`dark/360 shelves`，两格均通过）—— 按口径只记录、不参与判定。
- web-koa：**`192/192 格通过`**（暗色；六档 × 32 格 = 192 格）—— **归到与上文 web-next 同一把尺子上（Fix round 3）**：命令 `node scripts/check-fluid-layout.mjs --app=koa`，整轮跑完、**溢出 0 格、重试 0 格（明细 JSON 里 `attempts` 无一为 2）、未测量 0 格**，产物 `fluid-r7-koa.json` / `fluid-r7-koa.md`（与 web-next 那一行同一次 Fix round 3 的产物）。此前记录的 192/192 出自 Fix round 1 的脚本，**重试机制、`prepareCell` 的「重载即重跑就绪门」、`cell.min`、以及滑块定位修复都从未在 koa 侧行使过**；本次补齐（本轮 koa 半轮在脚本定稿过程中共整轮跑过 4 次，**每次都是 `192/192`、溢出 0 格**，最终数字取自定稿版的那一次）。
  - **Final fix pass 复跑（当前答案）**：`node scripts/check-fluid-layout.mjs --app=koa`（终修版脚本 `d12c268`）→ **`192/192`**，**溢出 0 格、密度失败 0 格、密度 `no-sample` 0 格、重试 0 格、未测量 0 格**，产物 `fluid-finalfix-koa.json` / `.md`。

**密度记账（Final fix pass 新增的「按路由密度断言」实测）**——这是本轮唯一能看见「某条路由没有密度归属」的判据（当时的 576 格溢出矩阵对它是全绿）：

| 断言格 | 期望 | 六档实测主导（360/480/768/1024/1440/1920） | 取样（360 档：12px 节点 / 14px 节点 / 文本节点总数） |
|---|---|---|---|
| `dashboard` / `log` / `log-select` / `log-compare` / `browse` / `blame` / `branches` / `committed` / `history` / `search` / `merge` / `remotes` / `conflicts` / `diff` / `stashes` / `status` / `tags` / `patches` / `shelves` / `console` / `ignore` / `github` / `gitlab` / `worktrees` / `submodules`（25 条路由格） | 12px | 全部 `12 / 12 / 12 / 12 / 12 / 12` | 逐格不同（`console` 81/0/107、`log` 67/0/75、`merge` **7/1/8**、`diff` **6/2/8**（Monaco 子树 386 个已跳过）、`conflicts` 4/0/4、`ignore` 2/0/2 ……） |
| `settings`（唯一密度豁免路由） | **14px** | 全部 `14 / 14 / 14 / 14 / 14 / 14` | 12/29/48（29 个 14px 标签 vs 12 个 12px 的 code 值 —— 正是「默认密度」的分布） |
| `state:github-expanded-diff` / `state:gitlab-expanded-diff`（展开差异，内含 Monaco） | 12px | 全部 `12 × 6` 档 | 29/1/34（Monaco 子树 165 个已跳过） |
| `state:auth-dialog` / `state:reset-dialog` / `state:ellipsis-tooltip` / `state:ellipsis-tooltip-submodule`（弹窗态） | 12px | 全部 `12 × 6` 档 | 67/12/89、55/11/75、55/12/76、14/0/16 —— **弹窗内以 12px 主导**，即「密度穿过了 portal」的正面证据 |

- **判定一致性**：web-next（暗色）与 web-koa 逐格比对，**192/192 格的判定（期望档 = 实测主导档）完全一致**；取样计数有 8 格不同（`console@360` 81 vs 303 —— koa 侧的历史命令更多；`log@1024` 73 vs 4 —— 提交列表分页状态不同；`github/gitlab` 的 14px 节点 1 vs 0；`branches@480`、`state:auth-dialog@360` 各 1 格），都属**数据量 / 页面状态**差异，不是密度差异。
- **`/merge` 的前后对照（终修的核心修复，实测）**：修复前 web-next 与 web-koa 的直方图**都是** `14px×7 16px×1`（正文 14 = antd 默认基准、弹窗标题 16 = 默认的 `fontSizeLG`）—— 即「同一弹窗从 `/merge` 进是 14px、从 `/conflicts` 进是 12px」；两个 app 的容器各包一层紧凑 `PageShell` 之后**都是** `12px×7 14px×1`（正文 12 = compact 基准、弹窗标题 14 = compact 的 `fontSizeLG`），脚本判据为「期望 12px / 实测 12px 主导」。六档一致。（web-koa 的「修复前」数字是这样取的：临时把该容器的 `PageShell` 包装还原一次测量，测完立即恢复，`git diff` 为空。）
- **负向验证（两次，都按预期显形）**：① **把 `/merge` 的期望值临时改成 14px** → 该格判红：`密度断言不成立：本格期望 14px 主导…实测 由 12px 主导（12px 节点 7 个 / 14px 节点 1 个…）`，而**同一次测量 `scrollWidth=1024 clientWidth=1024`（没有溢出）** —— 证明这条红是密度判据给出的、不是溢出；② **临时去掉 web-next `merge/page.tsx` 的 `PageShell`（复现终修前的真实状态）** → 该格判红：`期望 12px 主导…实测 由 14px 主导（12px 节点 0 个 / 14px 节点 7 个），直方图 14px×7 16px×1`，同时 `scrollWidth=1024 clientWidth=1024` —— 即**正是那个「溢出矩阵全绿、密度却整条路由错档」的洞**，现在被这条断言挡住。两次临时改动均已还原（`git diff` 相应文件为空）。
- **修复前基线（同一脚本，改动前）**：`375/384`，9 格红——`stashes` 在 360/480 两档两主题 `scrollWidth 492 > clientWidth 360/480`（越界元素 = 该行 5 个操作按钮的 `<span>`/`<button>`），另有 4 格是**断言脚本自身的测量竞态**（主题首帧兜底、Monaco 拖动时滑块在视口外、EllipsisText 悬停目标不可见），已逐条修断言而非改产品。**五次运行（375 / 381 / 377 / 374 / 384）的公共事实：凡拿到数字的格子，`scrollWidth > clientWidth + 1` 的从未出现过**（首轮那次已修的产品缺陷除外）。
- **例外①实测**（browse）：360 → side/main 各占满容器（328/328，纵向堆叠）；768 → side 300 / main 424（左右并排）；1440 → side 300 / main 1096。log 页（侧栏在右）：768 → main 448 / side 320。
- **例外②实测**（`dark/360 diff`，文件 `src/app.ts` 含 115 字符长行；数字取自 **Fix round 3 定稿版脚本整轮**的产物 `fluid-r7-next.json`，web-koa 同轮 `fluid-r7-koa.json` 与之一致）：Monaco 内容（`.view-lines`）694px > 编辑器 276px，编辑器宿主自身 `scrollWidth 276 == clientWidth 276`（不溢出），**拖动横向滚动条后内容左移 388px**，同时 `documentElement.scrollWidth 360 == clientWidth 360`。六档实测位移：360 → **388px**、480 → 249px、768 → 58px、1024 → 204px，1440/1920 两档长行放得下（1920：内容 870 ≤ 编辑器 937）按否定式通过。
  > **数字更正（Fix round 3）**：本行原写「拖动横向滚动条后内容左移 **195px**」——与同一节引用的运行产物（一直记的是「左移 388px」）自相矛盾，且 195 在那个产物的任何一格都找不到出处（应是手抄/早期草稿残留）。现按**本轮定稿版脚本的实测产物**统一改写为 388px，并注明它出自哪一次运行；与之同源的本报告 §2.2 一直是 388px/249px/58px/204px，两者现已一致。
- **EllipsisText 浮层实测**：重置弹窗内 `短哈希 + 提交信息` 溢出（438 > 423）→ 悬停弹出浮层且文本 = 完整值 `1ccdf5b docs(smoke): sign-off 提交冒烟（F-055 amend 到历史提交后）`；submodules 页 URL 在 **360** 档溢出（196 > 81）、**480** 档同样溢出（196 > 158）也弹出，768 档起不溢出（768：230 ≤ 230）则**不弹**（antd 以真实溢出为准）。

**浏览器 ↔ CLI 互证**（页面数字与仓库事实一致；CLI 在 `D:\zhanglei1120\Github\rebased-smoke`）：

| 页面 | 页面显示 | CLI 复核 |
|------|----------|----------|
| 日志页 `/repos/:id` | 分支 `sub-b`；提交行 23 行 | `git branch --show-current` = `sub-b`；`git log --oneline \| wc -l` = 23 |
| 贮藏页 | 贮藏列表（2）；`stash@{0} On master: smoke-f084-unstash-as`、`stash@{1} …smoke-f085-diff` | `git stash list` 同样 2 条、文本逐字一致 |
| 子模块页 | 子模块（2）：`vendor/sub-module` **提交漂移** `8a740f7` → `smoke-sub`；`vendor/dir.with.dots` **已检出** → `smoke-sub2` | `git submodule status`：`+8a740f7… vendor/sub-module`（`+` = 检出提交与索引不一致 → 页面「提交漂移」）、` 1a70317… vendor/dir.with.dots`（无 `+` → 「已检出」） |
| 工作树页 | 工作树（2）：`rebased-smoke [sub-b] 4f27441 当前`、`rebased-smoke-wt [wt-branch] 79e9129` | `git worktree list` 两行路径/分支/短哈希逐字一致 |
| 标签页 | 标签列表（2）：`v1.0`、`v9.9.9-smoke`（附注） | `git tag` = `v1.0`、`v9.9.9-smoke` |
| 远程页 | 远程列表（1）：`origin → D:\zhanglei1120\Github\smoke-remote` | `git remote -v` 同 URL |
| 状态页 | 工作区（2）= `.gitignore (M)`、`vendor/sub-module (M)`；未跟踪（5） | `git status --porcelain`：`^ M` = 2 条；`^??` = 5 条（crlf.txt / scratch/ / stash-untracked-probe.txt / vendor/conflict-sub/ / vendor/ok-sub/） |
| 分支页 | 本地行 10、远程行 8、`清理已合并（3）` | `git branch` = 10、`git branch -r` = 8、`git branch --merged HEAD` = 5 → 减去当前分支 `sub-b` 与 worktree 占用的 `wt-branch` 恰为 3（D-20 的排除逻辑） |

#### 缺陷登记（D-38 未修复；D-35~D-37 已修复，压缩为一行，明细见 §5.24）

| 编号 | 现象 | 根因 | 修复 | 复验 |
|------|------|------|------|------|
| D-35~D-37 | 三项渲染/视觉回归（web-koa 日志页冷启动白屏、360/480 档贮藏行横向溢出、`Tooltip > Button type="link"` 被拉伸到整行宽） | 已逐项修复：hook 顺序前置（与 web-next 容器对齐）、贮藏行加 `wrap`、38 处调用点加 `alignSelf: flex-start` | 当轮六档复跑全部通过（koa 192/192、web-next 384/384，`stashes` 六档 `scrollWidth == clientWidth`）；D-37 的**修复后态**见 `responsive-1440-console.png`（修复前那张 `link-stretch-*-before.png` 已按 §5.19 的既定口径随失效证据一并归档删除：缺陷已修，失败态像素在当前代码下不可复现，保留只会与「在盘图 = 当前 UI」的账目口径冲突） | 逐条明细已按「只保留对后续迭代有用的内容」归档（见文末说明），如需追溯用 git 历史中的本文档旧版 |
| D-38 | **`?select=` 日志页的提交详情栏在首帧后短暂整块消失（约 0.5s）再回来**：480px 实测时间线（60 次 / 50ms 采样压成段）——`commit-details` 与两个 `SplitPane` 宿主在 ~25ms 同时出现 → ~540ms 起**三个一起消失** → ~800ms 重新挂上后稳定；8 轮探针复现 1 轮。后果两条：① 该窗口内采样「两栏宿主」得到「未找到宿主」（与布局无关的红）；② 更危险的是此刻的**页面级溢出断言量在一个「详情栏还没装回来」的页面上** —— 空页永不溢出，那是白通过 | 容器侧 `selectedCommit = commits.find((c) => c.hash === selectedHash) ?? null`（`apps/web-next/app/repos/[repoId]/page.tsx:179`）：提交列表在挂载后被重新装配的那一瞬间为「找不到」，`LogPage` 走 `selectedCommit ? <SplitPane> : 主区独占满宽` 的 else 分支，侧栏连同两个宿主一起卸载。这是**另一会话刚提交的「提交历史按需分页」**（`899f1a9` / `18a405c`）引入的渲染瞬时态，与 Task 16 的改动无关 | **本轮未修复**（不在 Task 16 范围，且属他人正在演进的功能，不动其代码）：只把断言改成「采样时若宿主缺席，**有界等它回来（10s）+ 等布局静止**再量」，使判定不落在该瞬时态上；宿主**确实**缺席时照旧判红 —— 负向验证：把「在不在」的判据与等待选择器同时换成必然不命中的值 → 该格如实报「未找到 split-side-host / split-main-host 宿主（采样时缺席，再等 10000ms 仍未出现）」 | 该格定向复跑：修复前 5 次红 1 次；修复后 14 次全绿，其中实测到 2 次真的「采样时缺席」（等待 800ms / 780ms 后回来）并写在通过原因里，其余各次宿主都在、走原路径（无等待、无额外 `settle`）。建议由该功能的负责人补一条「列表重装配时不丢选中」的用例 |

#### ④ 未覆盖项与后续计划
- **`merge` 路由格的「绿」是**绿在空页上**（终修补记）**：`/repos/:id/merge` 整页只有一个**常驻打开**的 Modal，它经 `createPortal` 挂在 `body` 上，而页面级断言量的是 `document.documentElement` —— 文档里除了一层空的布局根之外没有别的内容，**空文档永远不会横向溢出**，故该格的通过只等价于「这一页没有溢出源」，不含任何内容级证据。它与下面两条 Modal 格的「只证明弹窗背后的页面不溢出」是同一类口径限制（理由同 ① 的口径说明：`.ant-modal-wrap` 是 `position: fixed; overflow: auto`，内部溢出被它自己吃掉）。**终修后这一格的密度仍被正面断言**（取样覆盖 portal：修复前弹窗为 antd 默认 14px、修复后为紧凑 12px，见 §6.5 的按路由密度断言与本节 ③ 的密度记账），但那说的是文字大小，不是溢出几何。
- **弹窗（overlay）内部的横向溢出**未覆盖：本轮两条 Modal 格按页面级口径只证明了「弹窗背后的页面不溢出」（原因见 ① 的口径说明——`.ant-modal-wrap` 是 `position: fixed; overflow: auto`，内部溢出被它自己吃掉，且测量助手跳过 `position: fixed` 元素）。后续补一轮把度量对象换成 `.ant-modal-wrap` 自身：断言其 `scrollWidth <= clientWidth + 1`，或断言 `.ant-modal` 内不存在右边界超出 wrap 的元素 —— 那才真正证明「弹窗内容不横向溢出」。
- **conflicts 页的冲突行态**未覆盖（本轮只断言了「无冲突」空态），理由见 ①；后续在 `rebased-smoke-conflict` 上现造 merge/rebase 冲突后补一轮。
- **GitHub/GitLab 的真实远端数据**未覆盖（无 PAT）：本轮只覆盖「展开差异」这一最易溢出的渲染形态；真实 PR/MR 列表、时间线、行级评论的几何未测，与 R17 的跳过项同源。
- **Monaco 在 1440/1920 档不产生内部横向滚动**（长行放得下）——这是正确行为而非缺口，若后续引入更长行，该档断言会自动转为「内部滚动」分支。
- **交互态宽度**（抽屉/下拉/气泡在窄屏的边缘贴合）不在本轮口径内；本轮口径只有页面级横向溢出 + 两条例外。
- 后续回归入口：`node scripts/check-fluid-layout.mjs --app=koa --themes=dark`（约 12 分钟）与不带参数的全量（约 25 分钟）；两者任一红即视为布局回归。
- **跑验收前请确认「没有别的会话在改被测代码、也没有人在同一夹具仓库上切分支」**：本轮实测到两种会伪造红的并发活动 —— 另一会话改 `commit-graph.tsx` 期间日志页整页不渲染（页面 `ReferenceError` + `data-theme=null`），另一会话在夹具仓库里 `master ↔ sub-b` 来回 checkout（`git reflog` 可查）。出现「一批格子同时报就绪超时且 `data-theme=null`」时，先按这两条排查，再怀疑布局。

### 5.17 R23 缺陷登记与纠偏（2026-09-12）

#### 未修复缺陷（D-43：偶发、未复现）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-43 | **硬杀 dev 服务后「二级嵌套」API 路由 404、设置页 GPG 卡片等静默消失**（P2；**偶发，未能按需复现**——见右列复核）：原发现于 F-152 真重启之后，dev 日志显示 `GET /api/repos/:id/settings/gpg-config` **404（HTML not-found，8~53ms）**，同批 `commit/amend-targets`、`staging/hunks`、`browse/content` 亦 404，而 `/api/settings`、`/api/repos/:id/config` 始终 200 | `taskkill /T /F` **硬杀** Turbopack dev 进程后，`apps/web-next/.next`（本机实测 4.15~7.3 GB）留下不一致缓存，重启时**部分嵌套路由条目解析丢失**；一级路由不受影响，故表现为「部分接口 404、页面静默少一块」。原发现时的上下文是**浏览器正在连续访问、dev 同时在写缓存**时被硬杀 | **本轮未修复**（环境面 + 产品面各一半）：环境处置——① F-152「真重启」**优先优雅退出**（Ctrl+C / 结束 dev 脚本而非 `/F`）；② 一旦出现嵌套 404，删 `apps/web-next/.next` 再重启即可（原发现时即以此恢复，恢复后全站 200）。产品面建议——对路由缺失给出可读提示，而非静默 404 + 卡片消失 | **复现性（2026-09-12 复核，两次尝试均未复现）**：① 干净硬杀（`taskkill /PID <cmd> /T /F` → 重启）→ `settings/gpg-config`、`commit/amend-targets`、`browse/content` **全部 200**，日志无 404；② **带并发负载硬杀**（后台持续打这 5 个路由，2s 后 `/T /F`）→ 仍全部 200、日志无 404。结论：**症状与处置有效但为条件触发**（需命中缓存写入窗口），不能按需稳定复现；证据仍以原发现时的日志 `%TEMP%\rebased-dev-restart.log`（404 行）与恢复日志 `rebased-dev-restart2.log`（全 200）为准。**取证/运维口径**：遇到「一级 200 + 嵌套 404 + 页面少一块」先删 `.next` 重启，不要先怀疑业务代码 |

> D-39/D-40/D-41/D-42（本节原登记项）与收官阶段的 D-44 已修复并复验：修复落点、回归守卫与实测证据见 §5.20。

#### 流程与夹具纠偏

| 编号 | 现象 | 处置 |
|------|------|------|
| P-12 | **「amend 到…（指定历史提交）」在 rebase 冲突后中止，会在分支 tip 留下一笔重复提交**——F-055 首轮：以 `src/app.ts` 为载荷 amend 到最老候选 `fix(core)` 时，该文件已被中间提交（F-044/F-052/F-053 探针提交）改过 → rebase 冲突 → 自动跳 `/conflicts`（行为正确）；此时**中止**，`reflog` 显示操作次序为「先 `commit`（把载荷以目标信息提交到 tip）→ 再 `rebase` 到目标父提交」，故 abort 回到的是「已含该新提交」的 `refs/heads/master`，tip 多出一笔与目标信息同名的提交（本轮实测 `5cd5385`，随后用 `git reset --soft HEAD~1` 回退） | 非产品缺陷登记，属**观察项**（语义可解释：载荷提交是 rebase 的输入）。后续轮次若要复现 F-055，**载荷应选不会被中间提交触碰的文件**（本轮改以新增文件 `f055-folded.txt` 为载荷后一次通过）；若已陷入该态，用 `git reset --soft HEAD~1` 回退后重试 |
| P-13 | 界面上「工具提示压住确认按钮」会让自动化点击落空：`移除`（首页行）、`hunk-check-N`（补丁预览）等控件的 Tooltip 会覆盖相邻的 Popconfirm/批量按钮，Playwright 报 `… intercepts pointer events` | 自动化处置：点击前先把指针移到空白处（`hover body`）令 Tooltip 消失；属 antd Tooltip 的既有行为（真人移动鼠标即消失），**不计产品缺陷**，仅记录以免后续轮次重复踩坑 |
| P-14 | 两条与环境/夹具有关的边界（行内已写明）：① **F-013** 大仓 `git log` 进程窗口仅 ~140ms，短于一次导航往返，20ms 采样在「打开→立即离开」窗口内未捕获到进程，故只能证「离开后无残留」（`Get-Process git` = 0），杀进程正向路径由 `core/src/exec.ts` 的 `killTree` + `exec.test.ts`「进行中 abort：以 130 拒绝」覆盖；② **F-041** 会真实删除 `docs/gone.md` 的 D 态与未跟踪目录 `scratch/`，取证后已用 CLI 复位夹具（重删 `docs/gone.md`、重建 `scratch/todo.md`） | 均已按上处置，夹具状态在行内注明 |
| P-15 | **F-061（撤销最近提交）留给夹具的暂存态会阻塞后续检出/合并/变基**：该行按 soft reset 语义把被撤销提交的改动放回暂存区（本轮是 `M docs/new-name.md`），而 §4.7 起的行大量需要 `git checkout`——UI 检出会如实报 `Your local changes to the following files would be overwritten by checkout: docs/new-name.md`（**夹具态与 git 语义的必然冲突，非产品缺陷**） | 处置：先 `git stash push --staged -m "<守卫名>"` 把暂存态移出工作区/索引（`--staged` 只动暂存部分，工作区其余不受影响），跑到需要该态时再 `git stash apply --index` 还原。**注意**：这条守卫 stash 在 F-082（pop/apply/drop）、F-083（转分支）、F-084（Unstash As）等行里绝不能被消费掉，须每步 `git stash list` 复核 |
| P-16 | **F-071「检出并变基到当前」在旧夹具上必然跑成整段重放 + 子模块冲突**：F-069 造的 `origin/fetch-probe` 是从远端裸仓直接推入的**无共同祖先**分支，CLI `master...origin/fetch-probe` 报 `no merge base`——界面照原样执行会把本仓整段历史重放到该分支上，并停在 `vendor/dir.with.dots`、`vendor/sub-module` 的冲突上（**夹具选型问题，非产品缺陷**；该行要验的是「远程 → 新本地分支 + rebase onto 原当前分支」，需要一个与当前分支同源的远端分支） | 处置：`git rebase --abort` 复原后另造干净远端分支 `origin/rebase-probe`（= `origin/master` + 1 提交）重跑该行，一次通过。**后续轮次建议**：F-069 的 probe 分支改从 `origin/master` 派生（同源 ahead 1），F-070 的分叉与 F-071 的检出可共用它，避免再出现无共同祖先的夹具 |
| P-17 | **F-066 的清理会真删夹具分支**：本轮它删掉了本地 `feature` 与 `merged-branch`（`wt-branch` 因 worktree 占用被排除、`master` 是当前分支），后续行（如 F-073 合并页的本地分支列表、F-088 推送标签）与旧轮次记录的分支清单会随之变化 | 按需还原：`git branch feature origin/feature`、`git branch merged-branch 761961d`；本轮行内已按实际清单记录（见 F-073 等行） |
| P-18 | **F-061 留下的「暂存区 M docs/new-name.md」在 §4.7~§4.12 收尾时已无法按原样还原**：守卫 stash（对象 `a0b53a2`）的内容（`docs/new-name.md` 的 `+F-058 提交并推送探针行`）在 F-055「amend 到历史提交」重写历史后**已进入 master 历史**，故 `git stash apply --index a0b53a2` 报 `patch does not apply`（等价于已应用）；确认内容确在 HEAD 后已 drop 该守卫（对象仍在库内，需要时 `git stash apply a0b53a2` 可取回） | 不视为缺陷（夹具时序的自然结果）。后续轮次若需要「暂存区有改动」，随意 `git add` 一个改动即可；若需要「§1.3 原始暂存三态（R/A/M）」，跑 `scripts/smoke-setup.ps1` 重建主仓最省事 |
| P-19 | **§4.7~§4.12 的探针产物留在夹具里**（有意保留，便于回溯各行截图背后的仓库状态）：本地分支新增 `rebase-topic`（F-076/079/080）、`rebase-probe-local`（F-071）、`stash-branch-f083`（F-083）、`unstash-target`/`unstash-target-2`（F-084）、`smoke-new-checkout`（F-065）等；标签新增 `v9.9.9-smoke`/`v9.9.9-light`（F-086）；stash 多出 `smoke-stash-f081`（F-081）；远程 refs 多出 `origin/rebase-probe`、`origin/fetch-probe-r8`、`origin/pr-9` 等；**浅克隆仓已按 F-091 解除浅克隆**（rev-list 1→7），如需复现前置态须重新 `git clone --depth 1` | 后续行按实际状态取证并如实记录；需要干净基线时跑 `scripts/smoke-setup.ps1` |
| P-20 | **写 `%USERPROFILE%\.rebasedjs\config.json` 必须用「无 BOM 的 UTF-8」**——本轮 18:49 用 PowerShell 的 `Set-Content`/`Out-File`（PS 5.1 默认带 BOM）写该文件，3 字节 BOM 让全站 400（见 D-42），排查与恢复花了数分钟 | 统一写法：`[System.IO.File]::WriteAllText($p, $json, (New-Object System.Text.UTF8Encoding($false)))`；**自检也要用 Node**（`node -e "JSON.parse(require('fs').readFileSync(p,'utf8'))"`）而非 `ConvertFrom-Json`（后者容忍 BOM，会给出假绿）。同一条规则适用于 `scripts/smoke-setup.ps1`（该脚本为 PS 5.1 + 中文注释，**必须**保留 UTF-8 BOM——两处规则相反，别混用） |
| P-21 | **行文与实测不符（口径更正，非缺陷）**：两条 Modal 的描述比实现更宽——① §4.14 F-096 写「拉取 Modal → 选远程/**分支**」，实测 `pull-remote-select` 只有**远端**下拉 + 「使用 rebase 而非 merge」勾选，**没有分支选择器**（分支随当前分支的上游跟踪）；② §4.15 F-100 的 `Reset to tracked` 在「无上游」时**整块不渲染**（已按实测记录）。 | 行文已就地改为「选远程（分支随上游）」；后续新增行请照实测描述，不要沿用 Java 版的措辞 |
| P-22 | **`Copy-Item` 偶发「静默未生效」**：把 MCP 输出根的截图复制进 `docs/shots` 时，出现过一次命令成功但目标仍是**上一轮的旧图**（源文件时间戳与目标相同导致 Copy-Item 跳过） | 收尾必须逐张 `Get-FileHash` 比对源/目标，或改用 `Copy-Item -Force` 后**重新哈希校验**；本轮两批收官均做了 22~35 张的全量哈希核对（第二批即因此发现并重拷了 push-03/push-03b） |
| P-23 | **代码注释过期（仅注释，非运行时问题）**：`packages/client/ui/src/composite/worktree-panel.tsx` 文件头仍写「不携带 force——force 仅终端使用」，而 D-32 之后该面板已有「强制移除（--force）」勾选框（`data-testid=worktree-force-<path>`） | 建议随手把该注释改成「确认框可选 `--force`（D-32）」；本轮按观察登记，不改代码 |
| P-24 | **「更新全部」非乐观刷新**（设计内，取证需注意）：服务端 4 个子模块 `git submodule update` 耗时 >3 s，期间列表仍显示旧状态（如「提交漂移」），POST 返回后才更新；按钮有 acting 禁用态。第一次取证抓到的就是过期画面 | 截图前等 POST 落地（或等列表文案变化）再拍；已在 F-131 行内注明 |
| P-25 | **本轮被实测推翻的文档括注（已在各行就地改写）**：① F-132 的忽略内容区是 antd `Input.TextArea`（rows=10），**不是**带行号的 Monaco；② F-156 现为 **18 个文件 / 2 个 gitlink（dir.with.dots、sub-module）/ 根提交 `56f751ab`**（旧记录 17 / 4 / `3236538` 系四态夹具与旧历史下的结果）；③ F-149 的 `recentRepoIds` 现为 **10** 条（旧记录 8）；④ F-155 的目标提交在 `origin/master` 上，而 `origin/master` 经 F-070 强推后已是 `a91ade7`（`761961d` 仍是其祖先）；⑤ F-111 的 grep 词现命中 **18** 条、pickaxe 词改为 `staged new file`（`staged-only` 0 命中）；⑥ F-113 的 `fetch-probe-local` 分支已不存在（改用 `diverge-test`）；⑦ F-117 合并提交为 `ec1320f` | 后续轮次请以**当场 CLI 实测**为准，不要沿用本文档任何历史 hash/计数——本会话对主仓历史做过多次改写（F-055 amend 到历史、F-059 hard reset、F-070 强推修复、F-066 删分支、§4.24 后移除四态子模块夹具） |
| P-26 | **运行环境的两次外部变化**：① **有并行会话在同一 `rebasedjs` 仓提交**（`b41ccaa chore: 收纳并行会话的在途改动（截图重拍/documents/冒烟脚本）`，19:45:32，把本轮当时已产出的截图一并入库；另有 `8af62ff`/`aa3e24f` 改 UI 控件尺寸）→ 本轮截图与文档改动会陆续进入仓库历史，工作区里可能残留未提交的图；② **dev 服务在 F-152 后被以分离进程重启**（cmd PID 11852，父进程已退；日志 `%TEMP%\rebased-dev-restart[2].log`）——重启会清空 exec 环形缓冲（F-145 的控制台证据必须在重启前取），且硬杀易触发 D-43 | 收尾账目以工作区实际文件为准（不依赖 git 状态）；若后续轮次需要干净基线，先确认无并行会话在写同一仓 |
| P-27 | **两条截图自动化的实测坑（收尾批踩到，写进口径免得重复踩）**：① **`browser_hover('body')` 不能用来「把指针移开」**——body 中心可能正好压在 antd 帮助图标上，会把 Tooltip 拍进画面（`responsive-768-light-settings.png` 首次即中招并重拍）；可靠做法是 `page.mouse.move(1434, 892)`（右下角空白）并等 ~700ms。② **antd 是 v6.6.3：toast 根节点是 `.ant-message.ant-message-list.ant-message-top`，不存在 v5 的 `.ant-message-notice-content`**；按 v5 类名轮询会「10s 未命中但操作其实已成功」。可靠做法是**文本轮询 `document.body.innerText` 命中目标文案后立即截图**——实测「提交并推送」的 toast 在**点击后约 2.8 s** 才出现、停留约 3 s，窗口很窄 | 两条已并入 §1.2 的截图口径；后续批次一律「文本轮询 → 立即截图」+「鼠标移到右下角」 |
| P-29 | **Turbopack 错误代码框的多字节 panic 会把整个 dev 服务带走**（2026-09-12 实测连续 4 次；即旧记录里的「E-01」）。链路：① 被编辑文件处于**瞬时错误态**（本次是 `apps/web-next/app/repos/[repoId]/settings/page.tsx` 作为 Server Component 却 import `useRouter`/客户端 hooks，缺 `'use client'`）；② Turbopack 为该诊断渲染代码框时命中 `next-code-frame` 的 Rust panic——`end byte index 93 is not a char boundary; it is inside '一' (bytes 91..94) of \`/** 树节点：title 为展示名… */\``；③ 进程以 `0xC0000409`（fail-fast）退出，`pnpm -r dev` 随即连带中止 web-koa（:3082）→ 用户侧表现为**整站突然打不开**。**取证特征**：日志里前面的请求全是 200，紧接着一条 `thread '<unnamed>' panicked at crates\next-code-frame\src\highlight.rs`，最后 `Exit status 3221226505`（**panic 会把真正的编译错误盖掉**，看不到错误正文） | ① **先拿到真实错误**：用 webpack 跑一次（`pnpm --filter @rebased/web-next dev -- --webpack`），错误正文照常打印（本次即据此定位到缺 `'use client'`）；② 修掉诊断本身（给该页补 `'use client'` 或把 hooks 下移到客户端子组件）后，Turbopack 不再产生该诊断、dev 稳定；③ 重启前若曾用 webpack 跑过，**必须删 `apps/web-next/.next` 再回到 Turbopack**，否则 webpack 与 Turbopack 的缓存混用会出现 `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`（各页 500）；④ 多会话共用一台机时先确认 :3081/:3082 归属再起（本次有一次重启因端口被另一会话的 dev 占用而 `EADDRINUSE` 失败）。**与 D-43 区分**：D-43 是 `.next` 缓存不一致导致的偶发嵌套 404（一级 200 + 二级 404），本条是「编译诊断 + 中文代码框」触发的**确定性**崩溃（全站不可达） |
| P-30 | **「Monaco 语法高亮」在此前所有轮次里都是误判**（2026-09-16 定位并修复；不是文档笔误，是真缺陷）。链路：`monaco-editor` 的主入口把 json/css/html/typescript 四个「语言服务」一起装上，其中 typescript 服务挂在 `onLanguage('javascript')` 上——**打开任意 `.js`/`.ts` 文件**它就 `editor.createWebWorker()`，worker 侧再 `import('vs/language/typescript/tsWorker.js')`；而 ESM 构建里该 URL 由 `FileAccess.asBrowserUri()` → `moduleIdToUrl.toUrl()` 现算，`moduleIdToUrl` 是 AMD 版 `require.toUrl()` 的产物、ESM 里根本不存在 → 实参 undefined、控制台持续 `TypeError: Cannot read properties of undefined (reading 'toUrl')`（栈落在 `editorSimpleWorker.$loadForeignModule`）。即便绕开抛错，语言模块也不是打包产物、浏览器取不到。**此前两次「修」都押在 `globalThis._VSCODE_FILE_ROOT` 上**（先主线程设路径、再 Blob 包一层注入 worker 上下文），方向错了：那个全局只影响 `toUri` 走哪条分支，治不了「worker 侧要 import 一个不存在的模块」。**与高亮的因果**：已证实的只有事实层面的对应——关掉这四个语言服务后，同一页面同一文件的可高亮 token class 由 1 种变为 7 种（`.js`）/6 种（diff 页），控制台由持续报错变为 0 error；Monaco 内部为何会因此丢掉 basic-languages 的 Monarch 分词**没有逐行调试到**，此处只登记事实与修法，不编造机理。另一处独立缺口：`DiffPage`/`ThreeWayView`/`HunkDiffView`/`MergeView` 都不传 `language`，Monaco 退到 `plaintext`——即使 worker 正常，这几处也永远不会高亮 | 已修（`packages/client/ui`）：① `base/monaco-lazy.tsx` 按**语言服务**粒度关掉全部 worker 能力（`restrictModeFeatures` 遍历 css/less/scss/html/razor/handlebar/json/typescript/javascript 九个 defaults，逐个把 modeConfiguration 关掉，**只给 json 保留 `tokens`**——它的分词器在主线程跑，且 `basic-languages` 里没有 json）；高亮改由 `basic-languages` 的 Monarch（主线程）提供。② 四处视图按文件扩展名推断语言（`domain/language.ts` 的 `languageForPath`，与日志页内联快照同一套口径）：`DiffPage`、`ThreeWayView`、`HunkDiffView`（新增 `path` prop，github/gitlab 面板传入）、`MergeView`。③ 回归锁定：`monaco-lazy.test.tsx`（九个 defaults 的裁剪结果 + `getWorker` 装配）、`diff-page/three-way-view/hunk-diff-view/merge-view` 各自断言语言透传。**能力边界（写文档时注意）**：这条打包链路上 Monaco **不提供补全/诊断/悬浮/格式化等语言服务**，只做语法高亮——`docs/manual.md`、`docs/pages-and-api-audit.md` 里不要写「有补全/校验」。**浏览器实测**（:3081）：快照浏览 `.js` 43 行 7 种 token class、`.json` 4 种；diff 页 6 种；三处控制台均 **0 error / 0 warning** |
| P-31 | **状态页「补丁预览」的代码高亮落地（2026-09-17，需求来自用户对 DOM47 `<pre data-testid="hunk-text-0">` 的标注）**。此前那两块是裸 `<pre>`：只有 `font-family: monospace`，`+`/`-`/`@@` 与代码本体一个色。**为什么不用 Monaco**（本仓既有口径）：这两块是**只读小片段**（一个 hunk 十几行、整份补丁几十行），按块起 `createDiffEditor` 的代价随 hunk 数线性增长；仓库里 `DiffPage`/`ReadonlyTextView`/`HunkDiffView` 要的是编辑器语义（行号、光标、横向滚动、并排 diff），保持 Monaco。**落地**：`base/shiki-lazy`（细粒度 `createHighlighterCore` + `createOnigurumaEngine(import('shiki/wasm'))`，11 种语法按需静态引入，双主题一次输出：浅色写 `color`、深色写 `--shiki-dark`，两者同在 `token.htmlStyle` 里）+ `base/code-block`（loader 注入点、未就绪先出纯文本、结果按 code/语言/行种类缓存、`maxHeight` 滚动外壳）+ `domain/highlight`（纯函数：行标注 `decoratePatchLines` 与 token→HTML `renderHighlightLines`）；`status-page` 的 hunk 正文与整份补丁兜底都换成它，语言按 `languageForPath(patch.path)` 推断、推不出退 `diff`；`hunk-text-*`/`patch-text` 两个既有 testid 移到外层包裹上，测试契约不变。**实测**（:3081 真实页面，`proxyGateway` 的未提交改动当夹具，验证后已 `git checkout` 还原）：同一 hunk 18 行、浅色 7 种 / 深色 7 种**不同的计算颜色**（`data-theme` 翻转生效）、增删行底色与 `.diff-marker` 前缀正确、**控制台 0 error**；`next build` 生产产物里 shiki 是独立懒加载 chunk **1378KB raw / 342KB gzip**（内含 wasm base64），构建 exit 0。**两处冒烟才暴露的坑**（已修 + 已加回归）：① 双主题下浅色**不在 `token.color`** 而整体在 `token.htmlStyle`，按 `color` 拼样式会写出 `color:undefined`（页面一片同色）——`renderHighlightLines` 单测守着；② `<pre>` 若用 `white-space: pre`，JSX 子元素之间的格式换行会被当内容渲染，每个补丁行之间多一条空行——改为 `.line { white-space: pre }` + `pre { white-space: normal }`，`code-block.test.tsx` 断言「行之间不夹文本节点」。**遗留**：本轮首次截图两次"落不了盘"，原因**不是工具缺陷、也不是访问被拒**，而是我的探针姿势错了：① 第一次截图时页面上**根本没有 `[data-testid="hunk-text-0"]`**（那时仓库工作区还是干净的，补丁预览无内容），工具按"元素不存在"报错；② 之后用**纯文件名**再拍，工具回报成功、文件也真的写进了它自己的允许根，而我按项目内相对路径去找，自然找不到。按 AGENT.md「MCP 浏览器」五步走一遍即解：传项目内绝对路径当探针 → 得到 `File access denied … Allowed roots: D:\…\deepseek-harness[\.playwright-mcp]` → 改用**纯文件名**落盘 → `Move-Item` 按绝对路径搬进 `docs/shots/`。 | 已改（`packages/client/ui`）：`src/base/shiki-lazy.tsx`、`src/base/code-block.tsx` + `code-block.css`、`src/domain/highlight.ts`、`src/composite/status-page.tsx`、`src/index.ts`；`@rebased/ui` 加依赖 `shiki@^4.4.3`。测试：`highlight.test.ts`（10）、`code-block.test.tsx`（8）、`status-page.test.tsx` 新增「补丁预览代码高亮」3 例；`pnpm --filter @rebased/ui test` 915 全绿、`typecheck` 通过。**注意**：`apps/web-koa` 的 `build`/`typecheck` 在本工作区**本来就是红的**（未提交的 `pages/repo.tsx` 引用了 `url-select.ts` 里不存在的 `withSnapParams`；另有 `PANEL_AGGREGATE`/`browseFilePath` 未定义），与本次改动无关，故 Vite 侧产物未单独复验——Shiki 的打包验证取自 `next build` 的真产物 || P-30 | **「Monaco 语法高亮」在此前所有轮次里都是误判**（2026-09-16 定位并修复；不是文档笔误，是真缺陷）。链路：`monaco-editor` 的主入口把 json/css/html/typescript 四个「语言服务」一起装上，其中 typescript 服务挂在 `onLanguage('javascript')` 上——**打开任意 `.js`/`.ts` 文件**它就 `editor.createWebWorker()`，worker 侧再 `import('vs/language/typescript/tsWorker.js')`；而 ESM 构建里该 URL 由 `FileAccess.asBrowserUri()` → `moduleIdToUrl.toUrl()` 现算，`moduleIdToUrl` 是 AMD 版 `require.toUrl()` 的产物、ESM 里根本不存在 → 实参 undefined、控制台持续 `TypeError: Cannot read properties of undefined (reading 'toUrl')`（栈落在 `editorSimpleWorker.$loadForeignModule`）。即便绕开抛错，语言模块也不是打包产物、浏览器取不到。**此前两次「修」都押在 `globalThis._VSCODE_FILE_ROOT` 上**（先主线程设路径、再 Blob 包一层注入 worker 上下文），方向错了：那个全局只影响 `toUri` 走哪条分支，治不了「worker 侧要 import 一个不存在的模块」。**与高亮的因果**：已证实的只有事实层面的对应——关掉这四个语言服务后，同一页面同一文件的可高亮 token class 由 1 种变为 7 种（`.js`）/6 种（diff 页），控制台由持续报错变为 0 error；Monaco 内部为何会因此丢掉 basic-languages 的 Monarch 分词**没有逐行调试到**，此处只登记事实与修法，不编造机理。另一处独立缺口：`DiffPage`/`ThreeWayView`/`HunkDiffView`/`MergeView` 都不传 `language`，Monaco 退到 `plaintext`——即使 worker 正常，这几处也永远不会高亮 | 已修（`packages/client/ui`）：① `base/monaco-lazy.tsx` 按**语言服务**粒度关掉全部 worker 能力（`restrictModeFeatures` 遍历 css/less/scss/html/razor/handlebar/json/typescript/javascript 九个 defaults，逐个把 modeConfiguration 关掉，**只给 json 保留 `tokens`**——它的分词器在主线程跑，且 `basic-languages` 里没有 json）；高亮改由 `basic-languages` 的 Monarch（主线程）提供。② 四处视图按文件扩展名推断语言（`domain/language.ts` 的 `languageForPath`，与日志页内联快照同一套口径）：`DiffPage`、`ThreeWayView`、`HunkDiffView`（新增 `path` prop，github/gitlab 面板传入）、`MergeView`。③ 回归锁定：`monaco-lazy.test.tsx`（九个 defaults 的裁剪结果 + `getWorker` 装配）、`diff-page/three-way-view/hunk-diff-view/merge-view` 各自断言语言透传。**能力边界（写文档时注意）**：这条打包链路上 Monaco **不提供补全/诊断/悬浮/格式化等语言服务**，只做语法高亮——`docs/manual.md`、`docs/pages-and-api-audit.md` 里不要写「有补全/校验」。**浏览器实测**（:3081）：快照浏览 `.js` 43 行 7 种 token class、`.json` 4 种；diff 页 6 种；三处控制台均 **0 error / 0 warning** |

#### R1 夹具与流程纠偏（P-01~P-05；非产品缺陷，记入以免后续轮次重复踩坑）

| 编号 | 现象 | 处置 |
|------|------|------|
| P-01 | 主仓 master 未设 upstream → 状态条不显示 outgoing 徽标（F-018 前置缺失） | `scripts/smoke-setup.ps1` 增加 `branch --set-upstream-to=origin/master|origin/feature`；当场对既有冒烟仓补设 |
| P-02 | F-004 期望副文本 `~/Github/rebased-smoke`，而冒烟仓在 `D:`、主目录在 `C:`，`~/` 相对化按目录边界判定后正确地不生效 | 建目录联接 `C:\Users\zhanglei1120\Github\rebased-smoke` → `D:\…\rebased-smoke`，以 home 下路径注册复核（repo-page-04.png 同时展示「home 下 → `~/Github/rebased-smoke`」与「非 home 下 → 原样绝对路径」两种正确形态） |
| P-03 | F-019 需 CLI 切分支，但工作区脏（夹具使然）导致 `git checkout feature` 被拒 | 改为 `git checkout -b <同内容分支>`（同提交无覆盖风险）验证「状态变更自动刷新」，再 `checkout master` 复原；夹具工作区未被破坏 |
| P-04 | F-012 CLI 追加提交时 `git commit`（无 pathspec）把已暂存的夹具条目（重命名/新增/util 修改）一并提交，暂存分组被清空 | 判定为**冒烟操作失误**（非产品缺陷）：已用 `git mv` + `git add` 重建「暂存三态」夹具（R/A/M）；后续轮次 CLI 追加提交一律带 `-- <pathspec>` |
| P-05 | 冒烟仓构造脚本首版 `Git` 函数与 `git` 可执行文件同名 → 递归调用（call depth overflow）；`git worktree remove` 误对主工作树执行 | 函数改名 `Invoke-Git`；清理阶段仅对附属工作树执行 remove。脚本 `scripts/smoke-setup.ps1` 现可一键重建全部冒烟仓（主仓 8 提交含合并、2 处 stash、预置 worktree、A/D/R 工作区态、冲突仓、320 提交大仓、浅克隆仓、裸远端、非 git/空目录） |

#### R2 夹具纠偏（P-06~P-11）

| 编号 | 现象 | 处置 |
|------|------|------|
| P-06 | 大仓 `rebased-smoke-big` 的大文件改动**在最后一个提交里**、工作区是干净的 → diff 页默认「工作区 vs HEAD」两侧相同、`/diff/stream` 返回 0 字节，「大 diff 流式渲染」根本无从触发（F-035 首轮实测） | 在大仓工作区重写 big.txt（620 行 → 620 行改写，`git diff --stat` = 620 插入/620 删除），使工作区大 diff 常驻；`scripts/smoke-setup.ps1` 后续应直接产出该工作区态 |
| P-07 | 分支比较需要「双向都有独有提交」的分叉分支，而冒烟仓各分支均为包含关系（比较后一侧恒空） | 用管道命令造分叉分支而不动工作区/index：`git commit-tree <tree> -p 79e9129 -m …` + `git branch diverge-test <新提交>`；CLI 复核 `rev-list --left-right --count master...diverge-test` = `1 1`（F-038 证据） |
| P-08 | 变更列表「管理列表」下拉的每个列表各有一组「重命名/设为默认/删除」，自动化按文本 `.first()` 命中了**默认列表**那一组，误把默认列表改名（产品行为正确，菜单以分组标题区分归属） | 改用 `li[data-menu-id$="rename:<listId>"]` 精确定位；已把默认列表改回「默认」并重建证据；后续交互定位一律带 id 或分组作用域 |
| P-09 | 状态页行内按钮密集（移动到列表/三版本/注解/历史占满行宽），按行中心坐标点击会命中按钮而非行本体，导致「双击跳 diff」看似失效 | 改为定位行内文件名文本后双击（真实用户路径）；产品侧双击文件名与整行空白处均可达 |
| P-10 | 大仓工作区曾无未提交改动（大改动已提交）+ 主仓缺「两个 hunk」文件，hunk 级暂存与流式大 diff 都无从触发 | 大仓补 `hunks.txt`（40 行，改动第 5/35 行 → git 切成 2 hunk）常驻工作区；主仓两 hunk 尝试因文件过短合并为 1 hunk，改在大仓承载 F-042 |
| P-11 | 提交行右键菜单：先用 `boundingBox()` 取坐标再 `mouse.click`，因日志流（SSE）重排导致落点偏移到相邻行，误判「右键目标错位」为产品缺陷 | 改为对行 locator 直接 `click({ button: 'right' })`（原子动作，自动滚动与定位）；复测确认同一行右键 → Reword 弹窗预填该行信息（UI 侧本就一致） |

#### 本段夹具与断点（R23，2026-09-12）

- **主冒烟仓（重建后新 id）**：`rebased-smoke` → repoId `f761a9f6-5c91-4115-9261-69715687e875`（`D:\zhanglei1120\Github\rebased-smoke`；R23 起 id 与旧轮次不同：F-002 的「移除→重开」会重新分配 id，旧 `18726c5c-…` 已作废）。
- 其余 id（重建后仍按路径复用）：`rebased-smoke-conflict` `82168d54-…`、`rebased-smoke-big` `7649bb35-…`、`rebased-smoke-shallow` `450e90ca-…`、`rebased-smoke-noident` `b908870c-…`、`rebased-smoke-init` `9918c699-…`、`rebased-smoke-clone` `9b0168bb-…`、`rebased-smoke-wt` `aa675a60-…`、`rebased-smoke-huge` `f40d0c37-…`。
- `scripts/smoke-setup.ps1` 本轮已扩写（供后续轮次一键复现 §1.3 + 扩展夹具）：新增 ① 分叉分支 `diverge-test`（commit-tree 造，`master...diverge-test` = `1 1`）；② 冲突仓改为「四路冲突夹具、交付干净态」（合并 `feature` 到 `master` 即得 AA/UD/UU/UU，供 F-075/F-114~F-117）；③ 大仓 `hunks.txt`（40 行，改第 5/35 行 → 2 hunk 常驻工作区）与 `big.txt` 工作区改写（620 行大 diff 常驻，修掉 P-06/P-10 两处缺口）。**注意**：该脚本为 UTF-8 **带 BOM**（PowerShell 5.1 读中文必需），改动后务必保留 BOM。

### 5.18 R23 收官抽查：明暗主题 + 响应式 + 截图账目（2026-09-12）

> 与功能行分开记账：这三项是**跨页面的横切抽查**，不占 F-xx 行号。执行主体与 §4.25~§4.31 同批（第五批收尾 agent），口径见 §1.2。

#### ① 明亮主题抽查（8 张，均 1440×900）

每张实测 `document.documentElement.dataset.theme === 'light'` 且 body 背景 `rgb(255, 255, 255)`，覆盖三类渲染面：

| 截图 | 页面/状态 |
|------|-----------|
| `theme-light-log.png` | 日志页：提交图 + 分支/标签胶囊在白底可读 |
| `theme-light-diff.png` | 差异页（`src/util.ts` `f55c880`→`86962c0`）：`.monaco-diff-editor` 已渲染，**Monaco 底色实测 `rgb(255,255,254)`**（非 vs-dark 残留） |
| `theme-light-settings.png` | **仓库设置页 + GPG 配置弹窗**（明亮）：Git 配置 9 行白底可读、GPG Modal 沿用同主题（应用设置页明亮整页态见 `app-settings-02-light.png`，仓库设置页无弹窗态见 `repo-settings-02-light.png`） |
| `theme-light-conflicts.png` | 冲突页空态「冲突文件（0）」（本轮主仓无进行中操作） |
| `theme-light-patches.png` | 补丁列表（3 条：range/staged/worktree） |
| `theme-light-browse.png` | 快照浏览 `rev=master`（文件（18）树 + 「在左侧选择文件查看内容」） |
| `theme-light-submodules.png` | 子模块 2 条（已检出 / 未初始化） |
| `theme-light-worktrees.png` | 工作树 2 条（当前 / 移除） |

**主题已复位**：服务端 `GET /api/settings` → `"theme":"dark"`；浏览器 `dataset.theme === 'dark'`、body/html `rgb(20,20,20)`。

#### ② 响应式抽查（7 张，高度均 900）

核心断言 `document.documentElement.scrollWidth <= clientWidth + 1`（另扫「右边界超出视口的元素」列表，结果均为空）：

| 截图 | 主题 | 宽度档 | scrollWidth / clientWidth |
|------|------|--------|---------------------------|
| `responsive-1440-console.png` | 暗 | 1440 | **1425 / 1425**（文档级**竖向**滚动条占 15px，横向仍无溢出；D-37 修复后的 `Tooltip > Button` 不再拉伸整行） |
| `responsive-768-log.png` | 暗 | 768 | 768 / 768 |
| `responsive-768-diff.png` | 暗 | 768 | 768 / 768 |
| `responsive-480-log.png` | 暗 | 480 | 480 / 480 |
| `responsive-768-light-log.png` | 明 | 768 | 768 / 768 |
| `responsive-768-light-settings.png` | 明 | 768 | 768 / 768 |
| `responsive-480-light-log.png` | 明 | 480 | 480 / 480 |

> 本轮 7 张全部为 `scrollWidth == clientWidth`（1440 档为 1425/1425，差值为竖向滚动条，仍判为无横向溢出）。

#### ③ 新登记（收官阶段）

| 编号 | 现象 | 处置 |
|------|------|------|
| D-44 | `conflicts-06.png`（F-119）与 `log-page-16.png`（F-024）**字节完全相同**——违反 §1.2「跨文件 SHA256 不得重复」 | **已修复（证据链）**：F-119 改用视觉可区分的合并态重拍，修复与复验见 §5.20 |
| P-28 | 组织性教训：多批次并行/接力时，「同一状态被两行分别取证」是重复图的高发点（本轮另见 4 对 `responsive-*` 重复，全部落在**未被引用的孤儿**一侧） | 收尾统一按 ④ 的账目流程处理 |

#### ④ 截图账目（收尾口径）

- **账目流程**：`docs/shots/` 全量 → ①逐张判定是否被 `docs/e2e-verification.md` 以**完整文件名**引用；②未被引用者删除（孤儿）；③删除后复核「引用文件全部存在」「跨文件 SHA256 无重复」「无孤儿」三条同时成立。
- **过程图配额**：每行最多 1 张 `<NN>b.png`；多产的 `c/d` 变体默认删除，除非行内显式引用为补证（见 §1.2）。
- 本轮删除的孤儿分三类：R22 流体布局遗留的实验/抽查图（`responsive-360-*`、`responsive-1440-*`、`responsive-480-browse*`、`responsive-768-blame*`、`*-fluid`、`collapsebelow-experiment-*`、`link-stretch-*`）、以及本会话多产的非约定过程图（`shelf-02c/-02d`）。**注意**：本节的 glob 写法刻意不带完整文件名，以免被账目脚本误判为「已引用」。
- 最终账目数字见 §5.19。

### 5.19 R23 截图账目与全量收官核对（2026-09-12）

**① 账目（删除孤儿后实测）**

| 项 | 值 | 判定 |
|----|----|------|
| `docs/shots/` 文件数 | **195** | — |
| 被 `docs/e2e-verification.md` 以完整文件名引用的文件 | **195** | ✅ 引用数 = 在盘数 |
| 引用但磁盘缺失 | **0** | ✅ |
| 未被引用的孤儿 | **0**（本轮删除 **80** 张） | ✅ |
| 跨文件重复 SHA256 的组数 | **0**（修复 1 组：`conflicts-06.png` ↔ `log-page-16.png`，见 D-44；另删除的孤儿中含 4 对 `responsive-*` 重复） | ✅ |

删除的 80 张 = 78 张 R22 流体布局遗留（`responsive-360-*`、`responsive-1440-*`、`responsive-480-browse*`、`responsive-768-blame*`、`*-fluid`、`collapsebelow-experiment-*`、`link-stretch-*`）+ 2 张本会话多产的非约定过程图（`shelf-02c/-02d`）。**判定口径**：以文档正文是否出现**完整文件名**为准（正文里的 glob 写法刻意不带完整名，避免误判）。**归档时另删 1 张**（D-39 的「重载后才正确」失败态证据图，修复后已无意义——文件名完整写出会与本节「引用但缺失 = 0」的口径冲突，故不在此处列出），账目由 196 降为 **195**。

**② 收官核对清单（逐项 ✅）**

- 功能行：**F-001~F-159 全 159 行**跑完并回填（✅150 / ❌0 / ⏭9，⏭ 见 F-056 的 gpg 分支与 F-136~139/F-141~144 的托管凭据边界；原 ❌2 的 F-020/F-066 已随 D-39/D-40 修复转 ✅，见 §5.20）。
- 截图：**195 张全部为本轮重拍**（含收官阶段的 8 张明亮主题、6 张响应式、1 张 F-058 补拍、1 张 F-119 换态重拍，以及 §5.22 变更后补齐的设置页 4 张 `settings-04/06/07/07b`），无一张沿用旧轮次。
- 主题：明亮抽查 8 张（`data-theme=light` + body `rgb(255,255,255)`，Monaco 底色 `rgb(255,255,254)`）后**已复位 dark**（服务端 + 浏览器双证据）。
- 响应式：6 张（768/480 × 明暗）`scrollWidth <= clientWidth + 1` 全部成立。
- 缺陷：D-39~D-42 与 D-44 **已修复并复验**（修复落点/守卫/实测见 §5.20）；D-43 两次复核均未复现，按**偶发**登记（见 §5.17）；纠偏 P-12~P-28。
- 夹具：主仓 `rebase-topic @ be95d0e`（与上游 0/0）、12 个本地分支、2 个工作树、仅 3 个未跟踪；`master` 落后 `origin/master` 5 个提交；冲突仓 `master @ f5fdef8` 干净无进行中操作；大仓未改动；`config.json` 无 BOM、`settings.theme=auto`（跟随系统，§5.22 变更②）、`logInEditor=true`、`auth.accounts=0`、保护规则为空。

### 5.20 R23 缺陷修复与复核记录（2026-09-12）

> §5.17 登记的 D-39~D-42 与收官阶段的 D-44 已按「修根因 + 加守卫」落地并逐条复验（D-43 复核两次均未复现，见 §5.17）。下表把**修复落点、回归守卫与修复后实测**并列记入，供后续迭代对照与防回退。

| 缺陷 | 定性 | 修复落点（代码） | 回归守卫（测试） | 修复后实测 |
|------|------|------------------|------------------|------------|
| D-39 | `refs.changed` 到达后提交行的 ref chips 不刷新 | `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`：`onRefs` 与 `onStatus` 同口径地 `setRefreshKey((k) => k + 1)`，**重订阅 log/stream**（原先只 `mutateLog()` 重验证快照键，而列表由「快照 + 流」按 hash 合并、同 hash 取流侧旧 refs，快照重验证拿不回该行） | 行为层，靠 E2E 复验（`apps/web-next/src/log-merge.ts` 的合并口径未改） | **页面全程不刷新**的双向实测：CLI 删除分支 → chips **6.0 s** 内消失；CLI 重建 → **6.8 s** 内出现（`log-page-12.png` 顶部行 chips = `rebase-topic / origin/rebase-topic / f020-fixed-probe`）。修复前同场景等待 **22 s** 无变化 |
| D-40 | 「清理已合并（N）」的计数与执行集不一致；且第一个失败即中止整条 promise、成功回执从不出现 | 候选集合上移为**单一来源**：`packages/client/ui/src/composite/branch-panel.tsx` 导出 `mergedCleanupCandidates()`（`!remote && mergedIntoHead && !current && checkedOutInWorktree !== true && !(upstream !== null && ahead > 0)`），面板计数与两个容器（`apps/web-next/app/repos/[repoId]/branches/page.tsx`、`apps/web-koa/src/pages/branches.tsx`）共用同一集合；容器批量循环改为**逐条容错**（收集失败项）并**恒定发回执**：全成功「已清理 N 个已合并分支」（success）、部分失败「已清理 M 个已合并分支，K 个失败：…」（warning）、全失败「清理失败：…」（error） | `packages/client/ui/src/composite/branch-panel.test.tsx`（候选口径唯一 + 上游领先排除） | 按钮「清理已合并（5）」→ **恰好删除 5 个** → 绿色回执「已清理 5 个已合并分支」、按钮变「清理已合并（0）」且禁用（`branch-05.png` 为回执态）。修复前：承诺集合含 worktree 占用者与上游领先者，执行到它即 raw 报错中止，其后的候选一个都不删 |
| D-41 | 并发写入时把 git 的 `.git/index.lock` 原始报错直接透给用户（P3，偶发） | `packages/server/api/src/errors.ts`：命中索引锁 → `ServiceError('STALE_LOCK', '仓库正忙（索引被其它 git 操作锁定），请稍后重试')`（409；该错误码此前已定义但未被使用） | `packages/server/api/src/errors.test.ts`（锁冲突 → `STALE_LOCK` 409；其它 git 失败仍 `GIT_ERROR`） | 单测覆盖两分支；UI 侧沿用既有 4xx 文案映射，用户看到中文提示而非 `Unable to create '…/.git/index.lock'` |
| D-42 | 配置被外部写成带 BOM → 全站 `/api/*` 一律 400「请求体不是合法 JSON」 | ① `packages/server/api/src/lib/config-store.ts`：读入后 `replace(/^\uFEFF/, '')`（容错外部编辑），解析失败抛可读 `ServiceError('GIT_ERROR', '配置文件不是合法 JSON：<file>（…）')`；② 新增 `InvalidRequestBodyError` 标记类（`apps/web-next/src/server-context.ts`、`apps/web-koa/src/server-context.ts`），400 **只**映射 `ZodError` 与该标记，其余 `SyntaxError` 不再伪装成客户端问题；6 个 web-next 路由改用 `readJsonBody(req)`；koa 用 `bodyParser({ encoding: 'utf-8', onError })` 把解析失败包成标记，`middleware/error.ts` 统一走 `handleApiError` | `packages/server/api/src/settings.test.ts`（BOM 容忍 + 坏配置可读报错）、`apps/web-koa/src/rest.test.ts`（非法 JSON 体 → 400「请求体不是合法 JSON」） | 带 BOM 的 `config.json` 下 `GET /api/settings`、`GET /api/repos` 由 **400 → 200**；非 BOM 的坏 JSON → 明确中文可读报错，不再把服务端问题说成「请求体」。事故副本保留为 `~/.rebasedjs/config.bom-broken-20260912.json`（8359 B） |
| D-44 | 证据链重复：`conflicts-06.png`（F-119）与 `log-page-16.png`（F-024）字节完全相同 | F-119 改用**视觉可区分且同样有效**的合并态重拍（不放弃该行的取证） | 收尾账目流程（§5.18④：全量 SHA 自检 + 孤儿清理） | 全量 SHA 自检：**0 重复组**（本轮另删除 1 张已失效的证据图，账目降至 195 张，见 §5.19） |

**D-40 暴露的一条 git 隐藏规则（后续行文与候选集合都要记住）**：`git branch -d` 除了「已并入 HEAD」之外，还要求**上游不领先**——对「上游存在且 `ahead > 0`」的分支会以 `warning: not deleting branch … that is not yet merged to …` 拒绝（即便它已并入 HEAD）。候选集合据此补上 `!(upstream !== null && ahead > 0)`，否则计数与执行集仍会在执行期分叉、并以 raw git 报错收场。

**复核方法（三条口径，后续复验沿用）**

1. **时序**：验证「实时刷新」必须制造「页面已加载 → CLI 变更」的顺序——用后台延时任务（`Start-Sleep` 后执行 git 命令）与浏览器轮询并行，否则变更早于页面加载，无法区分「实时推送到位」与「刷新后本来就对」。
2. **回执取证**：一律用 `document.body.innerText` 文本轮询（antd v6 无 `.ant-message-notice-content`，toast 在点击后约 2.8 s 出现）。
3. **集合类断言**：候选/删除集合用 CLI 逐条互证（`git branch --merged`、`git branch -vv`、`git worktree list`），判定「承诺集合 == 实删集合」，不只看按钮文案。

**D-43 复核（两次尝试均未复现）**：① 干净硬杀（`taskkill /T /F` → 重启）与 ② 带并发负载硬杀（后台持续打 5 个嵌套路由 2 s 后强杀）两种条件下，`settings/gpg-config`、`commit/amend-targets`、`staging/hunks`、`browse/content` **全部 200**、日志无 404 → 定性为**偶发/条件触发**（需命中 `.next` 缓存写入窗口），严重度按偶发理解。**运维口径不变**：出现「一级路由 200 + 二级嵌套 404 + 页面少一块」先怀疑 `.next` 缓存——优雅停 dev 重开，或删 `apps/web-next/.next` 后重启。**取证留档**：原发现时日志 `%TEMP%\rebased-dev-restart.log`（4 条嵌套 404）与恢复日志 `rebased-dev-restart2.log`（全 200）。

### 5.21 R23 遗留与后续建议

1. **唯一仍需盯的开放项是 D-43**（硬杀 dev 后 `.next` 缓存不一致 → 二级嵌套 API 404；两次复核均未复现，按「偶发」定级）——处置口径见 §5.17；D-39~D-42 与 D-44 已修复并复验（见 §5.20），后续轮次只需在回归里确认它们不回退。
2. **主仓 `master` 落后其自身远端 5 个提交**（F-074 等批次的遗留），`rebase-topic` 与其上游同步；后续轮次若要跑「当前分支/上游」相关行，注意分支选择。
3. 本轮把探针产物留在夹具里（见 P-19）、并**移除了四态子模块夹具**（F-130/F-131 的复现要点已写在行内）——需要干净基线时跑 `scripts/smoke-setup.ps1` 重建。
4. **裸远端 `smoke-remote`** 现有 refs：`feature`、`master`、`rebase-topic`、`fetch-probe`、`fetch-probe-r8`、`fetch-probe-r11`、`rebase-probe`，另有 `refs/pull/9/head`；`origin/master` = `a91ade7`。

### 5.22 R23 后产品变更（2026-09-12，冒烟轮次之外）

> 本轮冒烟收官后按用户要求做的两处界面变更，记在此处以便后续轮次对照截图与断言口径。

**变更① 设置页组件统一 `size="small"`（无例外）**

- 实现：`packages/client/ui/src/composite/settings-page.tsx` 内**逐个控件显式** `size="small"`（Input / Input.Password / Input.TextArea / Button / Select / Segmented / Switch），`Card` 与 `Form` 亦为 small，Modal / Popconfirm 的确定与取消按钮走 `okButtonProps` / `cancelButtonProps`；页根再包一层 `ConfigProvider componentSize="small"` 兜底 portal 内的默认档控件。**例外说明**：antd 6.6.3 的 `Checkbox` 没有 `size` 属性（方框尺寸固定），故「勾选框」不受该口径影响。
- 影响面：仅设置页；其余 20+ 面板本就是 small（本轮之前已统一）。
- **断言影响（实测）**：不影响 §5.16 / §5.18 的密度与溢出断言——设置页字号直方图仍以 **14px 主导**（改后 14px×37 / 12px×12，改前 14px×29 / 12px×12）；`responsive-768-light-settings.png` 重拍后仍 `scrollWidth == clientWidth == 753`（无横向溢出）。控件高度由 32 → **24**（Switch 16 / Segmented 24 / Input 24 / Button 24）。

**变更② 界面主题新增「自动」（跟随操作系统）**

- 选项：**自动 / 明亮 / 暗色**；类型 `ThemeMode = 'auto' | 'light' | 'dark'`（`contracts/src/domain.ts`），patch schema `z.enum(['auto','light','dark'])`（`contracts/src/endpoints.ts`，非法值仍 400）。服务端只持久化偏好，**默认仍为 `dark`**（不改既有默认观感）。
- 解析：主题口径统一在 `packages/client/ui/src/base/app-theme.tsx`（`useResolvedTheme`）——用 `matchMedia('(prefers-color-scheme: dark)')` 把 `auto` 解析成实际明暗并**订阅系统变化**（切系统主题即时跟随，无需刷新）；`data-theme` 恒为解析后的 `light`/`dark`（globals.css / Monaco / 布局断言只认这两值），另写 `data-theme-preference` 保留偏好原值，便于区分「跟随系统」与「显式指定」。两个 app 的根 Provider（`apps/web-next/app/providers.tsx` / `apps/web-koa/src/main.tsx`）都从 `useSettings()` 取偏好后交给该 hook，故两端主题行为同源。
- 实测：`PUT {theme:'auto'}` → 设置页选中「自动」、`data-theme-preference=auto`；浏览器偏好为浅色时 `data-theme=light`；`page.emulateMedia({colorScheme:'dark'})` → **不刷新页面**即变 `data-theme=dark`、body `rgb(20,20,20)`，切回浅色恢复。
- **已知缺口已修（2026-09-13，§5.23）**：web-koa 的 SPA 原先固定暗色（`apps/web-koa/src/main.tsx` 硬编码 `theme.darkAlgorithm`），设置页的主题控件在 koa 侧点了不生效。现已改为同一个 `useResolvedTheme` 驱动（含 `DensityProvider mode` 与 `ConfigProvider.config({holderRender})`），并把 `globals.css` 的 `--app-*` 主题变量与 `data-theme` 选择器补进 `apps/web-koa/src/index.css`（此前 ui 包按 `var(--app-*)` 上色的地方在 koa 下拿不到值）。

**变更③ 分支页面板「弹窗外」控件统一 small（2026-09-12，用户指出具体元素后）**

- 触发：用户在内置浏览器中选中分支页工具栏的过滤输入（`span.ant-input-affix-wrapper`）要求改 small；随后**决策更正**——**弹窗内的组件不改 size，只改弹窗以外的**（新建分支/重命名/设上游/检出并变基/与工作树差异等 Modal 内的输入与底部按钮，以及行内 Popconfirm 的确定/取消，均维持默认档）。
- 改动（`packages/client/ui/src/composite/branch-panel.tsx`）：仅**弹窗外**的工具栏过滤框 `branch-filter` 置 `size="small"`（`packages/client/ui/src/composite/branch-panel.tsx` 唯一改动点）。
- 实测（浏览器 DOM）：`[data-testid="branch-filter"]` 的包裹元素带 `ant-input-affix-wrapper-sm`、内部 `<input>` 带 `ant-input-sm`（本机实测包裹高 22px、输入高 20px，与同排 small 按钮 21px 同档；改前为默认档 28px）；Modal 内 `create-name` / `create-start-point` 与 Popconfirm 按钮仍为默认档。
- 回归守卫：`packages/client/ui/src/composite/branch-panel.test.tsx`「过滤框为 small 档，Modal 内输入保持默认档」（ui 用例 693 → **694**）。
- 截图影响：`branch-01.png` 已按当前夹具重拍（计数与 CLI 互证见 §4.7 F-062）；`branch-02…09` 只在顶部工具条顺带露出该输入（仍是改前的默认档），行内断言的语义与计数不受影响。
- **仍非 small 的存量（供后续统一时参考）**：`packages/client/ui/src` 内约 **62** 处带 `size` 属性的控件未显式指定（Input 32 / Button 17 / Input.TextArea 4 / Select 4 / Segmented 3 / Input.Password 1 / Switch 1，集中在 `log-page`、`repo-page`、`patch`、`worktree`、`remote`、`tag`、`search` 等）；另有 13 处 `Radio` 属 antd 无 `size` 属性的设计例外（与 `Checkbox` 同类）。

**截图与回归**

- 已按新 UI 重拍：`settings-01.png`（暗色、logInEditor=false、3 选项主题控件、全 small）、`theme-light-settings.png`、`responsive-768-light-settings.png`；**另补齐设置页其余 4 张**（`settings-04 / 06 / 07 / 07b`——变更前那批露出的「暗色/明亮」两选项与 32px 控件形态已全部替换：04 为真重启后的明亮态、06 为 GPG 弹窗、07 为保护分支非法正则态、07b 为同态卡片特写）；账目为 **195 张 / 0 重复 SHA / 0 孤儿**（归档时删 1 张失效证据图，见 §5.19）。
- 回归（2026-09-12 修复轮后复跑，全部退出码 0）：`pnpm typecheck` ✅、`pnpm format`（eslint --fix，无 error/warning）✅、`pnpm test` **全绿**——contracts 185 / core 235 / client 176 / ui 693 / api 386（+1 跳过）/ web-next 174 / web-koa 175。新增守卫用例见 §5.20 各行的「回归守卫」列。

### 5.23 提交图渲染修复（2026-09-12，冒烟轮次之外）

> 触发：用户在内置浏览器打开主仓日志页（`rebased-smoke`，`f761a9f6-5c91-4115-9261-69715687e875`）要求「截图识别：提交信息是否显示完整？分支的关系线图是否正确？」。逐行读 SVG 几何后定位到 5 处缺陷（D-45~D-49）；同日第二轮用户复核该页后指出「这张图没有多层级嵌套，缩进深度不合理」并裁定**压实显示车道**，补记 D-50。本节按 §5.24 的写法登记：**一句话现象 + 修复落点 + 回归守卫 + 修复后实测**。

| 缺陷 | 一句话现象 | 修复落点（代码） | 回归守卫（测试） | 修复后实测 |
|------|------------|------------------|------------------|------------|
| D-45 | 合并的第二父**隔偶数行**时，分叉斜线的拐点正落在中间某一行的圆点上 → 图面凭空多出一条「那一行的提交 → 第二父」的假父子边（`5c7c07a` 的第二父 `d91794f` 看着像挂在 `21efcbb` 上，而两者父提交都是 `80b63f4`；`fb9833f` 的第二父 `3b0244b` 隔 14 行时看着像从 `53047d3` 分出去） | `packages/client/ui/src/domain/commit-graph-segments.ts`：斜段不再铺在「两行中点 → 终点」之间，改为**固定只占一行带**（自起点行下方半行 = 行边界起，止于再下一行边界），并轨后**在目标 lane 上竖着走完中间各行** | `packages/client/ui/src/domain/commit-graph-segments.test.ts`：① 拐点不在任何行中线上；② 斜段 ≤ 一行带；③ 中间各行含目标 lane 的竖线；④ **线条不擦过任何一行自己的圆点** | 分叉由「挂在 F-094 本地侧提交那一行」改为**紧贴合并行**；diverge-test 长边不再从中间某行长出来，而是从 `F-074 no-ff 合并` 行分叉、并在中间各行占住自己的车道（`log-graph-02.png`） |
| D-46 | 跨行线被**逐行视口**裁断：青色回折段断 8px、diverge-test 分支线断 **66px**（约 2.7 行整段消失），线看着断成两截 | 同上文件新增 `RowGeometry.maxX`（本行带内所有切片 + 本行圆点的 x 上界）与 `laneCoveringX()`；`packages/client/ui/src/domain/commit-graph.tsx` 本行图列宽度改按 `maxX` 算（不再只按「本行圆点所在 lane」） | `commit-graph-segments.test.ts`「maxX 覆盖本行全部线段…」；`commit-graph.test.tsx`「跨 lane 的边不被本行视口裁断，也不压到本行文字」 | 两仓逐行读 SVG：**无任何坐标越出 viewBox**（32 行 / 11 行全为 `clipped=false`），线连续；简单形态未回退（`rebased-multi2` 的 feature 两行行宽仍 **56**，与 §4.2 F-009 的取证口径一致） |
| D-46b | 补足列宽后线条可一直画到列右缘，而图列的**负右边距**把文字往左拉了 11px → 线**压住每行开头约 10px 文字**（修 D-46 的过程中暴露，同轮修掉） | `commit-graph-segments.ts`：`laneCoveringX` 口径定为「本行文字起点 = 车道中心 + `DOT_GUTTER`」，故只要 `laneCenterX(lane) ≥ maxX`，线就永远在文字左侧 | 同 D-46 两条用例（含 `线的最右端 ≤ 文字起点` 断言） | 逐行实测 `线右端 ≤ 文字左端`（`textOverlap=false`，行 5/11/16/20/24 抽查） |
| D-47 | refs chips 列 `max-width: 140px` + `overflow: auto` + `scrollbar-width: none` → **静默截断**：3 个 chip 时第 3 个一个像素都看不见、第 2 个只剩半边，且没有任何截断提示 | `commit-graph.tsx`：上限放宽到 320px、容器可收缩（`flexShrink:1` + `minWidth:0`）；chips 容器由 antd `Space` 改 `Flex gap="small"`（`Space` 的 `div.ant-space-item` 不可收缩，装不下只能被硬切），每个 chip 自带 `overflow:hidden + ellipsis + title` | `commit-graph.test.tsx`「chip 间距走 antd Flex 档位，且每个 chip 可省略号收缩」（含「4px 仍来自 `paddingXS` 档位类名」的口径锚点） | 主仓多 chip 行全部完整可见（2026-09 复核：`stash-branch-f083-r5b / wt-new-branch / wt-dup`、`origin/stash-branch-f083-r5b / stash-branch-f083-r5 / master`、`origin/master / origin/feature` —— `log-graph-01.png`）；窗口变窄时逐 chip 省略号 + hover 显全名 |
| D-48 | 主线颜色 ≠ 该分支 chip 的颜色：图列把 decorate 串 `HEAD -> rebase-topic` 整串拿去哈希，chips 用的是 `rebase-topic` → 主线 `#7863a6` vs chip `#63a67e`；且 `#7863a6` 与 lane 1 的 `#7663a6` 只差 2/255（相邻车道肉眼同色） | 新增 `packages/client/ui/src/graph-layout/ref-name.ts` 的 `refNameOf()`（剥 `HEAD -> ` 前缀）；`packages/client/ui/src/graph-layout/build-layout.ts` 的主线着色与 `packages/client/ui/src/domain/refs.ts`（chips 分类）**共用同一实现**，杜绝两处各剥各的 | `packages/client/ui/src/graph-layout/build-layout.test.ts`「color」用例（主线色 = `colorForRef('main')`，并断言未剥前缀时是另一个色 `#6398a6`）；`color.test.ts` 的 Java 色板断言不变 | 主线由紫 `#7863a6` 变为**绿 `#63a67e`**（= `rebase-topic` chip 底色），与 lane 1 紫色一眼可分（`log-graph-01.png`） |
| D-49 | 每行 SVG 都渲染**整张图**（79 条 polyline + 32 个 circle × 32 行 = 3552 个节点）再靠 viewBox 裁掉，共享主干还被重复描边；大仓（1000 提交 × 40 可见行）会往 DOM 塞约 8 万节点 | `packages/client/ui/src/base/graph-canvas.tsx` 改为「只画传进来的线段与圆点」；`commit-graph.tsx` 每行只传本行切片 + 本行圆点（几何层已按行切好） | `packages/client/ui/src/base/graph-canvas.test.tsx`「只画传进来的线段与圆点」；`commit-graph.test.tsx`「每行只渲染本行的内容：一个圆点…」 | 主仓 32 行合计 **86** 个图形节点（改前 3552），每行恰 1 个圆点 |
| D-50 | **缩进深度超出结构深度**（同日第二轮，用户复核主仓后指出）：Java 车道按 fragment 发现顺序发号且**永不复用**，侧支因此落在靠右的列、中间留空列 —— 主仓只出现一条侧支的区间里，`diverge-test` 在车道 2、远端侧在车道 3（车道 1/2 当时是空的）；D-46 的「文字让开本行最深线」把这份空档原样搬成缩进（实测最大 **3 档 = 54px**，而该历史任何时刻最多 2 条线并存，结构上只需 1 档）。对照 `rebased-multi2`：车道恰好稠密（每行 `{0..k}` 无空洞），缩进 = 结构深度，观感正确 | 新增 `packages/client/ui/src/graph-layout/lane-compaction.ts` 的 `compactLanes()`（**渲染层补充，非 Java 移植**）：按「同一区间内并存的线连续编号」压实显示车道；`buildLayout` 的 Java 车道号、Java 着色与 parity fixtures **全部不动** | 新增 `packages/client/ui/src/graph-layout/lane-compaction.test.ts` 5 例（① 稠密形态=恒等变换；② 稀疏压到「并存线数 − 1」且无空列；③ 区间重叠的线左右顺序不变→不新增交叉；④ 同一 fragment 不换列；⑤ 只动车道号，颜色/父提交/边类型原样）；`commit-graph.test.tsx`「稀疏车道被压实到结构深度」守住渲染链路真的调用了它 | 主仓：最大缩进 **3 档 → 1 档**（文字 x 81/63 → **45**），全表列宽只剩 `{38,56}`、**每行无空列**、`clipped=0`/`textOverlap=0`（`log-graph-01/02/05.png`）；`rebased-multi2` 逐行不变（节点车道 `0,0,1,2,3,2,2,1,1,0,0`、列宽 `38,38,56,74,92,92,74,74,56,56,38` 与压前逐项一致）→ 恒等变换实测成立 |

**代价（有意承受）**：文字缩进 = 「本行最深线条所在车道中心 + 8px」，即被更右车道穿过的行要补列宽、文字随之右移（「让线优先于让字」）。D-50 压实之后这一档代价已很小：主仓只剩 5~7、11~26 两段各右移 **1 档**（18px），不再有 2~3 档的缩进块。若连这 1 档也不接受，只能把图列改成整表统一宽度（所有行同缩进），那与既有口径「缩进随线条」（§4.2 F-009）冲突，故保留。

**本轮未改的口径（供后续判断，不要误当缺陷）**：① **Java 车道号本身**（`lane = layoutIndex − 1`，见 `packages/client/ui/src/graph-layout/build-layout.ts`）仍是移植语义、`fixtures/java/layout-builder-*` 的 lanes 快照即该口径 —— D-50 只压**显示车道**，`LayoutRow.lane` 的 Java 值仍用于 fragment 着色（`colorById(layoutIndex)`）与 parity 断言；② 列表只显示提交信息首行（有正文的提交在列表不展开）；③ 「标签」开关默认关（对齐 Java `showTagNames=false`），故 tag chips 默认不出现。

**冒烟复核（2026-09-12）**

- **范围清单**：① 主仓 `rebased-smoke`（32 提交、2 处合并、1 条隔 14 行的长边、3 行多 chip）逐行读 SVG 几何 ✅（含压实前后对照）；② `rebased-multi2`（4 车道、3 处合并）复核「同 lane 直边 / 相邻行合并 / 稠密车道恒等」未回退 ✅；③ 明暗两主题各一次 ✅；④ CLI 与页面互证（父子关系）✅。
- **操作路径**：`/repos/f761a9f6…` → 逐行读 `viewBox` / `line|polyline` / `circle` 几何（含裁剪、压字、空列判定）→ `/repos/99b38826…` 同法 → 设置页切「暗色」→ 回日志页复看 → 切回「明亮」。
- **证据（2026-09 全量重拍）**：`log-graph-01.png`（主仓整页（28 行）：chips 完整可见（`stash-branch-f083-r5b` / `wt-new-branch` / `wt-dup` / `origin/stash-branch-f083-r5b` / `stash-branch-f083-r5` / `master` / `origin/master` / `origin/feature`）、主线绿色、分叉贴合合并行、缩进最多 1 档）、`log-graph-02.png`（合并行特写：`Merge branch 'feature'` 行下方分叉 → 远端侧节点紧邻主线 → 回折并入主线）、`log-graph-05.png`（diverge-test 段特写：`chore(fixture): diverge-test 独有提交` 侧支**紧邻主线**、无空列）、`log-graph-03.png`（`rebased-multi2` 四车道（明亮主题）、3 处合并逐行一致）、`log-graph-04.png`（**暗色同仓**）。CLI 互证：`git log --parents` 逐条复核 D-45 的两处假父子边——`21efcbb`（F-094 本地侧提交）与 `d91794f`（F-094 远端侧提交）的父同为 `80b63f4`；`3b0244b`（diverge-test 独有提交）的父是 `761961d`；`rebase-demo` tip `7b59a9c`（F-074 no-ff 合并）父为 `56eadea` + `3b0244b`。
- **未覆盖与后续**：① `rebased-smoke-huge` 与深克隆仓库的**分页追加 + 虚拟滚动**未重跑（几何改动与分页无关，但滚动窗口内的行宽一致性未取新证据）；② 虚线边（`edgeTypes='D'`）在本批夹具中未出现——逐行切分会重置 dash 相位（既有实现同样按行切竖段，故未新增偏差），出现真实虚线边时需复看；③ 车道压实的**区间用 [min,max] 近似**（宁可保守：区间相交就不共用列），故极端交错的仓库可能比理论最优多占 1 列；④ 截图账目：本轮共涉及 5 张（`log-graph-01…05.png`，其中 01–04 为压实后重拍），`docs/shots/` 计 **200** 张，引用=在盘、无重复 SHA、无孤儿（流程见 §5.18~§5.19）；⑤ **一次未复现现象**：本轮首次深链进仓库页时，页面先渲染出仓库骨架、随后在 dev 连续 Fast Refresh 期间 URL 回到 `/`（首页）—— 全仓检索无「自动跳首页」的代码路径（`router.push('/')` 只挂在顶栏「首页」按钮上），后续多次导航与整轮复核均未复现，按**dev 期偶发**记录，不列入缺陷。
- **回归（2026-09-12 全量复跑）**：`npm run typecheck` ✅、`npm run format`（eslint --fix，无 error/warning）✅、ui 包 `npx vitest run` **710/710 全绿**（新增 `commit-graph-segments.test.ts` 7 例、`lane-compaction.test.ts` 6 例、`commit-graph.test.tsx` +1 例，另按新口径改写了 `graph-canvas.test.tsx` / `commit-graph.test.tsx` 的既有断言）。其余各包本轮未改动：`npm run test` 全量跑时 contracts 185 / core 235 / client 176 / api 386（+1 跳过）/ web-next 174 全绿，web-koa 有 2 例（`github.test.ts` / `gitlab.test.ts` 各 1）报 `TypeError: fetch failed / ECONNRESET` —— **单跑该两文件 40/40 通过**，判定为全量并发压测下的 mock HTTP 服务端抖动（与该包既有实现无关，本轮未触碰该包）。

### 5.24 记录归档口径（本文档保留什么）

本文档只保留**对后续迭代仍然有用**的内容；「已修复缺陷」的逐条叙述已删除，替换为可复用的结论：

- **保留**：① 方法学与取证口径（§1）；② 功能矩阵总览 + 159 行逐行证据（§2、§4，行内保留截图名与 CLI 互证）；③ 不测清单与理由（§3）；④ 跨页面验收基线（§5.16 布局/密度六档）；⑤ **仍开放项**（§5.17 的 D-43，§5.16 的 D-38）与全部流程/夹具纠偏 P-01~P-29（§5.17；P-29 即 Turbopack 中文代码框 panic 的处置口径）；⑥ 主题与响应式抽查、截图账目流程（§5.18~§5.19）；⑦ 修复项的**修复落点 + 回归守卫 + 实测结论**（§5.20 R23 缺陷、§5.23 提交图渲染）；⑧ 当前产品口径与已知缺口（§5.21~§5.22）。
- **已删除**：历史缺陷 D-01~D-38、D-39~D-42、D-44 的「现象 / 根因 / 复现步骤 / 当轮复验」叙述——它们均已修复，逐条叙述只对当时轮次有意义（D-35~D-37 压缩为一行，见 §5.16）。
- **追溯方式**：需要旧记录时取 git 历史中的本文档旧版：`git log --oneline -- docs/e2e-verification.md`，再 `git show <sha>:docs/e2e-verification.md`。
- **后续新增记录的写法**：仍按本节开头的记录规范回填；**缺陷修复后**请把该条压缩成「一句话现象 + 修复落点 + 回归守卫 + 实测结论」并并入 §5.20 式表格，不要保留长篇复现叙事。

### 5.25 设置页按作用域拆两页 + web-koa 主题接线（2026-09-13）

> 触发：用户要求 ① 修掉「主题在 web-koa 不生效」；② 把全局类与仓库类设置分开，并改成**首页 → 应用设置（全局）**、**日志页 → 仓库设置**。

**变更① 主题口径收敛到 ui 包，web-koa 接线**

- 现象（改前）：web-koa 的 SPA 固定暗色（`main.tsx` 硬编码 `theme.darkAlgorithm` + `DensityProvider mode="dark"`），设置页主题控件在 koa 侧点了不生效；`index.css` 也硬编码 `#141414`，ui 包按 `var(--app-*)` 上色的地方在 koa 下拿不到值。
- 修复落点：新增 `packages/client/ui/src/base/app-theme.tsx`（`useResolvedTheme` + 纯函数 `resolveThemeMode`）——**偏好由 app 从 `useSettings()` 取后以 props 传入**（ui 不 import `@rebased/client`，与 `DensityProvider`/`SettingsPage` 的既有口径一致）；hook 内统一做三件事：解析 auto（订阅 `prefers-color-scheme`）、产出 `ThemeConfig`、写 `html[data-theme]`/`data-theme-preference` 并注册 `ConfigProvider.config({ holderRender })`。两个 app 的根 Provider（`app/providers.tsx` / `main.tsx` 的 `ThemedApp`）改为消费同一 hook；`apps/web-koa/src/index.css` 补齐 `--app-bg/--app-fg/--app-border/--app-muted/--app-selected` 与两种 `data-theme` 选择器（与 web-next `globals.css` 同值）。
- **反向口径（本轮曾走错，留作教训）**：一度把该 hook 放进 `@rebased/client`，代价是数据层包凭空多出 `antd` 运行时依赖与 `jsdom` 开发依赖 —— 已撤回。**主题解析属 ui 职责**（antd/配置/文档根属性），偏好获取属 app 容器职责，`client` 只做数据获取。
- 回归守卫：`packages/client/ui/src/base/app-theme.test.tsx`（6 例：未就绪按暗色兜底 / 显式 light / auto 跟随系统且**系统变化即时生效**与卸载退订 / `apply:false` 不写文档根 / holderRender 承载 AntdApp）。
- 修复后实测（浏览器 DOM）：koa SPA `http://localhost:5173/settings` 切「明亮」→ `data-theme=light`、`preference=light`、body `rgb(255,255,255)`、`--app-bg=#ffffff`；切「暗色」→ `data-theme=dark`、body `rgb(20,20,20)`、`--app-bg=#141414`、卡片底色 `rgb(20,20,20)`（antd 算法确实换档）；`:5173` diff 页 Monaco 容器底色 `rgb(255,255,254)` = **Monaco 明亮主题**（`monaco-lazy` 按 `data-theme` 取 `light`）。

**变更② 设置页按作用域拆两页**

| 页面 | URL | 卡片（数据源） | 入口 |
|------|-----|----------------|------|
| **应用设置** | `/settings`（新增；web-next `app/settings/page.tsx`、web-koa `pages/app-settings.tsx`） | 应用设置（`logInEditor`/`theme`）+ 保护分支 + Git 可执行文件 + 账户（`GET/PUT /settings`、`/settings/git-executable`、`auth/accounts`——全部与 repoId 无关） | 首页「设置」按钮 |
| **仓库设置** | `/repos/:id/settings`（保留） | Git 配置（仓库级）9 键 + GPG 提交签名（`repos/:id/config`、`repos/:id/settings/gpg-config`——写本仓库 `.git/config`） | 日志页顶栏设置图标 |

- 组件落点：`composite/settings-page.tsx` 导出 `AppSettingsPage` / `RepoSettingsPage`（共用文件内私有卡片子组件），外壳抽到新文件 `composite/settings-shell.tsx`（返回按钮 + 两页互跳链接 + `componentSize="small"` 与 `density="default"` 的统一口径）。删除旧的单一 `SettingsPage` 与其 454 行测试，拆为 `app-settings-page.test.tsx`（16 例）+ `repo-settings-page.test.tsx`（11 例），两边都含**作用域隔离断言**（应用页不渲染 git 配置行/GPG 卡，仓库页不渲染应用设置/保护分支/账户/可执行文件卡）。
- 入口改指：首页 `RepoPage.onOpenSettings` 由 `(repoId) => void` 改为 `() => void`（无参），按钮**不再因「无最近仓库」禁用**（应用设置不依赖仓库），Tooltip 改为「打开应用设置…」；GitHub/GitLab 面板的「设置」「去设置」改指 `/settings`（令牌配在全局账户卡片）；日志页顶栏设置图标语义不变（→ 仓库设置），Tooltip 收窄为「仓库设置：该仓库的 git 配置与 GPG 提交签名」。
- 互跳：应用设置页顶部「仓库设置」（无最近仓库时**禁用**并在 Tooltip 说明原因——取最近列表第一条作落点）、仓库设置页顶部「应用设置」；返回按钮分别为「返回首页」/「返回日志」。**导航条形态**：antd `Space` + `Divider orientation="vertical"`（两个 link 按钮同一行、中间一条竖线；antd 6 口径用 `Space.separator` / `Divider.orientation`，`split`/`type` 已废弃），`Space size={0}`（项间距交给 Divider 自身 8px 左右外边距，实测两链接各距竖线 8px），按钮 `size="small"` 逐个显式声明（实测高 24px、两页几何一致）。
- 回归守卫：`repo-page.test.tsx` 的设置入口两例（无参回调；无仓库仍可点）、两页互跳各一例（调 `onBack` / `onOpenOtherSettings`，并断言导航条存在 `.ant-divider-vertical`）。
- 巡检脚本：`scripts/check-fluid-layout.mjs` 路由表新增 `app-settings`（`/settings`，density `default`，ready `app-settings-card` + 内容门 `theme-segmented`），仓库设置页 ready 由静态 `git-executable-card`（已随拆分移走）改为数据级 `repo-config-card`；截图页清单同步新增 `app-settings`。
- 修复后实测（:3081，MCP 逐步点）：首页「设置」→ `/settings`（应用级卡片俱全：应用设置 / 保护分支 / Git 可执行文件 / 账户）→ 点「仓库设置」→ `/repos/f761a9f6…/settings`（只有「Git 配置（仓库级）」「GPG 提交签名」两张卡，DOM 断言 `app-settings-card`/`protected-branches-card`/`accounts-card` 均不存在）→ 点「应用设置」→ 回 `/settings`；日志页顶栏设置图标 → `/repos/9918c699…/settings`。主题在导航间保持（`data-theme=light` 跨页仍在），冒烟后已切回「自动」（`GET /api/settings` → `"theme":"auto"`）。
- **dev 环境注意（本轮踩坑，非新缺陷）**：本节改动期间 `next dev`（Turbopack）两次因「模块有编译错误 + 错误行上方注释含中文」而 panic 退出并**吞掉真实错误**——即 §5.17 已登记的 **P-29**（`next-code-frame` 的 `highlight.rs` 按字节下标切片，切点落在中文注释的字符中间）；本轮按 P-29 的既定处置用 `next dev --webpack` 拿到真实错误（`app/repos/[repoId]/settings/page.tsx` 漏了首行 `'use client'`，已修），并复核了 P-29 的另两条口径：改用 webpack 后回 Turbopack **必须删 `apps/web-next/.next`**，以及重启前先确认 :3081/:3082 归属（本轮遇到一次 `EADDRINUSE`，确认是上一轮 dev 子进程仍占端口，kill 后重启即恢复）。
- **未覆盖与后续**：① `apps/web-next/app/settings/page.tsx` 的 Next.js 服务端/客户端边界只靠 `next build --webpack` 与实际渲染验证，本轮未跑 `check-fluid-layout.mjs` 全量矩阵（该脚本的 `app-settings` 格为新增，尚未实测）；② web-koa 侧「无最近仓库」时互跳禁用的 UI 分支未在 :5173 实测（单测覆盖）；③ 本轮未重拍设置页截图（`settings-0*.png` 仍反映拆分前的单页形态，重拍时需按新两页命名）。

**冒烟（2026-09-13，本节改动的逐项实测；截图已入库 `docs/shots/`）**

- **范围清单**：① 首页「设置」→ 应用设置页（全局）✅；② 应用设置页卡片组成（应用设置/保护分支/Git 可执行文件/账户）✅；③ 应用设置页 →「仓库设置」互跳 ✅；④ 仓库设置页卡片组成（仅 Git 配置（仓库级）/GPG 提交签名）✅；⑤ 仓库设置页 →「应用设置」互跳 ✅；⑥ 主题切换（暗色→明亮）即时生效、跨页保持 ✅；⑦ GitHub 面板「设置」→ 应用设置页 ✅；⑧ web-koa SPA（:5173）主题随应用设置生效 ✅；⑨ 导航条形态（Space size=0 + 竖直 Divider；按钮 small 24px）两页一致 ✅；⑩ 冒烟后主题复位为 `auto`（`GET /api/settings` → `"theme":"auto"`）✅。
- **操作路径**：`:3081/settings`（暗色取证）→ 点「仓库设置」→ `:3081/repos/f761a9f6…/settings`（暗色取证）→ 点「应用设置」→ 切「明亮」→ 应用设置页（明亮取证）→ 点「仓库设置」（明亮取证）→ `:3081/repos/9918c699…/github`（入口取证）→ 点「设置」→ 落在 `/settings` → `:5173/settings`（koa 明亮取证）→ 回 `:3081/settings` 切「自动」复位。
- **证据（截图 6 张，全为绝对路径入库 `docs/shots/`）**：

| 截图 | 取景与判定 |
|------|------------|
| `app-settings-01-dark.png` | 应用设置页（暗色）：导航条「返回首页 | 仓库设置」同一行、竖线分隔；卡片为 应用设置（编辑器开关 + 主题三选）/ 保护分支 / Git 可执行文件 / 账户，**无**任何仓库级卡片 |
| `app-settings-02-light.png` | 同页切「明亮」后：body `rgb(255,255,255)`、卡片与控件全亮色（证明主题即时生效、无需刷新） |
| `repo-settings-01-dark.png` | 仓库设置页（暗色）：导航条「返回日志 | 应用设置」；仅两张卡「Git 配置（仓库级）」9 行 +「GPG 提交签名」 |
| `repo-settings-02-light.png` | 同页明亮态：切主题后跨页保持（本页由互跳进入，未再点主题控件） |
| `github-settings-entry-light.png` | GitHub 面板顶部「设置」入口（明亮态）：Tooltip 语义为「打开应用设置：GitHub 令牌配在「账户」卡片」 |
| `koa-app-settings-light.png` | **web-koa SPA（:5173）应用设置页**（视口 1024×768）：`data-theme=light`、body `rgb(255,255,255)`、`--app-bg=#ffffff` —— 即「主题在 koa 侧不生效」缺口的修复证据 |

- **DOM 互证（与截图同轮）**：`:3081` 应用设置页导航条 `返回首页 x=16 w=72` → 竖线 `x=96 w=1 h=13`（`.ant-divider-vertical`）→ `仓库设置 x=104 w=72`，两侧各 8px（`Space size={0}` 后仅剩 Divider 自带外边距）；两按钮 `ant-btn-sm` 高 24px。`:5173` 同页同几何（`ant-btn-sm` 24px + `.ant-divider-vertical` 存在）。`:3081` 仓库设置页 DOM 断言 `app-settings-card`/`protected-branches-card`/`accounts-card` 均不存在，只剩 `repo-config-card` + `gpg-card`；应用设置页反之。
- **CLI 互证**：`git config --global --list` → `user.name/user.email/core.autocrlf` 仍来自全局（页面上「生效值」列即这些值），仓库 `.git/config` 内这 9 键仍为空 → 印证「应用设置页不含仓库级项、仓库设置页写 local」的作用域切分与页面呈现一致；冒烟结束 `GET /api/settings` → `theme: auto`。
- **截图账目**：本轮新增 **6** 张，`docs/shots/` 计 **206** 张；全量 SHA256 自检 **0 重复组**（含新增 6 张两两不同）。`settings-0*.png`（8 张）为拆分前单页形态，**未删除**（其功能点证据仍有效），后续按新两页命名重拍时再归档（**2026-09-13 已完成**：见 §5.26）。

### 5.26 全量截图重拍（2026-09-13，按当前 UI 逐张复拍）

> 触发：界面整体调整后，文档内引用的截图与现状脱节（控件尺寸档、主题三选、设置页拆分、页头按钮形态等）。本轮对 `docs/shots/` 在盘 206 张**逐张判定并重拍**，行内证据文本同步校准；收尾删掉 1 张失效「修复前」图后，在盘 **205 张 = 全部按当前 UI 重拍**。

**① 重拍范围与结果**

| 项 | 数值 |
|----|------|
| 在盘截图 | **205**（重拍完成后删除 1 张失效「修复前」图，见 ②） |
| 本轮重拍 | **205 / 205**（按当前 UI 逐张复拍，行内证据文本同步核对） |
| 未能重拍而保留的旧图 | **0** |
| 文档引用 vs 在盘 | 引用文件名**全部存在**（缺失 0）；在盘文件**全部被引用**（孤儿 0） |
| 跨文件 SHA256 | **0 重复组** |

**② 唯一未重拍的一张：按「失效证据」口径删除（不保留）**

- 对象：D-37 的**修复前**对照图（文件名按 §5.19 的记账约定不写全名，形如 `link-stretch-*-before.png`；`Tooltip > Button type="link"` 被拉伸到整行宽）。
- 处置：**删除**。理由与 §5.19 归档 D-39「重载后才正确」失败态图完全一致——缺陷已修（38 处调用点加 `alignSelf: flex-start`），**修复前的像素状态在当前代码下不可复现**；若留着，它与「在盘图 = 当前 UI 快照」的账目口径冲突，且重拍只会得到修复后的画面（等于伪造「before」）。
- 替代证据：D-37 的修复后态 = `responsive-1440-console.png`（本轮已按当前 UI 重拍，§5.18②），加上当轮六档复跑「koa 192/192、web-next 384/384 全通过」与 38 处调用点的代码落点（§5.24）。
- 记账影响：在盘截图由 206 → **205**，本轮 **205/205 全部按当前 UI 重拍**（该行不再有「未重拍」项）。

**③ 本轮为避免「同图跨文件重复」而做的状态区分（4 组）**

| 组 | 处置 |
|----|------|
| `app-settings-02-light` / `theme-light-settings` / `settings-04` / `koa-app-settings-light` | 四张同为「明亮设置页」：`theme-light-settings.png` 改拍**仓库设置页 + GPG 弹窗**；`settings-04.png` 取**重启后 1280×800** 视口；`koa-app-settings-light.png` 取 **SPA :5173 的 1024×768** 视口 |
| `conflicts-05` / `rebase-03` | 均为变基冲突：`conflicts-05.png` 改拍**先解决 shared.txt 后剩 3 个冲突**的面板态（`rebase-03.png` 为四冲突态） |
| `patch-03` / `patch-03b` | `patch-03b.png` 改在重名 400 返回后 **~380 ms（toast 入场完成、opacity=1）**抓拍，画面含「补丁已存在：f120-worktree」提示 |
| `shelf-03` / `status-page-06` | 均为状态页：`shelf-03.png` 改用**另一枚搁置（`f120-worktree`）**做双标签 SSE 复现（工作区 1 `README.md M` + 未跟踪 1 `f120-staged.txt`，uptime 6 s → 18 s 未重载） |

**④ 与旧口径的差异（本轮修正）**

- 设置页已**拆为两页**：`settings-01/02/06` 等行内图按拆分后的落点重拍（01/07/07b 在 `/settings` 应用设置页，02/06 在 `/repos/:id/settings` 仓库设置页），并新增 `app-settings-01-dark / 02-light`、`repo-settings-01-dark / 02-light` 四张整页图。
- 主题控件为**三选项**（自动/明亮/暗色）；F-152 的真重启实测在**明亮态**发起，重启（6.9 s 就绪）后主题与 `logInEditor` 均保持，随后已复位「暗色」+ `logInEditor=true`。
- 计数类口径随夹具推进更新（提交数、文件数、未跟踪数、`recentRepoIds`、菜单项数等），行内均已标注「随夹具推进变化」并给出复核值。
- `settings-0*.png`（拆分前单页形态）已全部**按新两页重拍完毕**，旧形态不再保留。

**⑤ 界面自查（本轮同一批截图之外的机器化复核）**

| 复核项 | 方法 | 结果 |
|--------|------|------|
| 页面级横向溢出 | `node scripts/check-fluid-layout.mjs`（33 个路由/状态格 × 360/480/768/1024/1440/1920 六档 × 明暗两主题 = **396 格**，断言 `scrollWidth <= clientWidth + 1`） | **396/396 全绿**（退出码 0、矩阵 0 行 ❌） |
| 密度档（compact 12px / 设置页 14px） | 同上脚本的 `assertDensity()`（按格内文本**主导字号**判定） | **396/396 全绿**（日志/列表/面板类主导 12px；`/settings`、`/repos/:id/settings` 主导 14px） |
| Monaco 内部横向滚动（例外断言②） | 同上：内容比编辑器宽时，必须「拖它自己的横向滚动条 → 内容真的位移」 | **按档如实判定**：360 档内容 375 > 编辑器 276 → 拖滑块后内容左移 **147px** ✅；480/768/1024/1440/1920 档长行放得下 → 判为「无需内部横向滚动」并注明排除了退化窄栏 |
| 页面级控件尺寸档 | DOM 抽样：11 个页面（log/status/patches/shelves/worktrees/tags/remotes/stashes/branches/search/ignore）统计可见 `button/.ant-input/.ant-select/.ant-segmented/textarea` 的高度 | **> 28px 的控件 0 个**（与 AGENT.md 的「页面级控件 small」一致） |

**本轮定位并修好的一格（`diff` 的例外断言：断言仪器问题、界面侧无缺陷）**

- **现象**：480 / 768 两档、明暗两主题报「拖动 Monaco 横向滚动条后内容未位移：x 46 → 46（滑块几何 `{"x":46,"y":880,"width":20,"height":12}`）」。
- **定位**（DOM 取证 + 审计 JSON 的 `extra.reason`）：并排模式下**左栏在窄档被压成 38px**（其 `.monaco-scrollable-element` 的 `clientWidth=0`、`scrollbar.horizontal .slider` 只有 20px 宽），而右栏长行其实**放得下**——480 档内容 375px ≤ 编辑器 396px、768 档 636 ≤ 684。旧排序只按「内容是否超过**自身**宽度」挑编辑器，于是选中这个 38px 退化栏：它的「溢出」是零宽宿主的空洞结论，拖它的滑块当然纹丝不动 → 假红。
- **修法**（`scripts/check-fluid-layout.mjs`）：选站加**可用宿主门槛** `MIN_USABLE_HOST_PX = 120`——低于门槛的窄栏只记录、不参与「已溢出」判定；pass/fail 文案里显式写出被排除的窄栏宽度（如「已排除退化窄栏 hostClientWidth=[38]」）。
- **修后实测**（`--widths=360,480,768` 退出码 0；随后全六档复跑退出码 0）：360 档走例外断言且**内容真的左移 147px**（内部横向滚动可用），480/768 档如实判为「长行放得下」；矩阵 **0 行 ❌、396/396 通过**。
- **结论**：这是**审计脚本自己的选站缺陷**，不是页面缺陷——界面侧无需改代码，也没有因此重拍任何截图（`diff-page-*.png` 等图与本次结论一致）。
- （定位过程中另做过一次独立手测：长行夹具 `rebased-smoke-big` 的 `big.txt`（620 字符/行）在 480 档悬停后横向滚动条 `opacity 0→1`、拖动滑块 `x 94 → 177`、`.view-lines` `x 94 → -20`，同样证明内部横向滚动可用。）

**⑥ 本轮为跑通上面这套自查而对脚本做的四处加固（`scripts/check-fluid-layout.mjs`）**

1. **Monaco auto-hide 滚动条**：拖动前先悬停滑条 ~900ms 等它显形，再取一次 `boundingBox()` 后按下（原先 250ms 直拖，按下时滑块尚未接管指针）。
2. **拖动重试改拖到右端**：首轮仍按「中心 + 120px」，未位移则第二轮拖到「滚动条右端 − 4px」。
3. **EllipsisText 悬停站点**：候选必须「中心点能被自己命中」（过滤掉被弹窗遮罩盖住的元素）；本格的状态动作会打开重置弹窗，360 档下页面上可见的 EllipsisText 全在遮罩之后 → 此时**关掉弹窗在同页重挑一次**再悬停（断言语义不变）。
4. **退化窄栏不参与溢出判定**（`MIN_USABLE_HOST_PX`，见上一节）：修掉 `diff` 格在窄档的假红。

加固后：`--widths=360` 退出码 0、`--widths=360,480,768` 退出码 0、**全六档 396 格退出码 0**。

> 运行提示：该脚本会**逐格切主题**（明暗各跑一遍），跑完不留复位动作——本轮三次运行后均手动把主题复位为「暗色」（`PUT /api/settings {theme:'dark'}`，浏览器侧复核 `data-theme=dark`、`body rgb(20,20,20)`、Segmented 停「暗色」），并把探针过程中改动的夹具（搁置恢复造成的工作区改动等）用 `git reset --hard` + `git clean -fd` 清回干净态。

### 5.27 表单 / 对话卡 / 二次确认 取证矩阵（2026-09-13 起补图）

**口径（本节新增，与 §1.2 的「每行一张最终效果图」并行生效）**

- **每个「表单 / 对话卡 / 二次确认」表面至少 2 张图**：
  - `<slug>-<NN>b.png` = **确定前的表单**（输入已填、选项可见、提交按钮尚未触发）；
  - `<slug>-<NN>.png` = **提交后的成功**（成功提示 toast 或结果态：列表/徽标/工作区随之变化）。
- 成功态必须能被**独立复证**：优先在画面里带成功提示或结果差异，并在行内附 CLI 或 DOM 断言。
- **抽屉（Drawer）：本应用没有该组件**——全仓检索 `packages/client/ui/src` 与两个 app 的 `.tsx`，`<Drawer` / `Drawer` 命中 **0** 处（浮层形态只有 Modal / Popconfirm / Dropdown / Tooltip）。故本节的「抽屉」一项为**空集**，不是漏拍。
- **涉及新 UI 组件的都要有图**：`packages/client/ui/src/base/*`（`app-theme`、`density-context`、`ellipsis-text`、`empty-state`、`file-tree`、`graph-canvas`、`monaco-diff-view`、`monaco-lazy`、`monaco-text-view`、`operation-status`、`page-shell`、`split-pane`、`toolbar`、`virtual-list`）与 `domain/*`（`commit-details-panel`、`commit-graph`、`committed-status`、`diff-viewer`、`hunk-diff-view`、`repo-status-bar`）逐个落到至少一张图上（清单见本节末，随批次补齐）。

**① 本轮已完成（71 个表面 / 142 张配对图）**

| 表面 | 类别 | 触发位置 | 确定前（表单） | 提交后（成功） | 复证 |
|------|------|----------|----------------|----------------|------|
| 从此处新建分支 | 表单（Modal） | 日志页提交行右键 →「从此处新建分支…」 | `log-page-21b.png`（填 `f-ui-branch-probe`，创建后检出默认勾选） | `log-page-21.png`（toast「已创建并检出分支 f-ui-branch-probe」+ 图内分支 chip） | CLI：`git branch --list f-ui-branch-probe` → `56d0e23`（点=当前分支），冒烟后已切回 `stash-branch-f083-r5b` |
| 从此处新建标签 | 表单（Modal） | 同上 →「从此处新建标签…」 | `log-page-22b.png`（标签名 + 附注信息两栏） | `log-page-22.png`（toast「已创建标签 v-ui-tag-probe」） | CLI：`git for-each-ref refs/tags/v-ui-tag-probe` → `tag \| 表单取证：附注标签`（附注标签成立） |
| Reword Commit | 表单（Modal） | 提交行右键 →「Reword Commit」 | `log-page-23b.png`（`reword-message-input` 已填新信息） | `log-page-23.png`（toast「变基完成」+ 首行 subject 变为「chore(smoke): reword 表单取证（截图用）」） | CLI：改写后 tip `d82ee68 chore(smoke): reword 表单取证（截图用）`；跑完 `git reset --hard a91ade7` 复位（改写发生在 `rebased-smoke-clone`，不碰主仓历史） |
| 提交表单（状态页「提交」卡） | 表单（页内卡） | 状态页底部「提交」→ 填提交信息 →「提 交」 | `status-page-14b.png`（已暂存（1）`README.md`、提交信息已填） | `status-page-14.png`（已暂存 0 / 工作区 0、提交框清空） | CLI：新提交 `ca02f3e chore(smoke): 表单取证——提交对话框（截图用）`（落在探针分支 `f-ui-branch-probe`，主分支 `stash-branch-f083-r5b` 保持 `56d0e23` 不动） |
| 「检测到 CRLF 行尾符」对话卡 | 二次确认（Modal，三选） | 提交含 CRLF 的文件时自动弹出 | `status-page-15b.png`（说明 + 取消 / 原样提交 / 修复并提交，testid `crlf-cancel` / `crlf-keep` / `crlf-fix`） | `log-page-24.png`（选「原样提交」后日志页首行出现该提交） | CLI：同上 `ca02f3e`；「修复并提交」分支会改全局 `core.autocrlf=true`，本轮**未走该分支**（避免改全局配置），界面已把三条出路都拍照在册 |
| 放弃选中修改 | 二次确认（Popconfirm） | 状态页「工作区」组：勾选行 →「放 弃」 | `status-page-16b.png`（「放弃选中修改？不可恢复」） | `status-page-16.png`（工作区 1→0） | CLI/DOM：确认后 `git status` 该行消失、README 探针行不再存在 |
| 删除选中未跟踪文件 | 二次确认（Popconfirm） | 状态页「未跟踪」组：全选 →「删 除」 | `status-page-17b.png`（「删除选中未跟踪文件？不可恢复」） | `status-page-17.png`（未跟踪 1→0） | CLI/DOM：确认后 `f-ui-untracked.txt` 从磁盘消失 |
| 新建分支（分支页） | 表单（Modal） | `/branches` →「新建分支」 | `branch-12b.png`（`create-name` 填 `f-ui-branch-2`、`create-start-point` 填 `HEAD~1`、「创建后检出」勾选项可见） | `branch-12.png`（列表出现新行 `f-ui-branch-2`） | DOM：下一格的删除确认框文案指名「确定删除分支 f-ui-branch-2？」→ 证明该分支确已建出；CLI 收尾复核 `f-ui-branch-2` 已不存在 |
| 删除分支（分支页） | 二次确认（Popconfirm） | `/branches` 行内操作菜单 →「删除」 | `branch-13b.png`（「确定删除分支 f-ui-branch-2？」） | `branch-13.png`（该行消失） | DOM：确认后 `[data-testid="row-local-f-ui-branch-2"]` 命中 0；CLI：`git branch --list f-ui-branch-2` 为空 |
| 推送对话框 | 表单（Modal） | 顶栏「更多」→「推送」 | `push-07b.png`（远程 `origin`、分支 `f-ui-branch-probe`、`force-with-lease` 未勾、**`set-upstream` 已勾**） | `push-07.png`（toast「推送完成」） | CLI：`origin/f-ui-branch-probe` = `ca02f3e` 被建出，`f-ui-branch-probe@{upstream}` = `origin/f-ui-branch-probe`，未推送提交数 1→**0** |
| 拉取对话框 | 表单（Modal） | 同上 →「拉取」 | `pull-04b.png`（远程 `origin`、「使用 rebase 而非 merge」未勾） | `pull-04.png`（toast「拉取完成」+ 首行变为远端新提交） | 前置：克隆仓往 `origin/f-ui-pull-target` 推了 1 笔（`36fa99a`），主仓该分支落后 1；拉取后 CLI：`f-ui-pull-target` = `origin/f-ui-pull-target` |
| 更新项目对话框 | 表单（Modal） | 同上 →「更新项目」 | `update-04b.png`（`merge` / `rebase` 单选，`merge` 选中；「Reset to tracked：f-ui-pull-target → origin/f-ui-pull-target」行） | `update-04.png`（首行变为远端第二笔提交） | 前置：克隆仓再推 1 笔（`e7b0f97`）；更新后 CLI：`f-ui-pull-target` = `e7b0f97` = 上游 |
| 合并对话框 | 表单（Modal） | 顶栏「合并」 | `merge-05b.png`（来源分支选中 `f-ui-branch-probe`；`no-ff` / `squash` / `no-commit` 三开关均未勾） | `merge-05.png`（toast「合并完成」+ 首行 `Merge branch 'f-ui-branch-probe' into f-ui-pull-target`） | CLI：合并提交 `1f7028b`，提交行数 31→32 |
| 变基对话框 | 表单（Modal） | 顶栏「更多」→「变基」 | `rebase-06b.png`（简单 / 交互 Segmented 在「简单」，目标 `onto` 填 `stash-branch-f083-r5b`） | `rebase-06.png`（toast「变基完成」+ 顶部三行为 B / A / 目标） | CLI：`f-ui-rebase-probe` 由 `2c1668e` 重写为 `580761c`，父链 `580761c → 1c7b347（重放的 A）→ 56d0e23（目标）`（哈希已改写、历史线性） |
| 重置对话框 | 表单（Modal） | 提交行右键 →「Reset 当前分支到此处」 | `reset-04b.png`（目标 `56d0e23` + `soft` / `mixed` / `hard` 三模式，`mixed` 默认选中） | `reset-04.png`（toast「已重置」+ 首行变为目标提交） | CLI：`f-ui-reset-probe` 由 `580761c` → **`56d0e23`**；mixed 保留工作区，切回主分支时 A/B 探针文件以未跟踪态出现，收尾已清理（工作区 `clean`） |
| 删除标签（标签页） | 二次确认（Popconfirm） | `/tags` 行内「删除」 | `tag-04b.png`（「确定删除标签 v-ui-tag-del-probe？」） | `tag-04.png`（该行消失） | CLI：`git tag -l 'v-ui-tag-*'` 不再含 `v-ui-tag-del-probe` |
| 推送标签（标签页） | 二次确认（Popconfirm） | `/tags` 行内「推送」 | `tag-05b.png`（「推送标签 v-ui-tag-push-probe 到远程仓库？」） | `tag-05.png`（toast「标签推送完成：v-ui-tag-push-probe」） | CLI：`git ls-remote --tags origin` 出现 `v-ui-tag-push-probe`（附注标签，另有 `^{}` 剥离项） |
| 删除远程（远程页） | 二次确认（Popconfirm） | `/remotes` 行内「删除」 | `remote-05b.png`（「确定删除远程 f-ui-remote-probe？」） | `remote-05.png`（行消失、仅剩 `origin`） | CLI：`git remote` 仅 `origin` |
| 删除补丁（补丁页） | 二次确认（Popconfirm） | `/patches` 行内「删除」 | `patch-05b.png`（「确定删除补丁 f-ui-patch-probe？」） | `patch-05.png`（列表回 3 条；画面带「应用」Tooltip） | CLI：补丁目录仅剩 `f120-range/staged/worktree`；**注**：删除后的列表与 `patch-01.png`（创建三态后的同一列表）曾字节相同被判重复组，故重拍时加入悬停 Tooltip 作画面区分 |
| 清理失效工作树（工作树页） | 二次确认（Popconfirm） | `/worktrees`「清理」 | `worktree-04b.png`（「确定清理失效工作树？」） | `worktree-04.png`（toast「已清理失效工作树」+ 行数 3→2） | CLI：`git worktree list` 剩主工作树 + `rebased-smoke-wt-new` |
| 弹出贮藏（贮藏页） | 二次确认（Popconfirm） | `/stashes` 行内「弹出」 | `stash-06b.png`（「确定弹出 stash@{0}？弹出后将移除该贮藏」，画面同时含上方的「保存贮藏」表单） | `stash-06.png`（该行消失） | CLI：`git stash list` 7→6，且 `git status` 出现被恢复的 `?? f-ui-stash-c.txt`（弹出的改动确实回到工作区），收尾已清理 |
| 删除贮藏（贮藏页） | 二次确认（Popconfirm） | `/stashes` 行内「删除」 | `stash-07b.png`（「确定删除 stash@{0}？」） | `stash-07.png`（列表 6→5；画面带「应用」Tooltip） | CLI：`git stash list` 6→5（被删探针的 a/b 两文件随贮藏一并消失）；**注**：删除后的列表与 `stash-03.png` 曾字节相同被判重复组，故重拍时加悬停 Tooltip 作区分 |
| 删除搁置（搁置页） | 二次确认（Popconfirm） | `/shelves` 行内「删除」 | `shelf-04b.png`（「确定删除搁置 f-ui-shelf-probe？」） | `shelf-04.png`（行消失，仅剩 `f120-worktree` / `smoke-shelf-r3`；画面带「恢复」Tooltip） | CLI：`shelves/<repoId>/f-ui-shelf-probe/` 目录已移除；**注**：删除后的列表与 `shelf-02.png` 曾字节相同被判重复组，故重拍时加悬停 Tooltip 作区分 |
| 添加账户（应用设置页） | 表单（Modal） | `/settings`「账户」卡 →「添加账户」 | `settings-08b.png`（主机 `example.com`、账户 `ui-probe`、令牌已填；testid `account-host-input` / `account-name-input` / `account-token-input`） | `settings-08.png`（toast「账户已保存」+ 行显示掩码 `ui-p***`） | CLI/DOM：账户卡片文本为 `example.com ui-probe ui-p***`；`config.json` 写入 `auth.accounts`（token 仅掩码下行） |
| 删除账户（应用设置页） | 二次确认（Popconfirm） | `/settings` 账户行「删除」 | `settings-09b.png`（「确定删除账户 ui-probe（example.com）？」） | `settings-09.png`（卡片回到「暂无账户」；画面带「添加账户」Tooltip） | `GET /api/auth/accounts` → `{"accounts":[]}`；**注**：该画面与 `app-settings-01-dark.png` 曾字节相同（同为空账户的全页暗色设置页），故重拍时加悬停 Tooltip 作区分 |
| 重命名分支（分支页） | 表单（Modal） | `/branches` 行内操作菜单 →「重命名」 | `branch-14b.png`（Modal「重命名分支 f-ui-rename-probe」，`rename-input` 填 `f-ui-renamed-ok`） | `branch-14.png`（旧行消失、新行出现） | DOM：`row-local-f-ui-renamed-ok` 命中 1、旧行命中 0；CLI：`f-ui-renamed-ok` = `56d0e23`，旧名已不存在 |
| 设置上游（分支页） | 表单（Modal） | `/branches` 行内操作菜单 →「设上游」 | `branch-15b.png`（Modal「设置上游：f-ui-upstream-probe」，`upstream-input` 填 `origin/f-ui-pull-target`） | `branch-15.png`（该行显示 `f-ui-upstream-probe origin/f-ui-pull-target ↓2`） | CLI：`f-ui-upstream-probe@{upstream}` = `origin/f-ui-pull-target` |
| 清理已合并（分支页） | 二次确认（Popconfirm） | `/branches` 顶部「清理已合并（N）」 | `branch-16b.png`（按钮当时为「清理已合并（2）」，Popconfirm「清理 2 个已合并分支？不可恢复」） | `branch-16.png`（toast「已清理 2 个已合并分支」+ 按钮回「（0）」、两行消失） | CLI：`rebased-smoke-clone` 的 `f-ui-merged-a/-b` 已不存在。**注**：本格刻意在 clone 上取证——主仓当时的已合并集合含被其它证据引用的分支（`wt-new-branch` 还挂着工作树），真清理会破坏夹具 |
| GPG 提交签名配置（仓库设置页） | 表单（Modal）→ 保存 | `/repos/:id/settings`「GPG 提交签名」→「配置…」 | `settings-06.png`（弹窗表单：启用勾选框 + 密钥下拉均禁用 + Alert「未找到可用的 gpg 密钥」） | `settings-10.png`（toast「GPG 签名配置已保存」+ 卡片状态行「未启用 / commit.gpgsign 为 false/未设置」） | CLI：`git config --local --get commit.gpgsign` = `false`（「取消勾选只写 false、不清 `user.signingkey`」的口径见 F-154） |
| 创建工作树（工作树页） | 表单（Modal） | `/worktrees`「创建」 | `worktree-02b.png`（Modal：「关联已有分支 / 创建新分支」互斥 Radio + 路径/分支输入） | `worktree-02.png`（列表 3→4、新工作树行出现） | **既有图配对（2026-09-13 登记）**；CLI 与嵌套路径拒绝见 F-128 |
| 移除工作树（含强制勾选） | 二次确认（Popconfirm） | `/worktrees` 行内「移除」 | `worktree-03b.png`（确认框 + 「强制移除（--force）」勾选态） | `worktree-03.png`（移除与清理后的列表） | **既有图配对（登记）**；脏工作树不带 force 报 500 原文的口径见 F-129 |
| 子模块更新（行内 + 递归全量） | 表单（页内控件：递归 Checkbox + 行内「更新」） | `/submodules` | `submodule-02b.png`（「递归更新」勾选态） | `submodule-02.png`（更新后列表：未初始化→已检出、漂移归位） | **既有图配对（登记）**；CLI 前缀 `-` → 空格、`+` → 空格见 F-131 |
| 恢复搁置 | 二次确认（Popconfirm） | `/shelves` 行内「恢复」 | `shelf-02b.png`（「确定恢复搁置 f124-shelf？」） | `shelf-02.png`（恢复回写 + 同名不覆盖两重实测后的列表） | **既有图配对（登记）**；CLI 见 F-125 |
| 创建补丁（三态） | 表单（Modal） | `/patches`「创建补丁」 | `patch-01b.png`（Modal：工作区 / 暂存 / 提交区间三选一） | `patch-01.png`（列表出现三枚补丁） | **既有图配对（登记）**；三态与 CLI 逐字节相同的口径见 F-120 |
| 忽略文件（状态页一键忽略） | 二次确认（Modal.confirm） | 状态页未跟踪行「忽略」 | `ignore-02b.png`（「忽略文件? 将给 .gitignore 追加 /… 行」） | `ignore-02.png`（该文件从未跟踪列表消失） | **既有图配对（登记）**；幂等复测见 F-133 |
| Drop Commit（丢弃提交） | 表单（Modal，含确认语义） | 日志页提交行右键 →「Drop Commit」 | `log-page-25b.png`（Modal「Drop Commit：删除提交（其变更一并丢弃）（历史将被重写）；冲突时可在冲突页解决」） | `log-page-25.png`（toast「变基完成」+ 首行变为其父提交） | CLI：`f-ui-renamed-ok` 由 `56d0e23` → `048df64`（被 drop 的提交从分支历史消失），提交行数 28→27 |
| 检出此提交（游离 HEAD） | 二次确认（Modal） | 日志页提交行右键 →「检出此提交（游离 HEAD）」 | `log-page-26b.png`（「检出此提交：将切换到游离 HEAD 状态（建议先确认工作区干净），确定？」） | `log-page-26.png`（toast「已检出」+ 顶栏进入游离 HEAD 态） | CLI：确认后 `git rev-parse --abbrev-ref HEAD` = `HEAD`（游离）、`rev-parse --short HEAD` = `bf7794e`；跑完已 `git checkout stash-branch-f083-r5b` 复位 |
| 添加远程（远程页） | 表单（Modal） | `/remotes`「添加远程」 | `remote-06b.png`（Modal：`add-remote-name` 填 `f-ui-remote-add`、`add-remote-url` 填 `D:\…\smoke-remote`） | `remote-06.png`（列表出现新行 `f-ui-remote-add`） | DOM：行 testid `row-remote-f-ui-remote-add` 命中；CLI：`git remote -v` 出现该远程（跑完已 `git remote remove` 清理） |
| 编辑远程（远程页） | 表单（Modal） | `/remotes` 行内「编 辑」 | `remote-07b.png`（Modal「编辑远程：f-ui-remote-add」，`edit-remote-url` 改为 `…\smoke-remote-renamed`） | `remote-07.png`（该行 URL 同步变为新值） | CLI：`git remote -v` 显示 `f-ui-remote-add → D:\…\smoke-remote-renamed`（fetch/push 同时改写） |
| 存入贮藏（状态页） | 表单（Modal） | 状态页工具行「存入贮藏」 | `status-page-18b.png`（Modal「存入贮藏」，`page-action-stash-input` 填 `f-ui-stash-inline-probe`；页面背景为已暂存（1）态） | `status-page-18.png`（toast「已存入贮藏」+ 已暂存/工作区/未跟踪三组清空） | CLI：`git stash list` 首条 = `On stash-branch-f083-r5b: f-ui-stash-inline-probe`，工作区 `clean` |
| 打开仓库（首页） | 表单（**页内输入**，非 Modal） | 首页「仓库路径」输入框 +「打开」 | `repo-page-11b.png`（输入框填 `D:\zhanglei1120\Github\rebased-smoke`） | `repo-page-11.png`（跳转到该仓日志页、提交列表就绪） | DOM：点击后 URL = `/repos/2035965b…`，首行为 `chore(smoke): 移除 F-130 临时子模块夹具`；**注**：antd 未给该按钮插空格，按钮文本是「打开」（连写） |
| 克隆仓库（首页 Modal） | 表单（Modal） | 首页「克隆」 | `repo-page-12b.png`（Modal：`clone-url` = `D:\…\smoke-remote`、`clone-dir` = `D:\…\rebased-smoke-clone-ui`） | `repo-page-12.png`（克隆完成并进入新仓日志页） | DOM/CLI：新仓 id `595550cf-363c-446d-8764-5a38775dab69`，首行 `chore(smoke): 远端 master 强推改写（F-070 前置）`、chip `master` / `origin/master` / `origin/HEAD`；收尾已移除该仓条目并删掉目录 |
| 移除仓库（首页列表） | 二次确认（Popconfirm） | 首页仓库行「移除」 | `repo-page-13b.png`（「移除该仓库？」） | `repo-page-13.png`（该行消失） | DOM：`rebased-smoke-clone-ui` 不再出现、仓库条目数回到 11；CLI：目录已删除 |
| 忽略配置编辑器（保存成功） | 表单（Modal）+ 保存 | `/ignore`「编辑忽略规则」 | `ignore-01.png`（编辑器 Modal：`.gitignore` / `.git/info/exclude` 双 target + 模板 Select + 内容区） | `ignore-03.png`（保存后回状态页：未跟踪（0），被忽略的探针文件不再出现） | CLI：`.gitignore` 39→62 B、末行 `/f-ui-ignore-probe.txt`；跑完已清理该探针行与文件（复位 39 B） |
| 认证对话框（需要认证） | 表单（Modal）+「保存并重试」 | 远程操作返回 `AUTH_FAILED` 时由页面容器打开（`apps/web-next/app/repos/[repoId]/page.tsx` 与 `apps/web-koa/src/pages/repo.tsx` 的认证重试回路；host 取自 `err.context`） | `auth-dialog-01b.png`（Modal「需要认证」：主机 `127.0.0.1` 已预填，`auth-account` = `ui-probe`、`auth-token` 已填；按钮为 取消 / 保存并重试） | `auth-dialog-01.png`（凭据保存后**同一主机上的远程操作成功**：远端管理页对 `f-ui-auth-remote` 点 Fetch → toast「fetch 完成，更新 0 个引用」，且不再出现先前的「认证失败，请配置该主机的访问令牌」） | **基建**：本地 Node 静态服务器（Basic 鉴权 + `git update-server-info` 的 dumb HTTP）挂在 `127.0.0.1:9420`，根目录为 `D:\zhanglei1120\Github`；无凭据 → 401、凭据正确 → 200（CLI 侧 `git clone` 实测成功）。**口径**：重试回路重放的原操作是 `git pull f-ui-auth-remote`，而 dumb HTTP 无法完成合并/推送（push 返回 curl 22），故「提交后成功」取同一主机上可完成的操作（Fetch）作证据；探针远程、账号与服务脚本收尾已全部清理（`accounts: []`、`git remote` 仅 `origin`） |
| amend 到…（指定历史提交） | 表单（页内下拉 + 提交按钮） | 状态页提交卡的 `amend-target-select` | `status-page-19b.png`（下拉已展开并选中「Amend chore(smoke): amend 目标探针 A（未发布）」，提交信息已填） | `status-page-19.png`（toast「已重写指定提交」+ 已暂存/工作区清零、下拉复位为占位符） | CLI：目标 `09f7974` 被重写为 **`6620ebd`**（subject 变为本次 amend 信息），其树同时含 `f-ui-amend-probe.txt`（原内容）与 `f-ui-amend-c.txt`（本次暂存内容）；原 B 提交随之重写为 `80b7e27`，链路 `80b7e27 → 6620ebd → 56d0e23`。**前置**：候选由 `GET /commit/amend-targets` 给出＝「未发布的非合并非 HEAD 提交」——夹具当时的提交都能从 origin 的探针分支到达（`--not --remotes` 为空），故先造两笔真正未发布的探针提交才出现候选 |
| Fixup Commit（生成 fixup! 提交） | 表单（Modal，含确认语义） | 日志页提交行右键 →「Fixup Commit」 | `log-page-27b.png`（Modal「Fixup Commit：将以暂存内容创建 fixup! 提交并折入选中提交（历史将被重写）；无暂存内容请先在状态页暂存」） | `log-page-27.png`（首行出现 `fixup! chore(smoke): amend 头部探针 B（未发布）`） | CLI：新提交 **`65ecfbb fixup! chore(smoke): amend 头部探针 B（未发布）`**，其父即被指向的 `80b7e27`，暂存区随之清空，探测文件 `f-ui-fixup.txt` 已在该提交树中。**注**：首次确认时命中「仓库正忙（索引被其它 git 操作锁定）」瞬时提示（D-41 口径，CLI 与页面并发写索引），重取画面时提示已消失、提交已落地 |
| Squash Commit（生成 squash! 提交） | 表单（Modal，含确认语义） | 日志页提交行右键 →「Squash Commit」 | `log-page-28b.png`（Modal「Squash Commit：将以暂存内容创建 squash! 提交并折入选中提交（历史将被重写）；无暂存内容请先在状态页暂存」） | `log-page-28.png`（顶部已无 `squash!`/`fixup!` 行，被折入的目标提交成为首行） | CLI：确认后**直接 autosquash 折入**——新 tip `f6f25d0`（subject 仍是「…B（未发布）」）的树含 `f-ui-squash.txt`（`HEAD~1` 不含），且上一轮的 `65ecfbb fixup!` 也一并被折入而**从历史消失**（`merge-base --is-ancestor 65ecfbb HEAD` 为假）；暂存区清空 |
| 变更集（快照栏标签 + 逐文件差异） | 查看（快照栏标签）+ 联动 | 提交详情面板「查看变更集」 | `log-page-33b.png`（快照栏标签栏三族并存：「文件（136）」/「变更集（2）」/差异标签；清单给出提交主题 + `M README.md` / `M docs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md`；详情面板「查看变更集」呈选中态；**全程无弹窗**） | `log-page-33.png`（点清单里 `…design.md` → **同一标签栏**开差异标签并激活：路径栏 = 该路径 + 「与父提交对比」，行内 Monaco diff 已渲染） | **CLI 互证**：`git -C D:\…\proxyGateway show --name-status dd5c9b77` 恰好同 2 个 `M` 文件（列表与仓库事实一致）。**形态断言**：页面无 `role=dialog`——变更集 Modal 已删除，改为标签。**粘性 + 剪枝**（同轮实测）：切到 `a3433b81`（变更集 2 文件）→「变更集（2）」标签保留、内容换成新提交的；其差异标签 `lib/convert/responses-to-chat.js` **不在新变更集里 → 自动关掉**；再切到 `83f6052`（变更集只有 `README.md`）→ 在 `dd5c9b77` 打开的 `README.md` 差异标签**保留并按新提交重算**（仍为激活标签、Monaco 已渲染）。**根提交降级**：`?select=e74f624`（该仓根提交）→「变更集（7）」；点 `app.js` 只给提示行、Monaco 未渲染，且网络面板 **0 条 `/diff` 请求**（无父版本不发请求）。**开关**：再点一次「查看变更集」→ 变更集标签与差异标签一并消失、按钮回默认态。**刷新边界**：变更集/差异标签不进地址栏，刷新后回到「文件（N）」标签 |
| 删除该文件（冲突整侧解决） | 二次确认（Popconfirm） | 冲突页 `deleted-by-them.txt` 行「删除该文件」 | `conflicts-07b.png`（「确认以删除解决该冲突？」） | `conflicts-07.png`（冲突文件 4→3，该行消失） | CLI（本轮同一流程收官后复核）：`deleted-by-them.txt` 已从工作区移除、最终未进入合并结果；同轮其余三项为 `shared.txt`=master 侧、`both-added.txt`=feature 版本 |
| 手动合并（MergeView 保存） | 表单（全屏 Modal，Monaco 三栏） | 冲突页 `manual-merge.txt` 行「手动合并」 | `conflicts-08b.png`（Modal 三栏：当前分支 / 合并来源 / 合并结果；结果栏已改为 `line1 master` / `line2 feature` / `line3 resolved-by-hand`） | `conflicts-08.png`（点「保 存」后 Modal 关闭、冲突文件 3→2） | CLI：`manual-merge.txt` 落盘内容与结果栏**逐行一致**（`line1 master` / `line2 feature` / `line3 resolved-by-hand`），该路径脱离未合并 |
| 完成合并（登记既有配对） | 结果态 + 提交 | 冲突页底部「完成合并」 | `conflicts-04.png`（冲突文件（0）、「完成合并」可点） | `conflicts-04b.png`（自动回日志页） | **既有图配对（登记）**；本轮复跑：合并提交 `cbddab3 Merge branch 'feature'`（旧记录 `aa621c1` / `ec1320f` 系历史重写前） |
| 跳过（登记既有配对） | 二次确认（Popconfirm） | 变基冲突时面板底部「跳 过」 | `conflicts-05b.png`（「跳过当前提交（其变更将被丢弃）？」） | `conflicts-05.png`（变基冲突面板：冲突文件（3）+「跳 过」/「继续变基」+ 页内提示） | **既有图配对（登记）**；CLI（`.git/rebase-merge` 清除、被跳过提交不在历史）见 F-118 |
| 与工作树差异（分支页） | 查看（Modal）+ 联动 | `/branches` 行内菜单 →「与工作树差异」 | `branch-17b.png`（Modal「与工作树差异（master）」列出 9 个差异文件，testid `working-diff-file-*`） | `branch-17.png`（点 `f-ui-squash.txt` → `/diff?file=f-ui-squash.txt&from=master&files=[…9 项…]`，Monaco 已渲染） | 查看型对话卡：配对取「卡本体 + 点文件后的联动」；`from=master` 即该分支名（与工作树对比） |
| 检出并变基到当前（远程分支） | 表单（Modal） | `/branches` 远程分支行菜单 →「检出并变基到当前」 | `branch-18b.png`（Modal「检出并变基到当前：origin/f-ui-pull-target」，`remote-rebase-input` 填 `f-ui-checkout-rebase`） | `branch-18.png`（toast「已检出 origin/f-ui-pull-target 并变基到当前分支」） | CLI：新分支 `f-ui-checkout-rebase` @ `162e326`，上游 = `origin/f-ui-pull-target`，其历史为远端两笔（`d6effa4` / `162e326`）**重放到当前分支 `f6f25d0` 之上**；跑完已切回 `stash-branch-f083-r5b` 并删除该探针分支 |
| Push up to Commit（远端推进到指定提交） | 表单（Modal，含安全强推勾选） | 日志页提交行右键 →「Push up to Commit」 | `log-page-30b.png`（Modal「推送（Push up to Commit）：将把当前分支推到提交 56d0e23（须覆盖远端较新的提交时勾选 force-with-lease）」+ 远程 `origin` + `force-with-lease` 已勾） | `log-page-30.png`（toast「推送完成」；图内 `origin/f-ui-branch-probe` 的 chip 已落到目标提交行） | CLI：本地 `f-ui-branch-probe` 仍 `ca02f3e`（不动），**远端** `origin/f-ui-branch-probe` 由 `ca02f3e` → `56d0e23`（裸仓 `smoke-remote` 实测同值）——即「把远端推进到该提交」的语义 |
| Squash Commit（并入父提交） | 表单（Modal，含确认语义） | 日志页提交行右键 →「Squash Commit（并入父提交）」 | `log-page-31b.png`（Modal「Squash Commit：并入父提交（提交数 -1，信息合并）（历史将被重写）；冲突时可在冲突页解决」） | `log-page-31.png`（toast「变基完成」+ 首行变为被并入的父提交） | CLI：`f-ui-branch-probe` 由 `ca02f3e` → `76dbbe8`（subject 取父提交「移除 F-130 临时子模块夹具」，树 = 父提交树 **+** 被并入提交的 README 行「表单取证：提交对话框探针」）。**前置**：该动作**要求索引干净**——首轮带暂存内容提交时报 `cannot rebase: Your index contains uncommitted changes`，清空暂存后成功 |
| Fixup Commit（并入父提交） | 表单（Modal，含确认语义） | 日志页提交行右键 →「Fixup Commit（并入父提交）」 | `log-page-32b.png`（Modal「Fixup Commit：并入父提交（保留父提交信息，提交数 -1）（历史将被重写）；冲突时可在冲突页解决」） | `log-page-32.png`（toast「变基完成」+ 首行变为被并入的父提交） | CLI：`f-ui-branch-probe` 由 `76dbbe8` → `b6f3180`，subject 保留父提交的「F-130 子模块夹具（ok-sub / drift-sub）」、树仍含上一步折入的 README 行；父链 `b6f3180 → 4db0f92 → bf7794e` |
| 删除远程标签（标签页） | 二次确认（Popconfirm） | `/tags` 行内「删除远程」 | `tag-06b.png`（「确定从远程删除标签 v-ui-tag-push-probe？」） | `tag-06.png`（toast「已删除远程标签 v-ui-tag-push-probe」；鼠标停在被操作行上，该行底色高亮以指明目标） | CLI：操作前后各跑一次 `git ls-remote --tags origin` —— 前：`v-ui-tag-push-probe`（`0898d960…`）与 `v-ui-tag-probe` 都在；后：**只剩 `v-ui-tag-probe`**。本地 `git tag --list 'v-ui*'` 两条仍在 → 删的是**远端侧**。**页面观察**：该页每行恒定渲染 推送 / 删除远程 / 删除 三按钮，不区分「是否已推送」，故成功态只能由 toast + CLI 互证 |
| 推送全部标签（标签页） | 二次确认（Popconfirm） | `/tags` 顶部「推送全部」 | `tag-07b.png`（「推送全部标签到远程仓库？」） | `tag-07.png`（toast「全部标签推送完成」） | CLI：紧接上一格（远端已被删掉 `v-ui-tag-push-probe`、本地仍有）点确认后，`git ls-remote --tags origin` 中**该 tag 重新出现**（`0898d960…` + `^{}` → `56d0e230…`）——即「全部推送」把「本地有、远端无」的标签补推回远端；列表 7 行不变。**收尾**：为与上一格的证据口径对齐，截图后再次执行「删除远程标签」，残余态 = 远端无 `v-ui-tag-push-probe`、本地两条探测标签仍在（`v-ui-tag-probe` / `v-ui-tag-push-probe`） |
| 贮藏转分支（贮藏页） | 表单（Modal） | `/stashes` 行内「转分支」 | `stash-08b.png`（Modal「贮藏转分支：stash@{0}」，`stash-branch-name-input` 填 `f-ui-stash-to-branch2`；背景为「贮藏列表（6）」，目标行 `On master: f-ui-unstash-as-probe` 高亮） | `stash-08.png`（贮藏列表 **6→5**、该行消失；帧内悬停新首行的「转分支」露出 Tooltip「以该贮藏为起点创建并检出新的分支（打开分支命名窗口）」） | CLI：新分支 `f-ui-stash-to-branch2` 已存在且被检出（HEAD @ `ed81a0a` = 该贮藏基线），贮藏内容落到工作区（`git status` = `M README.md` / `M src/app.ts`），`git stash list` 6→5。**该动作不弹 toast**（确认后轮询 9s 无 `.ant-message-notice`），成功态由「列表计数变化 + CLI 分支创建」互证。**重拍说明**：首拍的成功帧与既有 `stash-03.png`（F-083 的同类结果态）**字节相同**，故加悬停 Tooltip 重拍以区分 |
| Unstash As…（贮藏页） | 表单（Modal + 下拉） | `/stashes` 行内「Unstash As…」 | `stash-09b.png`（Modal「Unstash As：stash@{0}」+ 说明「将检出目标分支并应用该贮藏（贮藏保留，不弹出）」+ 分支下拉已选 `master`） | `stash-09.png`（toast「已检出 master 并应用贮藏」；贮藏列表仍 6 行） | CLI：HEAD 由 `f-ui-branch-probe` → **`master`**（`ed81a0a`），README.md / src/app.ts 出现探针行（贮藏已应用），`git stash list` 仍 **6** 条 → 「贮藏保留，不弹出」成立（该探针贮藏随后被「转分支」那一格的复拍消费，见下行）。**前置构造**：为拿到「干净应用」的成功态，先在 `master` 上造探针贮藏 `f-ui-unstash-as-probe`（父 = `ed81a0a` = master tip，2 文件）。**冲突口径**：首轮用旧贮藏（`On rebase-topic: smoke stash from status page（R3）`）应用到 `f-ui-branch-probe` 时命中 `src/util.ts` 冲突 → toast「应用贮藏存在冲突（1 个文件：src/util.ts），请到冲突页解决后完成」+ HTTP 409（`/stashes/unstash-as:0`），贮藏保留、无副作用，属正常保护而非缺陷。**下拉实测**：`unstash-as-branch` 是虚拟滚动列表，DOM 常驻仅前 11 项，`master` 需滚动下拉才可点到（输入不触发过滤，未开 showSearch） |
| 贮藏差异（查看型对话卡） | 查看（Modal） | `/stashes` 行内「查看差异」 | `stash-10b.png`（Modal「贮藏差异：stash@{0}」= 探针贮藏的 2 文件 unified diff 全文，含 `+unstash-as 取证探针：应用后可观察到该行…`；DOM 实测本卡**无任何按钮**、内容 360px 一屏内不滚动） | `stash-10.png`（同一卡片的更丰富数据形态：「贮藏差异：stash@{1}」4 文件 diff（`.gitignore` / `src/app.ts` / `src/staged-new.ts` / `src/util.ts`），内容高 700 > 视口 480 → 已滚到底） | 查看型卡片无提交动作，配对口径取「本卡 + 同一卡的另一种数据形态（多文件 + 新增文件）」；文件清单按 `^diff --git a/… b/…` 逐条解析，与 `git stash show --name-only stash@{1}` 一致。**收尾**：应用过的改动已 `git checkout --` 丢弃、HEAD 回到 `f-ui-branch-probe`（`b6f3180`，工作区干净）；本轮残余探针 = 分支 `f-ui-stash-to-branch` 与 `f-ui-stash-to-branch2`（后者即「转分支」那一格的产物）、贮藏 5 条（`f-ui-unstash-as-probe` 已在本格的下一次「转分支」取证中被消费为新分支） |
| hunk 级「放弃选中」（状态页） | 二次确认（Popconfirm） | 状态页工作区文件行 → 展开补丁预览 → 勾选 hunk →「放弃选中」 | `status-page-20b.png`（Popconfirm「放弃选中 hunk 的修改？不可恢复」，面板显示「已选 1 / 1 个 hunk」） | `status-page-20.png`（工作区 **1→0**、该组转「无变更」） | CLI：确认前 `git diff README.md` = `+1` 行（`+hunk-discard 取证探针：该行将被 hunk 级「放弃选中」丢弃`）、确认后 `git status` 全净且该行不存在。**交互坑**：该按钮的 Popconfirm 需**真实坐标点击**（`page.mouse` / 手写 `mousedown+mouseup`）——`locator.click({ force: true })` 不触发 antd Popconfirm，会误判为「点了没反应」 |
| 撤销最近提交（日志页顶栏） | 二次确认（Popconfirm） | 日志页顶栏「撤销最近提交」（`aria-label`） | `reset-05b.png`（Popconfirm「将撤销最近提交并保留改动到暂存区」） | `reset-05.png`（toast「已撤销最近提交」+ 首行由「F-130 子模块夹具（ok-sub / drift-sub）」变为「F-096 本地提交」，`f-ui-branch-probe` chip 随之落到父提交） | CLI：确认前 `git log -1` = `b6f3180`、确认后 = `4db0f92` 且 `git status` = `M  README.md`（改动回暂存区，等价 `reset --soft HEAD~1`）；取证后已 `git reset --hard b6f3180` 复位。**重拍说明**：首拍在列表刷新前落帧（画面仍是旧首行），故改为轮询「首行变 `F-096 本地提交`」后再取帧 |
| 中止当前操作（日志页操作条） | 二次确认（Popconfirm） | 冲突仓日志页操作条「中 止」（`OperationStatus`） | `conflicts-09b.png`（Popconfirm「确定中止当前操作？工作区将回到操作前状态」；背景为「合并中 / 中 止 / 去解决冲突」操作条） | `conflicts-09.png`（操作条整体消失，顶栏回到「首页 rebased-smoke-conflict master 标签」） | CLI：确认前 `MERGE_HEAD` = `5271e87…`、`status` 含 4 项冲突（AA `both-added.txt` / UD `deleted-by-them.txt` / UU `manual-merge.txt` / UU `shared.txt`）；确认后 `git rev-parse -q --verify MERGE_HEAD` 退出码 1（不存在）、`status` 全净、HEAD 仍 `f5fdef8`（未产生提交）。**该动作不弹 toast** |
| 定制 Fetch（refspec）（远程页） | 表单（Modal） | `/remotes`「定制 Fetch…」 | `remote-08b.png`（Modal「定制 Fetch（refspec）」：远程下拉已选 `origin`、`fetch-spec-refspec` = `+refs/heads/f-ui-branch-probe:refs/remotes/origin/f-ui-fetch-probe`） | `remote-08.png`（toast「fetch 完成，更新 1 个引用」） | CLI：确认后 `git for-each-ref refs/remotes/origin/f-ui-fetch-probe` = `56d0e23`（＝远端 `f-ui-branch-probe` 的 tip），即 refspec 指定引用被单独拉入；收尾已 `git update-ref -d` 删除探针引用。**下拉实测**：`fetch-spec-remote` 仅一个选项 `origin`，仍需坐标点选后才能提交 |
| 初始化仓库（首页） | 表单（Modal） | 首页「初始化」 | `repo-page-14b.png`（Modal「初始化仓库」，`init-path` = `D:\zhanglei1120\Github\rebased-smoke-init-ui`；占位符「仓库目录（不存在时创建）」） | `repo-page-14.png`（跳 `/repos/534c841e-39bf-4933-acf8-70844a96440b`，页面「暂无提交 / 该仓库还没有任何提交…」） | CLI：该目录成为 git 工作树（`rev-parse --is-inside-work-tree` = `true`、`git status` = 「On branch master」且无提交、目录内仅 `.git`）。**收尾**：首页「移除」（Popconfirm「移除该仓库？」）使列表 12→11，并删除目录；探针仓与 id `534c841e-…` 均已清理 |
| 保存搁置（搁置页） | 表单（Modal） | `/shelves`「保 存」 | `shelf-05b.png`（Modal「保存搁置」，`shelf-save-name` = `f-ui-shelf-save-probe`；占位符「搁置名（必填）」） | `shelf-05.png`（搁置列表 **2→3**，新条目「f-ui-shelf-save-probe \| 1 个未跟踪」置顶） | CLI：`~/.rebasedjs/shelves/<repoId>/f-ui-shelf-save-probe/` 生成 `patch.diff` + `untracked/f-ui-shelf-save-probe.txt`。**语义观察（不同于 JetBrains）**：保存搁置**不移出工作区**——确认后 `git status` 仍为 `?? f-ui-shelf-save-probe.txt`（相当于复制入档）。**该动作不弹 toast**；收尾已删除该探针搁置目录并清掉工作区探针文件 |
| 搁置变更（状态页页头） | 表单（Modal） | `/status` 页头「搁 置」 | `shelf-06b.png`（Modal「搁置变更」，`page-action-shelf-input` = `f-ui-shelve-from-status`） | `shelf-06.png`（toast「已搁置：f-ui-shelve-from-status」+ 自动跳 `/shelves`，列表 **3→4**） | CLI：同名搁置目录生成 `patch.diff` + `untracked/…`。**收尾**：删除两个探针搁置后列表回到 2（`f120-worktree` / `smoke-shelf-r3`） |
| 受影响文件（溯源页查看型卡） | 查看（Modal）+ 联动 | `/blame` 右栏操作条「受影响」（**选中提交级**，F-103） | `blame-05b.png`（**本轮已重拍**：旧 `?file=&rev=` 深链规范化后的落点在「逐行注解」标签——左边文件树 / 中栏提交清单 / 右栏注解行表，页面上没有对话框） | `blame-05.png`（**本轮已重拍**：陈旧 `?select=` 未知态——操作条只剩三个出口（**无「差异页」**，不猜根提交）、「本文件改动」给服务端中文错误「引用不存在或不是提交：deadbeef…」） | **配对口径已失效**：本轮两张同名图换成了三栏态的非对话框画面。受影响文件 Modal 的**卡本体证据**现由 F-103 的 `blame-03.png` 承载（**根提交态**：选中 `13a68f62…` 时打开，标题「受影响文件（13a68f6）」+ 52 个 `A` 行）；入口也从旧版「注解行内按钮」升格为右栏操作条的选中提交级出口，组件搬到 `affected-files-modal.tsx`（行为与文案逐字不变） |

**② 待补矩阵（按页面分组；每项都需要「表单 + 成功」两张）**

| 分组 | 表面清单 | 备注 |
|------|----------|------|
| 分支页 `branch` | —— | 新建 / 删除 / 重命名 / 设上游 / 清理已合并 / 检出并变基到当前 / 与工作树差异 **七组全部成对** |
| 远程页 `remote` | —— | 添加 / 编辑 / 删除 / Fetch / **定制 Fetch（refspec）** 五组均已成对 |
| 标签页 `tag` | —— | 新建 / 推送 / 删除 / 删除远程 / 推送全部 **五组全部成对** |
| 补丁页 `patch` | —— | 创建 / 应用 / 删除 / 重名提示 四组均已成对 |
| 搁置页 `shelf` | —— | 保存（`shelf-05b/05`）、搁置变更（状态页页头，`shelf-06b/06`）、恢复（`shelf-02b/02`）、删除（`shelf-04b/04`）四组全部成对 |
| 贮藏页 `stash` | —— | 存入贮藏（`status-page-18b/18`）、转分支（`stash-08b/08`）、Unstash As…（`stash-09b/09`）、查看差异（`stash-10b/10`）、弹出（`stash-06b/06`）、删除（`stash-07b/07`）六组全部成对；「应用」无二次确认（直接执行），既有单图见 F-082 |
| 工作树页 `worktree` | —— | 创建 / 移除（含强制）/ 清理 三组均已成对 |
| 子模块页 `submodule` | —— | 行内更新与递归全量已成对（`submodule-02b`/`submodule-02`） |
| 忽略对话框 `ignore` | —— | 编辑器保存（`ignore-01`/`ignore-03`）与状态页一键忽略（`ignore-02b`/`ignore-02`）均已成对 |
| 设置页 `settings` | —— | 添加账户、删除账户、GPG 配置保存 三组均已成对（见 ①） |
| 仓库页 `repo-page` | —— | 打开（页内输入）、克隆（Modal）、**初始化（Modal）**、移除（Popconfirm）四组均已成对 |
| 认证对话框 `auth-dialog` | —— | 已完成（`auth-dialog-01b`/`01`）；取证走「本地 Basic 鉴权 + dumb HTTP」基建，见 ① |
| 日志页 `log-page` | —— | 九个菜单动作（新建分支 / 新建标签 / Reword / Drop / 检出此提交 / Fixup / Squash / Push up to Commit / 变更集查看）+ 顶栏「撤销最近提交」（`reset-05b/05`）**全部成对** |
| 状态页其余 Modal | —— | 「存入贮藏」（`status-page-18b/18`）、「amend 到指定历史提交」（`status-page-19b/19`）、hunk 级「放弃选中」（`status-page-20b/20`）均已成对；页头「搁置变更」见搁置页一行（`shelf-06b/06`） |
| 重置 `reset` | —— | 重置对话框的确定前表单与成功态均已成对（`reset-04b`/`04`）；顶栏「撤销最近提交」Popconfirm 见 `reset-05b/05` |
| 冲突页 `conflicts` | —— | 删除该文件（`conflicts-07b/07`）、手动合并（`conflicts-08b/08`）、完成合并（`conflicts-04/04b`）、跳过（`conflicts-05b/05`）、**中止当前操作**（`conflicts-09b/09`）五组均已成对 |
| 合并视图 `merge-view` | —— | 手动合并已在冲突页一组中成对（`conflicts-08b/08`）；`conflicts-03` 保留为 F-116 的编辑态证据 |
| GitHub / GitLab 面板 `github` `gitlab` | 合并 PR/MR Modal、新建 MR Modal、Approve / Request changes Popconfirm | ⏭ **环境阻塞（2026-09-13 复核）**：按 F-134/F-140 口径在 `rebased-smoke-big` 临时加 `https://github.com/example/rebased-smoke.git` 与 `https://gitlab.com/example/rebased-smoke.git` 远程后打开两个面板，DOM 实测**只渲染降级卡**（`github-auth-failed` / `gitlab-auth-failed` +「未配置 … 令牌，请在设置中添加」+「去设置」），无 PR/MR 列表、无建单/合并/Approve 任何入口（`buttons` 仅 返回日志 / 设置 / 去设置）→ **表单态在本环境亦不可达**（不存在「用假远程取表单态」的路径），成功态更需真实托管仓库 + 有效 PAT；降级卡本身的既有证据见 F-135（`github-02.png`）与 F-140（`gitlab-01.png`）。探针远程已移除（`git remote -v` 为空） |
| 控制台 `console` / 搜索 `search` / 溯源 `blame` | —— | 三页均无表单/二次确认（只读检索页）；`blame` 的「受影响文件」为查看型 Modal（右栏操作条「受影响」打开，已按「卡本体 + 点文件联动」配对——卡本体见 F-103 的 `blame-03.png`，弹窗组件落图见 §5.27 ①），三栏工作台整体落图见 §5.27 ③ 与 §5.34 |

**③ 新 UI 组件落图清单（随批次补齐）**

| 组件 | 已落图的证据 |
|------|--------------|
| `toolbar` / `page-shell` | 各页面通栏（如 `log-page-01.png`、`status-page-01.png`） |
| `commit-graph` / `graph-canvas` | `log-graph-01…05.png` |
| `empty-state` | `theme-light-browse.png`（「在左侧选择文件查看内容」）等空态 |
| `ellipsis-text` | `submodule-01.png`（远端 URL 省略号） |
| `operation-status` | `conflicts-06.png`（「合并中」操作条 + 中止） |
| `repo-status-bar` | `repo-page-*`（ahead/behind 徽标） |
| `split-pane` | `log-page-14/15.png`（?select= 两栏）、`browse-01.png` |
| `virtual-list` | `log-page-*`（长列表）、`console-01.png`（100 行） |
| `file-tree` | `browse-01.png`、`theme-light-browse.png` |
| `monaco-diff-view` / `monaco-text-view` / `monaco-lazy` | `diff-page-*`、`browse-02.png`、`conflicts-03.png` |
| `hunk-diff-view` | `diff-page-*`（hunk 级暂存按钮区） |
| `commit-details-panel` | `log-page-14/15.png`（提交详情面板） |
| `committed-status` | `log-page-*` 状态条 / `status-page-*` |
| `app-theme` / `density-context` | 明暗两套图（§5.18①）与密度矩阵（§5.26⑤） |
| `diff-viewer` | `diff-page-04.png` 等标准 Monaco diff 视图帧；工具行为 `diff-context`（「上下文 5 行」）/ `diff-folding` / `diff-whitespace`（「空白不显示」），2026-09-13 在 `/diff?file=README.md&from=…&to=…` 实测三者 `present=true`、可见、位于页顶 `y≈38`（故必然落在各 diff-page 帧内） |
| `diff-stream-view` | `diff-page-07.png`（大仓 `big.txt` 的分块流渲染，F-035 实测 2 个 `diff.chunk` 帧渐进累积后切标准视图）；其 `diff-stream-error` 分支由单测覆盖 |
| `three-way-view` / `merge-view` | `conflicts-03.png`（全屏三栏：当前分支 / 合并来源 / 合并结果）、`conflicts-08b.png`（保存前结果栏已改写为 `line1 master` / `line2 feature` / `line3 resolved-by-hand`） |
| `branch-compare-view` | `diff-page-10.png`（`?compare=diverge-test` 双 range 对比视图）、`branch-06.png`（分支页「比较」入口与「当前」分支禁用态） |
| `blame-workbench`（三栏工作台；原单列 `blame-view` 已随页面重构删除） | `blame-01…06.png`（三栏总览暗色 / 「与最新版本差异」/ 受影响文件 Modal / 逐行注解点行联动 / 陈旧 `?select=` 未知态 / 明亮主题总览）；testid 实测在盘——根 `blame-pane`、操作条 `blame-pane-actions` + `blame-action-log`/`-diff`/`-affected`/`-history`、三标签页 `blame-view-changes`/`-latest`/`-annotate`、中栏 `blame-commits` + `blame-commit-N`、注解行 `blame-line-N` + `blame-hash-N`、提示行 `blame-changes-root-hint`/`-rename-hint`/`-missing-hint` 与 `blame-latest-missing-hint`。**旧 testid `blame-file` 已随旧组件消失**（路径输入框现为 `blame-file-input`） |
| `committed-changes-panel` | `committed-01…03.png`（提交列表分页 50→100 / 目录树 / 与 diff 页联动）；根 testid `committed-entry-N` / `committed-load-more` 实测在盘 |
| 其余复合页面组件 | `BranchPanel` / `StashPanel` / `TagPanel` / `RemotePanel` / `PatchPanel` / `ShelfPanel` / `WorktreePanel` / `SubmodulePanel` / `ConflictsPanel` / `HistoryPanel` / `SearchPanel` / `ConsolePanel` / `GitHubPanel` / `GitLabPanel` 与 `Reset` / `Merge` / `Rebase` / `Push` / `Pull` / `UpdateProject` / `Ignore` / `Auth` 各对话框属「页面级」组件，落图见 §5.27 ①（成对）与 §4 各页矩阵，不在此表重复（原 `BrowsePanel` 已随整页形态删除） |

### 5.28 折叠 / 分支过滤 / 最近仓库项 冒烟（Task 8，2026-09-13）

> **触发**：特性分支 `feat/log-collapse-recent-branch` 的 T1–T7 产物首次在真实服务里逐项走查——首页最近仓库项的「分支后缀 / 首字母头像 / 失效标记」、日志页「线性折叠」、日志页「分支过滤」。
> **夹具**：先跑 `scripts/smoke-setup.ps1` 复位（脚本头部注释已核：只重建 `D:\zhanglei1120\Github` 下的 `rebased-smoke*` / `smoke-*` 目录；退出码 0，汇总 `main 8 commits / big 320 commits / shallow file: True`）。
> **服务**：`pnpm dev` 后台作业起 web-next `:3081` + web-koa `:3082`；两者均可达（`GET http://localhost:3081/` → 200、`GET http://localhost:3082/api/repos` → 200）。
> **口径**：本轮**只读验证**（未改 `packages/**`、`apps/**` 任何源码）；按 `Ruling F1`，分支过滤后看不到虚线过滤边是**预期行为**，不计缺陷；折叠产生的虚线边是另一回事（本轮取证必须出现，已出现）。
> **视口**：块 1 的四张（`repo-page-15/16/17b/17.png`）为会话初始视口 **769×781**（`repo-page-16.png` 实测 770×782，差 1px）；其余九张在 `browser_resize(1440×900)` 之后拍摄，均为 **1440×900**。

**① 范围清单（逐项）**

*块 1：首页最近仓库列表项*

| # | 范围项 | 结论 | 判据（浏览器 DOM / 画面） | 互证（CLI / API） |
|---|--------|------|---------------------------|-------------------|
| 1.1 | 显示名 = `名称` + **两个空格** + `[分支]` | ✅ | 11 行中 9 行带后缀，逐行 `textContent` 全部命中 `/^\S.*\S {2}\[[^\]]+\]$/`（例：`rebased-smoke  [master]`、`rebased-smoke-wt  [wt-branch]`）；两行失效项（init / clone）无后缀 | CLI 逐仓 `git -C <path> rev-parse --abbrev-ref HEAD`：smoke/big/conflict/shallow-r6/shallow/huge = `master`，wt = `wt-branch`，**8/8 与页面后缀一致**。`rebased-smoke-noident` 是 **unborn HEAD**（`rev-list --count --all` = 0），`rev-parse` 打印 `HEAD` 并报 `ambiguous argument`，页面取 `.git/HEAD` 文本得 `[master]`——等价 CLI 为 `git symbolic-ref --short HEAD` → `master` ✅ |
| 1.2 | 首字母渐变头像（色号由服务端 `colorIndex` 下发、**明暗两套**） | ✅ | 逐行读 `[data-testid="repo-avatar"]`：首字母 = 名称前两词大写（`rebased-smoke-conflict` → `RC`、`rebased-smoke-wt` → `RW`）；底色 `background-image: linear-gradient(135deg, …)` | `GET /api/repos` 的 `colorIndex` 与底色**一一对应**：conflict=6 与 huge=6 同渐变 `rgb(143,69,147)→rgb(181,114,227)`、smoke=7 与 wt=7 同渐变 `rgb(200,64,185)→rgb(224,116,174)`；切「明亮」后同一 colorIndex 换另一支（smoke 变 `rgb(214,60,200)→rgb(245,130,185)`、big 由 `rgb(226,114,55)→rgb(232,168,62)` 变 `rgb(245,114,54)→rgb(252,186,63)`）⇒ 明暗两支取色成立 |
| 1.3 | 失效项标记：降不透明度 + 警示图标 + tooltip 带 `(unavailable)` | ✅ | 把 `rebased-smoke-conflict` 目录改名后刷新：行 `opacity: 0.6`、头像转灰（`rgb(108,108,108)→rgb(170,170,170)`、`opacity 0.6`）、`[data-testid="repo-invalid"]`（`anticon anticon-warning`）出现；悬停该图标读出气泡 `D:\zhanglei1120\Github\rebased-smoke-conflict (unavailable)：该目录已不存在，可能已被移动或删除` | 改名瞬间 `GET /api/repos` 该条即变 `{"branch":null,"valid":false}`（派生字段现算，不落盘） |
| 1.4 | 点失效项**只弹确认框不打开**（按钮「关闭」「从最近列表移除」） | ✅ | 点行后 URL 仍是 `http://localhost:3081/`（未跳 `/repos/:id`，`pathname === '/'`）；Modal 标题「仓库路径不可用」、正文 `…rebased-smoke-conflict (unavailable)` + 「该目录已不存在，可能已被移动或删除。」、footer 两枚按钮 `repo-invalid-remove`（从最近列表移除）/ `repo-invalid-close`（关 闭） | `GET /api/repos` 侧该仓仍 `valid:false`（未被误开）；点「关 闭」后 `.ant-modal-wrap` `display:none`、列表行数仍 11 |
| 1.5 | 「从最近列表移除」只移列表、**不删盘** | ✅ | 对 `rebased-smoke-huge`（620 提交，非 `smoke-setup.ps1` 标准夹具）同法改名 → 点行 → 点「从最近列表移除」：该行消失（列表 11 → 10 行，`/api/repos` 11 → 10 条），Modal 自动关闭 | **在被改名的路径上**跑 `git log --oneline -1` = `fc74f21 chore: bulk commit 619`、`rev-list --count HEAD` = **620**（目录与历史毫发无损）⇒ 只动列表条目 |
| 1.6 | 复位目录名后 `valid` 回到 `true` | ✅ | 两处临时改名均已改回原名（conflict、huge） | `GET /api/repos` → conflict `{"branch":"master","valid":true}`；`git -C … log --oneline -1` = `99b4bfe feat(master): 同区域改动…`；huge 复原后 620 提交仍在 |

*块 2：日志页线性折叠（仓库 `rebased-smoke`，HEAD=master 8 提交）*

| # | 范围项 | 结论 | 判据（浏览器 DOM / 画面） | 互证（CLI） |
|---|--------|------|---------------------------|-------------|
| 2.1 | 图列圆点有可点中的命中带 | ✅ | `polyline[data-testid="graph-edge-hit-4-5"]`：`stroke-width=6`、`stroke=transparent`、`pointer-events: stroke`，`getBoundingClientRect()` = `{x:19,y:191,w:0,h:12}`（竖直段，宽 0 高 12；该次实测在 769×781 视口，`browser_resize(1440×900)` 后同一命中带的 y 变为 161.1/173.1，语义不变）；圆点 `circle[data-testid="graph-node-b3912c6…"]` 中心 `(19,191)`、`r=4`、`fill=#81a663`。`document.elementFromPoint(19,191)` 命中的正是命中带（它在可视线之上） | — |
| 2.2 | 点**提交圆点** → 该线性链折成一条虚线 | ✅ | 点第 5 行（`b3912c6`）圆点后：行数 **8 → 6**，中间两行（`7dd307e`「chore: 新增忽略规则…」、`60911dc`「feat(core): 新增应用入口…」）消失；出现 **2 条** `stroke-dasharray="4 3"` 的虚线切片（跨行边界的两半），命中带变为 `graph-edge-hit-4-5`（`9,108 9,120` / `9,120 9,132`）——被折叠区间即 `b3912c6 → a0d8689` | 被折叠的两个提交**仍在仓库**：`git log --all --oneline` 含 `7dd307e` / `60911dc`，`git cat-file -t 7dd307e…` = `commit`、`60911dc…` = `commit`；`rev-list --count HEAD` 仍 **8**（折叠只是视图态） |
| 2.3 | 点那条**虚线** → 展开 | ✅ | 在虚线的真实坐标 `(19,179)` 用 `page.mouse.click` 点（透明命中带盖在虚线上，`elementFromPoint` 命中的是 `polyline#graph-edge-hit-4-5`）：行数 **6 → 8**，虚线切片 **2 → 0**，被隐藏的两个提交原样回到列表 | 同 2.2 的 `rev-list --count HEAD` = 8（展开前后仓库侧无任何变化） |
| 2.4 | 过滤行的「折叠线性分支」「展开线性分支」两个按钮 | ✅ | 折叠前 `log-expand-all` 为 `disabled`；点 `log-collapse-all` → 行数 **8 → 6** + 虚线 2 条、展开按钮转**可用**（`disabled=false`）；再点 `log-expand-all` → 行数 **8**、虚线 0、展开按钮回到 `disabled`。选中态（`1b9a811`）与右侧详情面板在折叠/展开前后均不变 | 折叠结果与 2.2 同一区间（本仓 ≥3 行的线性链只有 1 条：`b3912c6 → a0d8689`，`git log --oneline b3912c6` 给出 4 行） |
| 2.5 | 悬停圆点 → **整条链**圆点出现高亮环 | ✅ | 悬停 `7dd307e` 圆点后 `[data-testid^="graph-node-ring-"]` 恰 **4 个** = `b3912c6 / 7dd307e / 60911dc / a0d8689`，环 `r=6`、`stroke=#1668dc`（主题主色）；行数仍 8、无任何行被选中 | 该 4 个 hash 与 `git log --oneline b3912c6` 的 4 行**逐条相同**（即线性祖先链，跨过 feature 分叉点即停） |
| 2.6 | 点圆点**不改变选中的提交**；点行正文仍选中 | ✅ | 先点首行正文 → 选中 `9b97654`、URL 变 `?select=9b97654…`、右侧详情面板出现（`9b97654 / Smoke Tester / fix(core): 合并后修正启动横幅 / 父提交：fa9452a`）；再点第 4 行（`5368ee6`，2 行链**不可折叠**）的圆点 → 选中行仍只有 1 个且仍是 `9b97654`、详情面板与 URL 不变、行数仍 8、虚线 0；随后点第 3 行正文 → 选中与详情面板同步变为 `1b9a811`（父提交 `5368ee6`） | 详情面板的父提交与 `git log -1` 事实一致（`9b97654` 的父是 merge `fa9452a`、`1b9a811` 的父是 `5368ee6`） |

*块 3：日志页分支过滤*

| # | 范围项 | 结论 | 判据（浏览器 DOM / 画面） | 互证（CLI / API / 网络） |
|---|--------|------|---------------------------|--------------------------|
| 3.1 | 「分支过滤」弹窗：本地/远程分组 + ✔ 前缀 + 清空 | ✅ | 弹窗文本 = `本地分支 | diverge-test | ✔ feature | master | merged-branch | wt-branch | 远程分支 | origin/feature | origin/master | 清空`；组标题实际渲染为「本地分支」「远程分支」两段；未选中时无 ✔，选中 `feature` 后该行前缀变 `✔ feature`；`[data-testid="log-branch-clear"]` = 「清空」 | `git -C rebased-smoke branch -a` 的 7 个分支名与弹窗选项**逐条一致**（本地 5 + 远程 2，远程按含 `/` 归组） |
| 3.2 | 选中分支后图只剩该分支可达的提交 | ✅ | 选 `feature` 后行数 **8 → 6**，逐行 hash = `1b9a811 / 5368ee6 / b3912c6 / 7dd307e / 60911dc / a0d8689`；按钮变「分支过滤（1）」 | `git log --oneline feature` 恰好同 6 条（同序）；而**数据侧**更多：`GET /api/repos/:id/log?all=true` 返回 **12** 条 = `git log --all --oneline` 的 12 行（含 `diverge-test` 独有提交 `1bfd86f` 与 3 条 stash 相关提交 `a4af560`/`a738306`/`d8e83d0`）⇒ 过滤是**从已加载数据里隐藏**，不是换查询 |
| 3.3 | 两个折叠按钮**整组消失**（不是禁用） | ✅ | `document.querySelector('[data-testid="log-collapse-all"]')` = `null`、`log-expand-all` = `null`（**不存在**，非 `disabled`）；同时图内折叠态被清空（行序回到默认、虚线 0） | 对齐 Java `VisibleGraphImpl.isActionSupported`（过滤态 `setVisible(false)`），见 `log-page.tsx:711-737` 注释 |
| 3.4 | 出现「部分分支的提交尚未加载，将继续加载」提示（**当还有更早提交时**） | ✅ | `rebased-smoke-big`（320 提交、`hasMore=true`）选 `master` 后 `[data-testid="log-branch-filter-hint"]` 出现，文本 = 「部分分支的提交尚未加载，将继续加载」，同时「加载更多」按钮在盘；`rebased-smoke`（12 提交、`hasMore=false`）下该提示**不出现** —— 与「当还有更早提交时」的条件口径一致 | 提示的判据是 `hasMore`（API `hasMore` 字段），选取两端 `hasMore` 相反的两个仓做正反例 |
| 3.5 | 点「清空」→ 回到默认视图且折叠按钮回来 | ✅ | 点「清空」后：按钮文本回到「分支过滤」（无计数）、`log-collapse-all` / `log-expand-all` **均重新出现**（展开按钮 `disabled`，因为无折叠）、提示消失、行数回到 **8** 行 = `9b97654 / fa9452a / 1b9a811 / 5368ee6 / b3912c6 / 7dd307e / 60911dc / a0d8689`（默认 HEAD 视图） | 该 8 行 = `git log --oneline HEAD`；查询退回不带 `all` 的默认口径 |
| 3.6 | 网络面板可见 `GET /api/repos/:id/log?...&all=true` | ✅ | Playwright 网络面板：`/api/repos/2035965b…/log?limit=50&skip=0&all=true` → **200**（rebased-smoke，条目 #78）；`/api/repos/7649bb35…/log?limit=50&skip=0&all=true` → **200**（rebased-smoke-big，条目 #79）；未过滤时同端点为不带 `all` 的 `?limit=50&skip=0` | 与 `packages/client/client` 的 `useLogPages({all:true})` 进 SWR key 的口径一致（T4 产物） |
| 3.7 | **Ruling F1 复核**：分支过滤下没有虚线过滤边是预期 | ✅（符合裁定） | 过滤 `feature` 态下 `document.querySelectorAll('svg [stroke-dasharray]').length` = **0**，图是连通的（6 行正常实线） | 可见集沿父边可达、对祖先封闭 ⇒ `DottedFilterEdgesGenerator` 恒无输出；与 Java `BranchFilterController` 不调该生成器一致。**按裁定不作为缺陷** |

**② 操作路径（点击 / 输入序列）**

1. 复位夹具：`& scripts/smoke-setup.ps1`（本机无 `pwsh`，用 Windows PowerShell 5.1）→ 起服务 `pnpm dev`（后台作业）→ 探针确认 MCP 落盘根（写项目内绝对路径被拒，报 `Allowed roots: D:\zhanglei1120\Github\deepseek-harness\.playwright-mcp, D:\zhanglei1120\Github\deepseek-harness`）→ 之后一律 `filename=.playwright-mcp/shots/<名>.png` 落盘、再用 `Copy-Item` 搬进 `docs/shots/`。
2. **块 1**：`browser_navigate http://localhost:3081/` → `browser_evaluate` 逐行读 `[data-testid="repo-item"]`（名称文本 / 头像底色 / 行 opacity / 警示图标）→ 截图 `repo-page-15.png` → `Rename-Item rebased-smoke-conflict rebased-smoke-conflict-tmp` → 刷新首页 → 读失效行 → `browser_hover` 警示图标读气泡 → 截图 `repo-page-16.png` → `browser_click` 该行 → 读 Modal（标题/正文/按钮 testid）+ 确认 URL 未变 → 截图 `repo-page-17b.png` → `browser_click [data-testid="repo-invalid-close"]` → 复核 Modal 已关、行数不变 → `Rename-Item … rebased-smoke-conflict` 复原 → `GET /api/repos` 复核 `valid:true`。
3. **块 1（移除分支 + 主题）**：`Rename-Item rebased-smoke-huge rebased-smoke-huge-tmp` → 刷新 → 点该失效行 → 点「从最近列表移除」→ 复核行消失（11→10）+ 截图 `repo-page-17.png` → CLI 在被改名目录上跑 `git log/rev-list` 证明盘上无损 → 改名复原 → 进 `/settings` 点「界面主题 → 明亮」→ 回首页读全部头像底色 + 截图 `theme-light-repo-page.png` → 回 `/settings` 点「暗色」复位（复核 `data-theme=dark`）。
4. **块 2**：首页点 `rebased-smoke` 行（真实入口，URL 变 `/repos/2035965b…`）→ 等首行提交出现 → 读 8 行 hash/圆点几何与命中带（`browser_evaluate` 取 `getBoundingClientRect()`）→ 截图 `log-collapse-01b.png` → 点第 5 行圆点（`circle[data-testid="graph-node-b3912c6…"]`）→ 复核 6 行 + 2 条虚线 → 鼠标移到 `(1400,860)` 等 700ms 消掉悬停环 → 截图 `log-collapse-01.png` → `page.mouse.click(19,179)` 点虚线真实坐标 → 复核 8 行 0 虚线 → 截图 `log-collapse-01b.png`（重拍，1440×900）→ `browser_hover` 第 6 行圆点 → 复核 4 个高亮环 → 截图 `log-collapse-02.png` → 点首行正文选中 → 点第 4 行圆点（不可折叠链）→ 复核选中未变 → 点第 3 行正文 → 复核选中已变 → 点「折叠线性分支」→ 复核 8→6 + 展开按钮转可用 → 点「展开线性分支」→ 复核回到 8 行 + 按钮回 disabled。
5. **块 2（大仓 + 块 3 提示）**：首页点 `rebased-smoke-big` 行 → 点「折叠线性分支」→ 复核首行后跳到 `bulk commit 270`（= git log 序第 49 行）+ 顶部 2 条虚线 → 截图 `log-collapse-03.png` → 点「分支过滤」→ 弹窗只有「本地分支 / master / 清空」→ 鼠标移开消 tooltip 后点 `master` → 复核提示出现、折叠按钮消失 → 截图 `log-branch-filter-03.png`。
6. **块 3（主仓）**：回首页点 `rebased-smoke` → 点「分支过滤」→ 复核分组与选项 → 鼠标移到 `(1400,860)` 消 tooltip → 点 `feature` → 复核 6 行 + 折叠按钮消失 → 截图 `log-branch-filter-01.png` → 再开弹窗（复核 `✔ feature`）→ 截图 `log-branch-filter-01b.png` → 点「清空」→ 复核 8 行 + 按钮回来 → 悬停「分支过滤」按钮（带 tooltip 以与 `log-collapse-01b.png` 区分画面）→ 截图 `log-branch-filter-02.png`。

> 操作坑（与 §1.2 既有口径一致）：`分支过滤` 按钮的 Tooltip 会**盖住弹窗第一项**（Playwright 报 `… intercepts pointer events`）——先把指针移到 `(1400,860)` 等 ~900ms 令气泡消失再点菜单项；`stroke="transparent"` 的命中带 `boundingRect.width = 0`，`locator.click()` 判为 not visible，故虚线段一律用 `page.mouse.click(<真实坐标>)` 点击（与 §5.27「hunk 级放弃选中」同款处置）。

**③ 证据（浏览器状态 + CLI 输出互证）**

- **块 1 CLI 互证原文**：`rebased-smoke → master`、`rebased-smoke-big → master`、`rebased-smoke-conflict → master`、`rebased-smoke-shallow(-r6) → master`、`rebased-smoke-wt → wt-branch`（页面后缀逐条相同）；`rebased-smoke-noident`：`.git/HEAD` = `ref: refs/heads/master`、`symbolic-ref --short HEAD` = `master`、`rev-list --count --all` = `0`（unborn HEAD，页面显示 `[master]` 属正确而非陈旧）。
- **块 1 失效链路原文**：改名后 `GET /api/repos` → `{"path":"D:\\zhanglei1120\\Github\\rebased-smoke-conflict","colorIndex":6,"branch":null,"valid":false}`；复原后 → `{"branch":"master","valid":true}`；`rebased-smoke-huge` 移除前后在被改名目录上 `git log --oneline -1` = `fc74f21 chore: bulk commit 619`、`rev-list --count HEAD` = `620`。
- **块 2 CLI 互证原文**：`git log --all --oneline` 含 `b3912c6 refactor(docs): 重命名文档为 new-name` / `7dd307e chore: 新增忽略规则、二进制资源与本地子模块` / `60911dc feat(core): 新增应用入口与工具函数` / `a0d8689 chore: 初始化仓库与 README`；`cat-file -t` 两者均为 `commit`；`rev-list --count HEAD` = **8**（折叠前后一致）⇒ **被折叠的提交仍在仓库里，折叠只是视图态**。
- **块 2 大仓互证原文**：页面折叠后第二行是 `chore: bulk commit 270`（`4342450`），`git log --oneline` 中它是**第 49 行**（`3957cf9` 重写 → `c001f3b` 318 → … → `a669fda` 271 → `4342450` 270）⇒ 中间 `1..48` 共 **48 个提交被隐藏**；`git log --all --oneline` 总行数 **320**（一条不少）。
- **块 3 互证原文**：`git log --oneline feature` = `1b9a811 / 5368ee6 / b3912c6 / 7dd307e / 60911dc / a0d8689`（6 条，与页面 6 行同序）；`GET /api/repos/2035965b…/log?limit=50&skip=0&all=true` = **12 条**（`a4af560`/`d8e83d0`/`a738306` 三条 stash 相关 + `9b97654` + `1bfd86f` diverge-test + …），与 `git log --all --oneline` 的 12 行逐条一致 ⇒ 选中 `feature` 时页面**隐藏了数据里确实存在的另外 6 条**。
- **控制台**：整轮（首页 → 日志页 → 设置页）`browser_console_messages` 仅 1 条 error：`GET /favicon.ico 404`——既有噪声（本轮未新增任何 console 报错），不登记缺陷。

**④ 截图账目（13 张，均落 `docs/shots/`，SHA256 全目录无重复组）**

| 截图 | 内容（最终正确效果） | SHA256（前 16 位） |
|------|----------------------|--------------------|
| `repo-page-15.png` | 首页默认列表（769×781）：9 行「名称 + 两个空格 + `[分支]`」+ 首字母渐变头像；init/clone 两行失效态同框 | `4675A54574C44E54` |
| `repo-page-16.png` | 失效项标记（770×782）：`rebased-smoke-conflict` 行降不透明度、头像转灰、警示图标 + 气泡含 `(unavailable)` | `037868F4F64C55F6` |
| `repo-page-17b.png` | 点失效行的确认框（确定前，769×781）：「仓库路径不可用」+ 路径带 `(unavailable)` + 「从最近列表移除 / 关 闭」，背景列表未变、URL 未跳转 | `625FF25A296FCDAC` |
| `repo-page-17.png` | 「从最近列表移除」后（769×781）：该行已消失（列表 11 → 10），盘上仓库仍在（CLI 620 提交） | `17E4902354D95BB3` |
| `theme-light-repo-page.png` | 明亮主题下的首页列表：同一 `colorIndex` 取明亮支渐变（明暗两套取色） | `4C73A78DA35DB5B3` |
| `log-collapse-01b.png` | 折叠前（1440×900）：`rebased-smoke` 默认 8 行、无虚线、无高亮环 | `F6FD0823788176AC` |
| `log-collapse-01.png` | 点**圆点**后：8 → 6 行，中间两提交消失、两端之间出现虚线段（`stroke-dasharray="4 3"`） | `BEE47CA5C406BE5C` |
| `log-collapse-02.png` | 悬停圆点：整条线性链 4 个圆点出现高亮环（`#1668dc`） | `DF701C396B28BA53` |
| `log-collapse-03.png` | 大仓「折叠线性分支」：首行之后直接跳到 `bulk commit 270`（隐藏 48 条）+ 顶部虚线段 | `9E8445FE9D3AF011` |
| `log-branch-filter-01b.png` | 分支过滤弹窗（1440×900）：本地/远程两组 + `✔ feature` + 「清空」；背景图已是只看 feature 的 6 行、过滤行无折叠按钮 | `E46CDE3FE7EB6E41` |
| `log-branch-filter-01.png` | 选中 `feature` 后的图：只剩该分支可达的 6 行，「折叠线性分支/展开线性分支」整组消失 | `FDE8A298180070A9` |
| `log-branch-filter-02.png` | 点「清空」后回到默认视图：8 行 + 两个折叠按钮回来（画面带「分支过滤」入口气泡以与折叠前后态区分） | `2A6ACDA6F81AF995` |
| `log-branch-filter-03.png` | 大仓过滤激活：提示「部分分支的提交尚未加载，将继续加载」在盘、折叠按钮消失、图回到 50 行首屏 | `7ECA3CD08F7D5F7A` |

**⑤ 未覆盖项与后续计划**

| 未覆盖项 | 原因 | 处置建议 |
|----------|------|----------|
| 「折叠线性分支」**一次折叠多条链** | 三个可用夹具里 ≥3 行的线性链各自只有 **1 条**（`rebased-smoke` 是 `b3912c6→a0d8689`，`rebased-smoke-big` / `rebased-smoke-huge` 全线性=1 条，conflict 仓无 ≥3 行链），live 无法构出「多条链同时折叠」的画面 | 本轮只验证到「全部可折叠链被折叠」= 1 条；多链路径由 `collapseAllFragments` 单测覆盖。若要在冒烟里看到，需给 `smoke-setup.ps1` 加一个「两个合并提交」的夹具仓（属脚本改动，本轮不做） |
| 悬停**虚线段**时高亮两端（Java `LINEAR_EXPAND_CASE`） | 本轮只取证了「悬停圆点 → 整链高亮」这一条悬停路径 | 下一轮补：折叠后把指针停在虚线上，读 `graph-node-ring-*` 是否恰为两端 2 个 |
| 主题切换的**就地**跟随（不重新挂载页面） | 主题开关在 `/settings`，切完回首页是重新挂载；未构造「停留首页时 `data-theme` 变化」的用户路径 | T3 修复轮已用 `MutationObserver` 订阅 + 单测锁死；如需 live 复证，可用 `auto` 偏好 + 改系统明暗触发 |
| web-koa SPA（`:5173`）对等抽查三块 | 本轮按 `AGENT.md` 冒烟口径以 web-next `:3081` 为被测端；`:3082` 只做了 API 侧互证（`/api/repos`、`/log?all=true`） | 需要时按 §1.1 的对等抽查口径补跑 |
| 折叠态与「按需加载」的交互 | 观察到大仓折叠后仍会继续追加更早提交、链两端按 hash 重算仍成立（`fragmentsToRows` 现算行号），但本轮**未**把它当用例系统取证 | 可在下一轮补「折叠后滚到底 → 追加页进来 → 折叠仍成立」一条 |

### 5.29 日志页就地快照栏标签页化 冒烟（2026-09-16）

> **触发**：把日志页就地快照栏的「文件树」「文件内容」两栏**合并成一条标签栏**（新增 `packages/client/ui/src/composite/snapshot-tabs.tsx`；四栏 → 三栏 `日志｜详情｜快照`；随之删掉「显示/隐藏文件树」开关、跨栏通栏与 `ResizableColumns.header`）。在真实服务里按用户路径逐项走查。
> **夹具**：`D:\zhanglei1120\Coding\proxyGateway`（本机最近仓库，非 rebasedjs 自身）；浏览版本 `9eb03b7897e92e3218eaf561916b432c1677474d`（页面短名 `9eb03b7`，作者 `zhanglei1120`，2026-09-16 11:09 提交）。仓内 `HEAD` 已是 `69e8568`——快照栏看的是**历史版本**，与工作区无关，符合只读语义。
> **服务**：web-next `:3081`（会话内已在跑的 Next dev + HMR；改动全在 `packages/client/ui`，热更即生效，未重启服务）。
> **口径**：浏览器侧全只读（未提交/检出/改文件）；本轮**改了 `packages/client/ui`**，故证据含一条「改前缺陷 → 改后复验」（见 1.5）。
> **视口**：统一 `browser_resize(1440×900)`；明亮主题抽查走 `/settings` 切主题后回同一深链。

**① 范围清单（逐项）**

| # | 范围项 | 结论 | 判据（浏览器 DOM / 画面） | 互证（CLI） |
|---|--------|------|---------------------------|-------------|
| 1.1 | 展开快照栏 = **三栏**（日志｜详情｜快照），两条分隔条 | ✅ | `[data-pane-key]` = `log / details / snapshot`；`.ant-splitter-bar` 恰 **2** 条；未展开时 `[data-testid="snapshot-tabs"]` 不存在 | — |
| 1.2 | 标签栏第一个标签是「文件（112）」：带文件夹图标、**没有关闭按钮**；版本 chip 常驻标签栏右端 | ✅ | `.ant-tabs-tab` 文本 = `文件（112）`；该 tab 内 `.ant-tabs-tab-remove` 为 `null`；`[data-testid="snapshot-tree-rev"]` = `9eb03b7` | `git ls-tree -r 9eb03b7 \| wc -l` = **112**（与标签里的 N 逐字一致） |
| 1.3 | 树在第一个标签页内，且**第一层目录自动展开** | ✅ | `[data-testid="snapshot-tree-pane"]` 含 `README`-同级行；前 12 行 = `bin / start.sh / stop.sh / docs / plans / superpowers / 语音合成.md / 语音识别.md / lib / convert / protocol / response` | 该版本根目录条目 = `ls-tree 9eb03b7` 首层（目录聚合后目录在前、同级按名排序） |
| 1.4 | 树里点文件 → 开成**新文件标签**并把 `?file=` 写回地址栏 | ✅ | 点 `bin/start.sh` → 标签变 `文件（112）\| start.sh`、`location.search` 末尾 = `&file=bin%2Fstart.sh`（点前后 URL 逐字对比） | `git ls-tree -r 9eb03b7 --name-only` 命中 `bin/start.sh` |
| 1.5 | **多标签**并存（4 个），且同一时刻**只有激活标签页可见** | ✅（改前 ❌ → 已修） | 4 个标签 `文件（112）/ config.js / start.sh / access-log.js`；`.ant-tabs-content` 共 4 个、`offsetParent !== null` 的恰 **1** 个；隐藏页 `style.display === ''`（隐藏由 antd 的 `.ant-tabs-content-hidden` 负责） | — |
| 1.6 | 切回已开过的标签：**立即出内容**（不闪加载态），编辑器实例按标签保留 | ✅ | 切回 `config.js`：激活页内 `.ant-spin` = `false`、正文宿主 767px、可见行 41 行；`document.querySelectorAll('.monaco-editor').length` = **3**（三个文件各一个实例，另有 1 个树标签页无编辑器） | 内容与 `git show 9eb03b7:<path>` 逐字一致（见 ③） |
| 1.7 | 关闭**非当前**标签：只从标签栏移除，不动容器选中 | ✅ | 关 `start.sh`：标签 3 → 2、`?file=` 仍是 `lib%2Fconfig.js`、`.monaco-editor` 3 → 1（该标签页随之卸载）、控制台无新增错误 | — |
| 1.8 | 关闭**当前**标签：切到相邻标签；关掉最后一个 → 回「文件」标签并清空 `?file=` | ✅ | 关 `config.js`（当时唯一文件标签）：URL 里 `file=` 整段消失、激活标签回到 `文件（112）`、`.monaco-editor` = 0、树可见（`snapshot-tree-pane` 有尺寸） | — |
| 1.9 | 点「文件」标签：回到树，并让容器清空 `?file=` | ✅ | 点 `snapshot-tree-title` 后 `location.search` 只剩 `?select=…&snap=…`（`file=` 被清掉）、激活标签 = `文件（112）` | 与容器既有 toggle 口径一致（同路径再点即收起，未新增契约） |
| 1.10 | 深链 `?snap=&file=` 刷新/直达：开该文件标签并激活、树逐级展开、内容就绪 | ✅ | 直达该深链后：标签 = `文件（112）\| config.js`、激活 = `config.js`、路径栏 = `lib/config.js`、Monaco 465–768px 满高、控制台 **0 error** | 版本与文件都在该 rev（`ls-tree` 命中） |
| 1.11 | 高度契约：标签页与正文吃满快照栏（不再按内容长高） | ✅（改前 ❌ → 已修） | `.ant-tabs-body-holder` = `.ant-tabs-body` = 激活标签页 = **797px**；正文宿主 **768px**；`monaco-editor` 767px；快照栏 `scrollWidth === clientWidth`（无横向溢出） | 改前实测同一页面：holder 495 / body 与标签页 **35** / 编辑器宿主 **5**（高度退化成内容高） |
| 1.12 | 分隔条仍可拖、宽度仍落库（键沿用合栏前那一个） | ✅ | 拖第二条分隔条左移 120px：`details 320 → 200`、`snapshot 783 → 994`、`log` 弹性（246 不变）；编辑器宽随之 994；`localStorage` = `contentWidth: "994"`、`detailsWidth: "200"` | — |
| 1.13 | 明暗主题各成立（正文、路径栏分隔线、编辑器主题） | ✅ | `/settings` 切「明亮」后回同一深链：`data-theme=light`、`body` 背景 `rgb(255,255,255)`、Monaco 类从 `vs-dark` 变 `vs`、正文 767px 满高；切回「暗色」复原 | — |
| 1.14 | 页面控制台 | ✅（正常路径 0 error） | 深链直达、开标签、切标签、关标签这些路径上控制台 **0 error**；仅 dev 下**新开**文件标签时偶发一条 Monaco `Canceled: Canceled`（根因与处置见 ⑤） | — |

**② 操作路径（点击 / 输入序列）**

1. 探针：`browser_take_screenshot` 直接落 `D:\zhanglei1120\Github\deepseek-harness\.playwright-mcp\shots\<名>.png`（在允许根内，未被拒）→ 收尾 `Copy-Item` 搬进 `docs/shots/` → `Get-FileHash` 登记。
2. 深链直达 `/repos/bc52b542…?select=9eb03b7…&snap=9eb03b7…&file=lib%2Fconfig.js` → 等选中提交经有界补页恢复（本仓要拉数页，约 20s）→ 断言标签 / 三栏 / 几何。
3. 点「文件（112）」标签 → 点树里 `bin/start.sh` → 回点「文件（112）」标签 → 点 `lib/access-log.js` → 断言 4 标签 / 4 个标签页 / 仅 1 个可见 / 3 个编辑器。
4. 点 `config.js` 标签 → 断言无 Spin、路径栏与 URL 同步。
5. 点 `start.sh` 标签的 `×`（非当前）→ 点 `config.js` 标签的 `×`（当前，且是最后一个）→ 断言回「文件」标签 + `?file=` 清空。
6. `page.mouse` 拖第二条 `.ant-splitter-bar` 左移 120px → 读三栏宽度与 `localStorage`。
7. `/settings` → 「界面主题 → 明亮」→ 回同一深链 → 截图 `theme-log-snapshot-light.png` → 再切回「暗色」复原（并清掉本轮为取证临时改过的三处栏宽偏好键）。

**③ 证据（浏览器状态 + CLI 输出互证）**

- **标签总数互证**：`git -C D:\zhanglei1120\Coding\proxyGateway ls-tree -r 9eb03b7897e92e3218eaf561916b432c1677474d | wc -l` → **112**；页面标签 = `文件（112）`。
- **文件都在该版本里**：`ls-tree -r <rev> --name-only` 命中 `bin/start.sh`、`lib/config.js`、`lib/access-log.js`。
- **内容逐字互证**：`git show 9eb03b7:lib/access-log.js` 首行 = `/** 访问日志：把请求体与响应结果逐行写入专用 JSONL 文件。`，页面正文第 1 行同文；第 15 行 = `import path from "node:path";`，页面第 15 行同文。`git show 9eb03b7:lib/config.js` 含 `import { toArray, toObject, toString } from "./utils.js";`，与页面正文一致。
- **高度契约原文**（改后）：`{holder:{h:797}, body:{h:797}, pane:{h:797}, editorHost:{h:768}}`；改前同页：`{holder:{h:495}, body:{h:35}, pane:{h:35}, editorHost:{h:5}}`。
- **多标签/可见性原文**：`tabs=[文件（112）, config.js, start.sh, access-log.js]`、`paneCount=4`、`visiblePaneCount=1`、`monacoEditors=3`、隐藏页 `display=''`。
- **落库原文**：拖前 `{log:246, details:320, snapshot:874}` + `{contentWidth:"874", detailsWidth:"320", treeWidth:"369"}`；拖后 `{log:246, details:200, snapshot:994}` + `{contentWidth:"994", detailsWidth:"200", treeWidth:"369"}`。
- **CLI 复核工作区未被触碰**：全程只读，未执行任何写操作；`git -C <夹具> status --porcelain` 与冒烟前的改动一致（本轮未引入新条目）。

**④ 截图账目（4 张，均落 `docs/shots/`）**

| 截图 | 内容（最终正确效果） | SHA256（前 16 位） |
|------|----------------------|--------------------|
| `log-snapshot-01.png` | 深链直达 `?snap&file=lib/config.js`（1440×900，暗色）：标签 `文件（112）\| config.js`、右端版本 chip `9eb03b7`、路径栏 `lib/config.js` + 复制/新标签页、正文满高 | `496871B7A2D3ADD1` |
| `log-snapshot-02.png` | 多标签（同视口，暗色）：`文件（112）\| config.js \| start.sh \| access-log.js`，激活 `access-log.js`——**只显示一份正文**（改前缺陷态是三份上下叠成一列，本张为改后复拍） | `B603F49C03A70E48` |
| `log-snapshot-03.png` | 停在「文件（112）」标签：整栏是这一版的文件树（第一层 `bin/docs/lib/test` 已展开），无关闭按钮、版本 chip 仍在 | `1B2149639302C6F0` |
| `theme-log-snapshot-light.png` | 明亮主题下的同一深链：正文黑字白底、路径栏分隔线与标签栏取亮色 token、Monaco 切 `vs` | `8CA0CDAA47DFE427` |

**⑤ 未覆盖项与后续计划**

| 未覆盖项 | 原因 | 处置建议 |
|----------|------|----------|
| dev 下新开文件标签偶发 `Canceled: Canceled` | 栈顶为 React StrictMode 的 effect 双调用（`doubleInvokeEffectsOnFiber`）→ `base/monaco-lazy.tsx` 的 `PlainEditor` 清理里销毁 model / editor，Monaco 内部 Delayer 取消时抛错。**真实卸载路径（关标签、切文件）实测 0 error**；生产构建无双调用，不涉功能 | 属既有 Monaco 包装（本轮未改该文件）。若要消音，可在清理里用 try/catch 包住销毁（或改成先 `setModel(null)` 再销毁），建议与 Monaco 包装那一笔一起做 |
| 树的子模块/链接徽标、二进制提示、加载/错误占位 | 这些口径由 `SnapshotTreeColumn` / `ReadonlyTextView` 原样复用（本轮未改其行为），已由既有单测覆盖；live 本轮未逐项重拍 | 需要证据时沿用 §4.31 的 `browse-*` 历史图（那一页本身已删除，见 §5.29⑥）；日志页快照栏的 live 证据见 5.29 本体 |
| web-koa SPA（`:5173`）对等抽查 | 本轮按 `AGENT.md` 以 web-next `:3081` 为被测端；两端 `LogPage` 是同一 ui 组件、props 同形 | 需要时按 §1.1 对等抽查口径补跑 |
| 遗留 localStorage 键 `rebased.log.treeWidth` | 文件树不再是独立栏，该键已无读取方（值原样留在用户浏览器里） | 不清理：清它需要额外 `removeItem` 代码，收益为零；快照栏宽度**沿用** `rebased.log.contentWidth`，老用户的宽度设置原样继承 |
| 本轮附带修复（与快照栏行为无关） | 工作区改动前 `pnpm typecheck` 红、`commit-details-panel.test.tsx` 2 条红：面板根节点未转发 `style`/`data-testid`、作者行缺 `data-testid="author-line"`、主题行的加粗元素被 `CopyOnClick` 的 span 包在外层 | 已一并修好：根节点转发 `style`/`data-testid`、作者行容器补 testid、`<Text strong>` 换到 `CopyOnClick` 内层。`pnpm typecheck` 全绿、`commit-details-panel.test.tsx` 18/18 |

**⑥ 后续用户口径修订（2026-09-16，取代上表 1.2 与 ④ 中对应描述）**

| 修订项 | 新口径 | 落点 |
|--------|--------|------|
| 版本 chip（上表 1.2 / 截图 01、03 中的 `snapshot-tree-rev`） | **删除**：标签栏右端不再显示版本短名；在哪一版由详情面板与地址栏 `?snap=` 表达 | `composite/snapshot-tabs.tsx` 去掉 `tabBarExtraContent`；`log-page` 不再传 `rev`/`revTitle`/`browseRevTitle` |
| 文件标签路径栏的「在新标签页打开」（导出图标，`browse-open-tab`） | **删除**：路径栏只留「复制全文」 | `base/readonly-text-view.tsx` 的 `ReadonlyTextActions` 去掉 `ExportOutlined` 按钮；`log-page` 去掉 `onOpenBrowseInNewTab`，两端容器同步去掉该接线 |
| **整页快照浏览页 `/repos/:id/browse`** | **整页删除**（2026-09-16 用户口径）：该页在应用内没有任何入口——上一条删掉导出按钮后，最后一个指向它的链接也没了；详情面板「浏览快照」开的是**就地快照栏**（`?snap=`）。树与内容视图原样保留 | 删除 `apps/web-koa/src/pages/browse.tsx`（含 `main.tsx` 路由）、`apps/web-next/app/repos/[repoId]/browse/page.tsx`、ui `composite/browse-panel.tsx` 的 `BrowsePanel`（连同其单测）；`SnapshotTreeColumn`/`snapshotTreeNodes`/`topLevelDirKeys` 迁到 `composite/snapshot-tree-column.tsx`；`GET /browse`、`GET /browse/content` 与 client hooks **保留**（快照栏消费，另被 `scripts/check-fluid-layout.mjs` 用来挑夹具文件）。几何度量随之把 `browse` 那一格换成 `log-snapshot` / `log-snapshot-file` 两格 |
| 顶栏「首页」链接 + 仓库名文本 | 合并成 **antd 面包屑**「首页 / 仓库名」：首页是可点的一级（回欢迎屏），仓库名是当前页（末级不可点） | `composite/log-page.tsx` 顶栏 `[data-testid="log-topbar"]` 左侧改用 `Breadcrumb`（`data-testid="log-breadcrumb"`）；`log-go-home` 落在面包屑第一级的 `Typography.Link` 上 |

> 说明：上述三项属**用户明确指定的界面口径变更**（不是缺陷修复），故不重拍 5.29 的既有截图；三张图里仍能看到旧 chip 与旧导出按钮，以本节为准。行为侧已由单测锁定：`snapshot-tabs.test.tsx`（无 chip / 无导出按钮）、`readonly-text-view.test.tsx`（只剩复制全文）、`log-page.test.tsx`（面包屑两级 + 首页回调）。

> **几何测量脚本随之更新（`scripts/check-fluid-layout.mjs`，未重跑矩阵）**：路由表里 `browse` 一格（`/repos/:id/browse?rev=`）已删除，换成 `log-snapshot`（`?select=&snap=`，就绪门 `snapshot-tabs` + 内容门 `[data-testid="snapshot-tree-pane"] .ant-tree-treenode` ≥ 10）与 `log-snapshot-file`（再加 `?file=`，内容门 `browse-content-path` —— **刻意不用 Monaco 宿主**：它要等懒加载，门不该承担加载时序）两格；截图页清单同样把 `browse` 换成 `log-snapshot`；`assertPanes` 那条「两栏宿主」例外断言只留给 `log-select`（就地快照栏是**三栏 ResizableColumns**，宿主是 `resizable-pane-*`，套不上 `split-*-host` 判据）。因此每主题的路由/状态格从 33 变 34，**上表 ②③⑤ 里的 396/384 格是脚本更新前的历史记账**，下一轮重跑会得到 408 格 —— 数字变了不代表回归，先看格数对不上还是断言红。

**⑦ 代码审查后的修复与复验（2026-09-16 晚，同一轮）**

对 `snapshot-tabs.tsx` 做了一轮只读审查（另起 agent，独立上下文），按结论修掉两条会静默产生用户可见错误的缺陷，并清理本次合并留下的死代码/过期注释：

| 修复项 | 问题（审查发现） | 落点 |
|--------|------------------|------|
| 标签键命名空间 | 树标签键是保留字面量 `'files'`，而**仓库根真有个叫 `files` 的文件**时会撞键：React 重复 key、点该文件名被当成点「文件」标签（反而清空 `?file=`），**这个文件永远打不开** | 文件标签键改为 `path:` + 路径（`fileTabKey`/`pathOfFileTabKey`），与树键天然隔离；新增用例「根目录真有名为 files 的文件」 |
| 关标签的接管判据 | 只比 `activeKey`：用户点「文件」标签后容器那次 URL 回写还没落地时，关掉那个「容器仍选中」的标签会留下**标签没了、树里仍高亮、URL 仍指着它**的死状态（再点该文件是 toggle，得点两次才回来） | 判据改为 `key !== activeKey && path !== selectedPath` 才提前 return；关闭时一并丢弃该路径的内容副本；新增用例「偏差态：容器还没清 ?file= 时切到树，再关掉那个文件标签也要接管选中」 |
| 文案 | 「切回该标签页即可查看内容」在**当前激活**标签上也可能出现（组件不保证容器一定在拉它） | 改为中性文案「内容尚未加载 / 再点一次树里的这个文件名即可重新获取」 |
| 死代码 | `MIN_CONTENT_CHARS`（合栏后零消费者）、`estimateCharWidth`（唯一调用点恒传 `undefined`，实测分支是死的） | 删掉两者，保留并补注释 `FALLBACK_CHAR_WIDTH`；`log-page` 直接用它折算默认宽 |
| 过期注释 | `resizable-columns.tsx`（四栏 / Layout(Header+Content) / 文件树栏例）、`browse-panel.tsx`（两栏通栏）、`readonly-text-view.tsx`（顶部通栏）、`commit-details-panel.tsx`（关闭文件树与内容两栏）、`log-page.tsx`（展开快照即隐去作者/日期列——与「宽度驱动」自相矛盾） | 逐处改为合栏后的口径 |

- **复验（流水线）**：`pnpm --filter @rebased/ui format` 干净；`pnpm typecheck` 七包全绿；`pnpm --filter @rebased/ui test` → **71 文件 / 874 用例全绿**（含新增的 4 条边界用例）。
- **复验（真实浏览器，:3081 新开标签页，不打扰用户所在页）**：深链 `?snap=&file=lib/config.js` → 点「文件（112）」→ 点 `bin/stop.sh` → 标签变 `文件（112）| config.js | stop.sh`、激活 `stop.sh`、正文 24 行满高、可见标签页恰 1 个；点 `stop.sh` 的 `×` → 邻标签接管、`?file=` 自动改为 `lib%2Fconfig.js`。`path:` 键空间下开/切/关全链路正常。
- **留待后续（本轮明确不改，供决策）**：
  - 容器仍把**短 hash** 传给 `browseRev`（`apps/*/…repo*.tsx`），它现在只当标签栏重挂载键用；两个提交共享 7 位前缀时不会复位（概率极低）。建议改传完整 rev。
  - `LOG_WISH_WIDTH`（`log-page.tsx`）在**本次改动之前**就已只剩注释引用（HEAD 里没有它，属在途那一笔的遗留），未动。
  - 手写 `padding: '4px 8px'`（路径栏）：沿用合栏前通栏的写法（与栏内 8px 对齐），未改成 token；`renderedPaneKeys.current` 在 render 期赋值（3 栏恒定，无实际风险）同理。
  - `snapshots` 副本随关标签删除，但未给 `openPaths` 设上限（编辑器式多标签不设上限是产品口径；SWR 侧本来就缓存了同一批正文）。

### 5.30 变更集由 Modal 改为快照栏标签（含逐文件差异标签）冒烟（2026-09-16）

> **触发**：用户口径——详情面板「查看变更集」不再弹对话框，改为快照栏标签栏里的「变更集（N）」标签；清单里点文件**在同一标签栏**开差异标签（原行为是「在新浏览器标签页打开差异页」）。追加两条口径：① 变更集标签**粘性**——换提交时标签保留、内容自动换成新提交的变更集；② 已开差异标签**保留，但只在路径仍属于新变更集时才继续看**（不在里面的自动关掉）。
> **夹具**：`D:\zhanglei1120\Coding\proxyGateway`（同 §5.29）。主用例提交 `dd5c9b77`（2 个 `M` 文件）；粘性/剪枝用 `a3433b81`（2 文件）与 `83f6052`（仅 `README.md`）；根提交降级用 `e74f624`（该仓根提交，7 个 `A` 文件）。
> **服务**：web-next `:3081`（会话内已在跑的 Next dev + HMR；改动落在 `packages/client/ui` 与 `packages/client/client`，`transpilePackages` 直编源码，热更即生效，未重启服务）。
> **口径**：浏览器侧全只读（未提交/检出/改文件）；视口 `1528×782`（沿用会话内既有窗口，未 resize）。

**① 范围清单（逐项）**

| # | 范围项 | 结论 | 判据（浏览器 DOM / 画面） | 互证（CLI / 网络） |
|---|--------|------|---------------------------|--------------------|
| 1.1 | 点「查看变更集」**不弹对话框**，改为快照栏标签 | ✅ | `document.querySelector('[role="dialog"]')` = `null`（同类断言全程 5 次均为 null）；快照栏随之展开（地址栏追加 `&snap=dd5c9b77…`） | — |
| 1.2 | 标签栏出现「变更集（N）」，N = 该提交变更文件数 | ✅ | `.ant-tabs-tab` = `文件（136）` + `变更集（2）`（激活）；清单两行 = `M README.md`、`M docs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md` | `git show --name-status dd5c9b77` = 同 2 个 `M` 文件（逐字一致） |
| 1.3 | 点清单里的文件 → **同一标签栏**开差异标签并激活；不跳页、不新开浏览器标签页 | ✅ | 点 `…design.md` → 标签 = `文件（136）｜变更集（2）｜2026-09-15-multi-protocol-inbound-design.md`（激活）；`location.href` 不变（仍是日志页 `?select=&snap=`，未跳到 `/diff`） | 差异请求发向 `GET /api/repos/:id/diff?file=…&from=<父>&to=dd5c9b77…`（同源 XHR，非导航） |
| 1.4 | 差异正文是**真 diff**（Monaco 行内、路径栏写明对比两端） | ✅ | 路径栏 = 该路径 + 「与父提交对比」；`.monaco-diff-editor` 已渲染；呈现方式默认落在「行内」（窄栏口径），「并排」可切 | 与 `git show dd5c9b77 -- <path>` 的改动位置一致（画面第 553–571 行改动区） |
| 1.5 | **粘性**：换选中提交时变更集标签保留、内容换成新提交的 | ✅ | `dd5c9b77` → 点提交行 `a3433b81`：「变更集（2）」仍在（激活）且清单变成 `lib/convert/responses-to-chat.js` / `test/responses-to-chat.test.js`；再切 `83f6052` → 「变更集（1）」= `README.md` | `git show --name-status a3433b81 / 83f6052` 分别与两个清单逐字一致 |
| 1.6 | **剪枝**：已开差异标签只在路径仍属新变更集时保留 | ✅ | 在 `dd5c9b77`/`a3433b81` 打开的 `lib/convert/responses-to-chat.js` 差异标签，切到 `83f6052` 后**自动消失**；而在 `dd5c9b77` 打开的 `README.md` 差异标签切到 `83f6052` 后**保留且仍是激活标签**，正文按新提交重算（Monaco 已渲染） | 两个提交的 `--name-only` 分别含/不含这两个路径 |
| 1.7 | **根提交降级**：无父版本不发请求、只给提示行 | ✅ | `?select=e74f624&snap=e74f624`（根提交）→ 「变更集（7）」；点 `app.js` → `[data-testid="changes-diff-root-hint"]` 存在、`.monaco-diff-editor` = 0 | **网络面板 0 条 `/diff` 请求**（`file` 空串挂 null key + 无父版本不取数）；`git show --name-status e74f624` = 7 个 `A` 文件 |
| 1.8 | 按钮是**开关**：开着时呈选中态，再点一次收起整族 | ✅ | 打开后 `[data-testid="open-changes"]` 含 `ant-btn-primary`；再点一次 → 变更集标签与差异标签一并消失、只剩 `文件（145）`、按钮回 `ant-btn-default` | — |
| 1.9 | 刷新边界：变更集/差异标签不进地址栏 | ✅ | 同一深链刷新后标签只剩 `文件（136）`（快照栏本身仍由 `?snap=` 恢复），需要重新点「查看变更集」 | 与 §4.31 边界条一致（深链只有 `?snap=` / `?file=`） |
| 1.10 | 页面控制台 | ✅（0 业务 error） | 全程仅 1 条 `favicon.ico` 404（既有噪声，与功能无关）；无 React key/受控告警 | — |

**② 操作路径（点击 / 输入序列）**

1. 深链 `/repos/bc52b542…?select=dd5c9b77…`（先只带选中，不带 `snap`）→ 等选中提交经有界补页恢复（本仓 309 提交，约 10s）。
2. 点详情面板「查看变更集」→ 断言无 `role=dialog`、快照栏展开、`变更集（2）` 标签激活且清单与 `git show --name-status` 一致 → 截图 `log-page-33b.png`。
3. 点清单里 `docs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md` → 断言差异标签激活、路径栏与「与父提交对比」、Monaco 行内 diff 已渲染、`location.href` 未变 → 截图 `log-page-33.png`。
4. 点提交行 `a3433b81`（图里第 5 行）→ 断言变更集标签保留且换成新提交的清单；再点 `83f6052`（第 4 行）→ 断言 `responses-to-chat.js` 差异标签被剪掉、`README.md` 差异标签保留。
5. 先点「查看变更集」收起，再点一次重新打开 → 断言按钮 primary / default 两态与标签族开合一致。
6. 深链 `?select=e74f624…&snap=e74f624…`（根提交）→ 点「查看变更集」→ 点 `app.js` → 断言根提示行、无 Monaco、网络面板无 `/diff` 请求。
7. 同一深链刷新 → 断言回到 `文件（N）` 标签（变更集标签不还原）。
8. 截图：`page.screenshot({ path: './<名>.png' })`（Playwright 服务工作目录 `D:\zhanglei1120\Github\deepseek-harness\`，**不是** `.playwright-mcp\`）→ `Copy-Item` 搬进 `docs/shots/` 并按 `log-page-<NN>` 续号 → `Get-FileHash` 登记，临时图删除。

**③ 证据（浏览器状态 + CLI / 网络互证）**

- **形态断言原文**：`{ tabs: ["文件（7）","变更集（7）","app.js"], active: ["app.js"], rootHintCount: 1, renameHintCount: 0, monacoCount: 0, dialogCount: 0, diffRequests: [] }`（根提交一轮；`diffRequests` 是 `page.on('request')` 抓的同源 `/diff` 请求数）。
- **主用例形态原文**：`{ tabs: ["文件（136）","变更集（2）"], active: ["变更集（2）"], dialog: false }`；点文件后 `{ active: ["2026-09-15-multi-protocol-inbound-design.md"], diffPath: "docs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md" }`。
- **剪枝原文**：`83f6052` 一轮 `{ tabs: ["文件（145）","变更集（1）","README.md"], active: ["README.md"], changesetPaneTitle: "变更集（1）", hasMonacoDiff: true }` —— 差异标签只剩 `README.md`（`responses-to-chat.js` 已剪掉）。
- **CLI 互证**：`git -C D:\zhanglei1120\Coding\proxyGateway show --name-status` 逐提交核对——`dd5c9b77` 2 个 `M`、`a3433b81` 2 个 `M`、`83f6052` 1 个 `M`、`e74f624`（根）7 个 `A`；页面标签名里的 N 与四个数字**逐个相等**。
- **工作区未被触碰**：全程只读（未提交/检出/改文件）；`git status --porcelain` 与冒烟前一致。

**④ 截图账目（2 张，均落 `docs/shots/`）**

| 截图 | 内容（最终正确效果） | SHA256（前 16 位） |
|------|----------------------|--------------------|
| `log-page-33.png` | **最终效果**（1528×782，暗色）：标签 `文件（136）｜变更集（2）｜2026-09-15-multi-protocol-inbound-design.md`，激活差异标签；路径栏 = 路径 + 「与父提交对比」；呈现方式「行内」选中；Monaco 行内 diff 渲染改动区（553–571 行） | `7C26648D3DB70F9B` |
| `log-page-33b.png` | 过程态：停在「变更集（2）」标签——提交主题 + `M README.md` + `M docs/superpowers/specs/…design.md`；详情面板「查看变更集」呈选中态、Tooltip 为「收起变更集标签…」；**整屏无对话框** | `F3CBB9A32BD7A861` |

**⑤ 未覆盖项与后续计划**

| 未覆盖项 | 原因 | 处置建议 |
|----------|------|----------|
| R 重命名文件的差异标签（提示行）、差异拉取失败/加载中占位 | live 未造 R 状态夹具；这三态由单测锁定（`snapshot-tabs.test.tsx`「R 重命名的差异标签只给提示行」「差异拉取失败/未就绪」） | 需要 live 证据时用 `git mv` 造一笔重命名提交再走一遍 |
| 明暗主题 × 快照栏标签栏 | 本轮按功能路径走查，未切主题重拍（§5.29 已有暗色/明亮两套快照栏底图） | 下一轮主题抽查时把变更集标签一并纳入（一次切换即可） |
| web-koa SPA（`:5173`）对等抽查 | 按 `AGENT.md` 以 web-next 为被测端；两端 `LogPage` 是同一 ui 组件、props 同形（本轮两容器同口径改动：`changesHash` 粘性跟随、`changesDiff` 剪枝、`useFileDiff` 取数） | 需要时按 §1.1 对等抽查口径补跑 |
| 变更集标签的「收起快照栏即清空该族状态」 | 依赖点「浏览快照」收起面板这一动作；本轮未逐项走（行为由容器 `onBrowse` 分支覆盖） | 与主题抽查同批补走 |

**⑥ 流水线复验（同一轮）**

- `pnpm typecheck`：`@rebased/ui`、`@rebased/client`、`@rebased/web-koa`、`@rebased/web-next` 逐个 `tsc --noEmit` 全绿。
- `pnpm format`（ESLint `--fix`，全 workspace）：干净，无额外改动。
- `pnpm --filter @rebased/ui test` → **70 文件 / 879 用例全绿**（含新增的 13 条变更集标签族用例、改写的 2 条 Modal 用例）。
- `pnpm --filter @rebased/client test` → 36 文件 / 181 用例全绿（含新增「`file` 为空串挂 null key 不发请求」）。
- `pnpm --filter @rebased/web-next test` → 190 用例全绿。
- `pnpm --filter @rebased/web-koa test` → 首轮 2 条红（`src/sse.test.ts`：Windows 临时目录清理 `EPERM` + 第四帧等待超时），**隔离复跑该文件 7/7 通过**——判定为既有环境抖动（与本次改动无关：改动只落在 `src/pages/repo.tsx` 的容器状态与 UI props）。

### 5.31 差异呈现选项修订：自动换行 / 折叠改接未变更区 / 上一个下一个 / 清单去主题（2026-09-16 晚）

> **触发**（用户口径四条，同一轮）：① 变更集清单里那行提交主题**删掉**；② 工具条在「忽略空白」旁加**自动换行**；③ 检查「折叠」为什么没效果；④ 差异标签路径栏的「与父提交对比」文字**换成「上一个 / 下一个」**切换按钮。
> **③ 的最终裁定（用户追问后收口）**：Monaco 的 `folding`（**代码折叠**：行号槽里收起函数/括号块）与差异编辑器的 `hideUnchangedRegions`（**未变更区折叠**）**不是同一个意思**；而本仓为绕开打包链路的语言服务缺陷把四个语言服务的 worker 能力全关了（见 `base/monaco-lazy` 文件头），没有折叠区提供者 ⇒ 前者是死控件。用户口径：既然不是一个意思，**就删除那个勾选框**。故最终不是「改接」（中途曾按改接实现过一版，已按用户口径回退为删除），未变更区折叠由「上下文行数」一个控件独占表达。
> **夹具 / 服务 / 口径**：同 §5.30（web-next `:3081`，HMR 生效未重启；`proxyGateway`；只读）。

**① 范围清单（逐项）**

| # | 范围项 | 结论 | 判据（浏览器 DOM / 画面） | 互证 |
|---|--------|------|---------------------------|------|
| 1.1 | 变更集清单不再重复提交主题 | ✅ | `[data-testid="snapshot-changeset-pane"]` 正文 = `M README.md / M docs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md`，`innerText.includes('docs: P1c 终审的文档更正')` = **false** | — |
| 2.1 | 新增「自动换行」开关（默认关） | ✅ | 工具条出现 `diff-wrap`（`aria-checked=false`）；打开后同一文件（`design.md`，栏宽 909px）**渲染行数 37 → 43**（6 行长行折成额外行） | — |
| 3.1 | 「折叠」勾选框无可见效果 → **删除**；未变更区折叠由「上下文行数」独占 | ✅ | ① 删除前取证：把未变更区折叠关掉（上下文→全部显示，排除干扰）后，编辑器里 `[class*="folding"]` = **0**、折叠图标 = **0**，勾选框开着关着画面完全一样 ⇒ 它是接 Monaco `folding`（代码折叠）的死控件，与 `hideUnchangedRegions`（未变更区折叠）**不是同一件事**；② 删除后：工具条不再有 `diff-folding`，未变更区折叠仍由「上下文行数」驱动——默认 5 行 → 隐藏块 **8** / 正文 43 行，切「全部显示」→ 隐藏块 **0** / 正文 62 行 | 单测锁定：`queryByTestId('diff-folding')` 为 null；默认下发 `hideUnchangedRegions:{enabled:true,contextLineCount:5}`、「全部显示」不下发；`options.folding` 恒为 undefined |
| 4.1 | 路径栏文字换成「上一个 / 下一个」 | ✅ | `[data-testid="diff-file-nav"]` = `‹ 上一个 2/2 下一个 ›`（`design.md` 在 2 文件变更集里居末，「下一个」禁用）；页面上不再出现「与父提交对比」文字（改由路径 Tooltip 承载） | 该提交变更集 = 2 个 `M` 文件（`git show --name-status dd5c9b77`） |
| 4.2 | 点「下一个」真切到相邻文件的差异（同一标签栏） | ✅ | 点后 `changes-diff-path` = `docs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md`、标签栏多出该差异标签并激活 | 与清单行点击同一套 open+activate |
| 4.3 | 单文件变更集不退化成空条 | ✅ | `5de3584`（只动 `lib/server.js`）→ 路径栏 = `lib/server.js` + `‹ 上一个 1/1 下一个 ›`，两键均禁用（共享组件加 `showSingle`：差异页仍按 <2 不渲染，快照栏这边渲染 1/1） | `git show --name-status 5de35842` = 1 个 `M` 文件 |

**② 操作路径**：深链 `?select=5de35842&snap=5de35842` → 点「查看变更集」→ 点 `lib/server.js` → 读路径栏/工具条（此时 1/1）→ 截图 `log-page-34b.png`；再深链 `?select=dd5c9b77&snap=dd5c9b77` → 点「查看变更集」→ 读清单正文（确认无主题）→ 点 `README.md` → 点「下一个」→ 读路径与标签栏 → 截图 `log-page-34.png`；「自动换行」开关一开一关读渲染行数；折叠轮：把「上下文行数」在 5 行 ↔ 全部显示之间切换读隐藏块与行数，并在「全部显示」态下数折叠槽元素（证明 `folding` 无渲染）。

**③ 证据原文**

- 未变更区折叠（删除勾选框后，唯一控件是「上下文行数」）：`{"before":{"lineCount":37,"hiddenRegions":8,"wrapChecked":"false"},"wrapOn":{"lineCount":43,"hiddenRegions":8,"wrapChecked":"true"},"foldOff":{"lineCount":62,"hiddenRegions":0,"wrapChecked":"true"},"foldBackOn":{"lineCount":43,"hiddenRegions":8,"wrapChecked":"true"}}`（`foldOff/foldBackOn` = 上下文切「全部显示」再切回 5 行）
- 死控件取证（上下文=全部显示，未变更区折叠已关）：`{"foldingOn":{"anyFoldingClass":0,"foldIcons":0,"rows":36},"foldingOff":{"anyFoldingClass":0,"foldIcons":0,"rows":36}}`
- 导航：`{"nav":"‹ 上一个\n2/2\n下一个 ›","path":"docs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md"}`；单文件轮：`{"nav":"‹ 上一个\n1/1\n下一个 ›","prevDisabled":true,"nextDisabled":true,"path":"lib/server.js"}`
- 清单：`{"paneText":"M\nREADME.md\nM\ndocs/superpowers/specs/2026-09-15-multi-protocol-inbound-design.md","hasSubject":false}`

**④ 截图账目（2 张）**

| 截图 | 内容 | SHA256（前 16 位） |
|------|------|--------------------|
| `log-page-34.png` | 双文件变更集（`dd5c9b77`）：标签栏 `文件（136）｜变更集（2）｜README.md｜…design.md`；路径栏「‹ 上一个 **2/2** 下一个 ›」；工具条「并排/行内 ｜ 忽略空白 ｜ **自动换行** ｜ 空白不显示 ｜ 上下文 5 行」（**无「折叠」勾选框**——该图拍于删除之后） | `2E2B9D0EA1AAC2D4` |
| `log-page-34b.png` | 单文件变更集（`5de3584`）：路径栏「‹ 上一个 **1/1** 下一个 ›」（两键禁用），行内 diff 已渲染 | `B537041E44E55CC6` |

> 注：两张截图取自删除「折叠」勾选框**之前**（工具条里还能看到它）；勾选框的删除由 ③ 的 DOM 取证与单测锁定，画面差异为「少一个勾选框」，故未重拍。

**⑤ 未覆盖项**：明暗主题 × 新开关；跨仓「与工作树差异」入口的差异页页头（新文案「上一个/下一个」替换了原「‹ Prev / Next ›」，由 `diff-page.test.tsx` 的用例锁定，live 未重走）；web-koa 对等抽查。三处均与 §5.30⑤ 同批处理。

**⑥ 流水线复验**：`pnpm format` 干净、`pnpm typecheck` 七包全绿；`pnpm --filter @rebased/ui test` → **70 文件 / 882 用例全绿**（本轮新增：自动换行透传 `wordWrap`、未变更区折叠由上下文行数表达、「全部显示」不下发 `hideUnchangedRegions` 且 `folding` 恒不下发、路径栏导航与 `1/1` 边界；改写：忽略空白开关改按 testid 取、变更集清单断言主题缺席、「折叠」勾选框断言缺席）。

### 5.32 两个面板键（键在即开 + 值承载定位）+ 差异工具条逐项记忆本机（2026-09-17）

> **触发**（用户口径两条）：① 「查看变更集」「浏览快照」两个功能不再共用一个 `?snap=<hash>`（有版本号即展开）：各占一个**独立开关**参数、独立显隐；② 区域 `[并排 行内 忽略空白 自动换行 空白不显示 上下文 N 行]` 里**每个属性一个 localStorage 键**，新开标签页读最后一次要求。
> **设计裁定（用户逐轮确认，最终版）**：两个面板键 `browse` / `diff`，规则只有一条——**键在即面板开，值承载定位**：
> `?browse=<路径>` = 该文件内容标签在前台；`?browse=`（空值）= 文件树在前台；`?diff=<路径>` = 该差异标签在前台；`?diff=`（空值）= 变更集清单在前台；缺键 = 该面板关着。
> 于是**路径槽里永远只放真路径、聚合标签用空值**——一个真叫 `1` 的文件（`?browse=1`）与「树在前台」（`?browse=`）永不冲突（这正是放弃 `?browse=1` 当哨兵的原因，用户提出）。
> 中途否掉的方案：`file` 由两族共写（两族抢一格 + 文件内容激活态不可寻址）、`?diff=1|<path>` + `?file=`（三个键，且「清单在前台」只能隐式或缺键推断）。
> 旧 `?snap=<hash>[&file=]` 降级为**只读兼容**（读到即改写为 `browse[=<路径>]` 并用该版本号补 `select`），应用不再写出 `snap` / `file` 两个参数。
> **夹具 / 服务 / 口径**：web-next `:3081`（Next dev `16.2.7`，未重启；`proxyGateway`，只读；每次改完代码**整页 reload**——HMR 对 `replaceState` 路径不可靠，实测旧 chunk 会掩盖真相）。

**① 范围清单（逐项）**

| # | 范围项 | 结论 | 判据（浏览器 DOM / 地址栏） | 互证 |
|---|--------|------|---------------------------|------|
| 1.1 | 「浏览快照」开 → 右栏出现文件树那一族 | ✅ | 点详情面板「浏览快照」→ `?select=X&browse=`；三栏 `resizable-pane-log｜details｜snapshot` + `文件（82）` + 树 55 节点；按钮主按钮态 | 面板恒看 `?select=` 那一版，URL 里不需要版本号 |
| 1.2 | 「查看变更集」开 → 只出变更集那一族（不代劳开文件树） | ✅ | 点「查看变更集」→ `?select=X&diff=`（browse 键**未被加上**）：三栏在，标签栏只有 `变更集（1）`；`browse-snapshot` 保持默认态 | 清单 = 该提交唯一 `M` 文件，与 `?select=` 一致 |
| 1.3 | 两键并存 / 各自收起互不影响 | ✅ | `?select=X&browse=README.md&diff=` → 标签 `文件（82）｜变更集（1）｜README.md`（README 在前台，两按钮均主按钮态）；点「浏览快照」收起 → `?select=X&diff=`（browse 键删掉、文件族标签消失、右栏与变更集仍在）；再点开 → `?select=X&diff=&browse=` | 两键各写各的，关一个不动另一个 |
| 1.4 | 两个都关 = 不留垃圾参数 | ✅ | 两键都删后地址栏只剩 `?select=X`；`resizable-pane-*` 0 个、`.ant-splitter-bar` 1 条（回两栏 SplitPane） | 与 v1「无残留参数」同口径 |
| 1.5 | 深链 `?select=X&diff=<路径>` 直达该差异标签 | ✅ | 整页 load → 标签 `文件（82）｜变更集（1）｜…design.md`，激活项 = 该差异；恰好 1 条 `/diff` 请求（`file=docs%2F…design.md`）；工具栏就位 | 该路径确在 `GET /commits/X` 的变更集里（`apiFiles` 同值） |
| 1.6 | 深链 `?browse=<路径>&diff=` 两族各自定位 | ✅ | 标签 `文件（82）｜变更集（1）｜README.md`，激活 = `README.md`，内容路径栏 = `README.md` | 两族的前台项同时被 URL 表达 |
| 1.7 | 旧深链 `?snap=<hash>[&file=]` 改写 | ✅ | 直达 `?select=X&snap=X` → 稳定后 `?select=X&browse=`（`snap` 键消失、树铺出）；带 `&file=lib%2Fconfig.js` 时 → `?browse=lib/config.js`（单测锁定） | `scripts/check-fluid-layout.mjs` 的两格改走 `?browse=` |
| 1.8 | **刷新前后一致**（用户追问的核心） | ✅ | 看差异 → 点回「变更集（N）」清单（地址栏被写成 `?diff=`）→ 整页刷新 → **仍停在清单**、标签栏与两面板开合原样 | 这一步正是「只在打开文件时写地址」做不到的：切标签也要写 |
| 1.9 | 非法定位不造伪标签 | ✅ | 深链 `?diff=package.json`（该路径**不在**本次变更集里）→ 标签只有 `文件（82）｜变更集（1）`、激活 = 清单、**`/diff` 请求 0 条**（剪枝在发请求前生效） | 不变式「差异标签只在仍属于新变更集时保留」未被 URL 绕过 |
| 2.1 | 五个工具条选项**各占一个本机键** | ✅ | 逐项改一遍：`rebased.diff.sideBySide=true`、`.ignoreWhitespace=true`、`.autoWrap=true`、`.renderWhitespace=all`、`.contextLines=15`（5 个键各一个；没动过的不入库） | 键前缀沿用列宽记忆的 `rebased.*` 口径 |
| 2.2 | **新开标签页**读最后一次要求 | ✅ | 新标签页开同一深链 → 差异标签的控件直接是「并排 / 忽略空白开 / 自动换行开 / 空白显示 / 上下文 15 行」 | 本机偏好跨标签页/跨会话，**不进 URL** |
| 2.3 | 坏值不炸页面 | ✅ | 单测：`contextLines='lots'`、`sideBySide='maybe'` → 逐项回落默认 | 隐私模式读不到也回默认（`readStoredPreference` 的 try/catch） |

**② 操作路径**：深链 `?select=X&browse=&diff=` → 读两族标签与两按钮态 → 点清单文件（读 `?diff=<路径>`）→ 点「变更集（N）」标签（读地址被写成 `?diff=`，**标签不关**）→ 整页刷新（读仍停在清单）→ 深链 `?diff=<路径>`（读直达激活 + `/diff` 请求数）→ 深链 `?diff=package.json`（读伪标签缺席 + 0 请求）→ 深链 `?browse=README.md&diff=`（读两族各自定位）→ 点「浏览快照」两次（读删键/加键）→ 逐项改五个工具条选项（读 5 个本机键）→ 新标签页复开（读控件还原）。

**③ 证据原文**

- 1.8：`{"afterSwitchToList":"?select=ecb6bfc1…&browse=&diff=","activeTab":"变更集（1）","afterRefresh":{"url":"?select=ecb6bfc1…&browse=&diff=","tabs":["文件（82）","变更集（1）"],"activeTab":"变更集（1）"}}`
- 1.5：`{"tabs":["文件（82）","变更集（1）","2026-09-15-multi-protocol-inbound-design.md"],"activeTab":"2026-09-15-multi-protocol-inbound-design.md","diffRequests":["/api/repos/…/diff?file=docs%2Fsuperpowers%2Fspecs%2F2026-09-15-multi-protocol-inbound"]}`
- 1.9：`{"tabs":["文件（82）","变更集（1）"],"activeTab":"变更集（1）","diffRequests":[]}`
- 1.3/1.6：`{"url":"?select=ecb6bfc1…&browse=README.md&diff=","tabs":["文件（82）","变更集（1）","README.md"],"activeTab":"README.md","browseBtn":true,"changesBtn":true}`；收起/再开 `{"afterOff":"?select=…&diff=","afterOn":"?select=…&diff=&browse="}`
- 2.1/2.2：`{"rebased.diff.sideBySide":"true","rebased.diff.ignoreWhitespace":"true","rebased.diff.autoWrap":"true","rebased.diff.renderWhitespace":"all","rebased.diff.contextLines":"15"}`；新标签页 `{"mode":"并排","ignoreWs":"true","wrap":"true","whitespace":"空白显示","context":"上下文 15 行"}`

**④ 实现期实测缺陷（均已修，各有单测/复验）**

| 缺陷 | 现象 | 根因 | 修法 |
|------|------|------|------|
| web-next 面板开关点了没反应 | 点开关地址栏动了、界面纹丝不动 | 本容器写地址走原生 `history.replaceState`，**不触发重渲染**，由 URL 派生的开合永远停在旧值 | 容器存本地镜像（`useState`）+ URL→状态同步 effect（幂等：已一致时返回同一引用） |
| 旧 `snap=` 被重新写回 | 改写后地址里又冒出 `snap=` | 同一原因：`useSearchParams` 还是旧值，拿它当底本写会把刚删掉的参数抄回来 | 所有读/写路径改以**当前地址栏**为准（模块级 `liveQuery()`） |
| 深链 `?diff=<路径>` 在 Next 上落不了地 | 首帧面板开了却没有激活标签 | ① 服务端预渲染时没有 `window`，`useState` 初值只能给空；② 客户端**水合不重跑初值**；③ 同步 effect 又被「地址没变就跳过」把首帧跳掉了 | 初值改读地址栏 + 去掉「按地址变化跳过」的门槛（幂等由 `syncDiffTabsWithUrl` 保证）；`liveQuery` 加无 `window` 兜底 |
| 「收起」判据依赖一个取数键 | 收起点了没反应 | 判据写成 `changesOn && changesHash === selectedHash`，而深链首帧该键为空 | 删掉第二真源：面板恒看 `?select=`，键在不在就是开合 |
| 切标签不写地址 | 切回清单后刷新被弹回差异标签 | 差异族只在「打开文件」时写地址，切标签只 setState | 差异族变化统一走 `onChangesDiffChange`：`active` 空 → 写 `?diff=`，否则写 `?diff=<路径>` |

**⑤ 未覆盖项**：web-koa `:3080` 的浏览器复验（该 app 的 SPA 需重建产物；两容器本轮改动逐行同构、`url-select` 两份**逐字节相同**，故只跑单测 + typecheck）；明暗主题 × 新键；`scripts/check-fluid-layout.mjs` 全矩阵重跑（本轮只改 URL 字面量，未重跑六档几何）。

**⑥ 流水线复验**：`pnpm --filter @rebased/web-koa|web-next exec vitest run src/url-select.test.ts` → 各 **27 用例全绿**（含「名为 `1` 的文件无歧义」「`?browse=` 空值往返」「旧 snap 改写」三组）；`pnpm --filter @rebased/ui exec vitest run`（本轮相关的 5 个套件）→ **5 文件 / 174 用例全绿**；两个容器 app 的 `tsc --noEmit` 全绿；本轮涉及文件 `eslint` 干净。

### 5.33 状态页补丁预览的代码高亮（Shiki）（2026-09-17）

> **触发**（用户口径）：在 :3081 状态页标注 `pre[data-testid="hunk-text-0"]` →「增加代码高亮功能」。查证：那两块（逐 hunk 正文 + 整份补丁兜底）是裸 `<pre>`（只有 `font-family: monospace`），`+`/`-`/`@@` 与代码本体一个色——仓库其它差异视图（`DiffPage`/`HunkDiffView`/`ThreeWayView`/`DiffStreamView`）早在 P-30 就按文件类型高亮了，这里是漏点。
> **设计裁定（用户确认两条）**：① 高亮做到**真语法**层（按 `languageForPath` 推语言，不是只给 `+`/`-` 上色）；② 高亮器**照抄既有 loader 注入点**约定（测试注入 stub）。**引擎选型（用户提问"改用 shiki 是否满足，monaco 慢"）**：改用 **Shiki**——Monaco 的代价不在着色而在**实例**（每块一个 `createDiffEditor`），Shiki 只做「文本 → 带颜色 HTML」；全量编辑器仍归 Monaco（那几处要的是编辑器语义）。选型依据是实测数值：Monaco 主入口 13.4MB raw，Shiki 细粒度 11 语法 + 内联 wasm 的生产 chunk **1378KB raw / 342KB gzip**。
> **夹具 / 服务 / 口径**：web-next `:3081`（未重启）；只读夹具 `proxyGateway`（本地有未提交改动即可复现预览，验证完 `git checkout` 还原，两轮均确认工作区回到 0 变更）；语言推断取 `.js → typescript`（`domain/language.ts` 的既有映射）。

**① 范围清单（逐项）**

| # | 范围项 | 结论 | 判据（浏览器 DOM / 计算样式） |
|---|--------|------|------------------------------|
| 1.1 | 逐 hunk 正文真语法高亮 | ✅ | 展开 `hunk 1` 后 `[data-testid="code-block-highlighted"]` 就位，18 行、`.code` 计算颜色 **7 种**（关键字/字符串/注释/数字/函数名/变量各异） |
| 1.2 | 暗/亮主题跟随 `data-theme` | ✅ | 同一块：`data-theme=dark` → 7 种深色（`#F97583` 等）；`=light` → 同 7 个位置的浅色（`#D73A49` 等）；切主题后无需重算高亮 |
| 1.3 | diff 语义不丢（增删底色 + 前缀） | ✅ | `.line[data-kind=add]` 底色 `rgba(82,196,26,0.12)`、`remove` 红底、`hunk` 头灰底；`.diff-marker` 逐行 `+`/`-`/空格（16 个标记与 18 行中的非空行一一对应） |
| 1.4 | 空行不塌行 | ✅ | 18 行**行高全等**（18px，含 1 个真空行）；`.line { min-height: 1lh }` 兜住空行 |
| 1.5 | 行之间不出现空行 | ✅ | 修复前 `innerText` 每行夹 `\n`（`<pre>` 的 `white-space: pre` 把 JSX 缩进换行也渲了）；修复后 18 行就是 18 行 |
| 1.6 | 滚动外壳（不撑开卡片） | ✅ | hunk 正文外壳 `max-height: 240px`；长内容在块内滚动，卡片高度不随 hunk 数增长 |
| 1.7 | 未收录语言 / 加载失败退纯文本 | ✅ | 单测：`loading` 与 `error` 两种 loader 都渲染 `code-block-plain`；未收录语言 `highlight()` 返回 null（不猜语法） |
| 1.8 | 单测不碰真高亮器 | ✅ | `loader` 注入 stub；jsdom 下既不起 Monaco（`queryCommandSupported` 缺失）也不起 wasm |

**② 操作路径**：`proxyGateway` 制造一处未提交改动（验证后已 `git checkout` 还原；第二轮用临时未跟踪文件）→ `:3081/repos/<id>/status` → 点左列 `lib/logging.js` → 点 `hunk 1` 展开 → 读 DOM（行数/行高/`data-kind`/`.diff-marker`/计算颜色）→ `PUT /api/settings {"theme":"light"}` 后重载读浅色 → 拍两张截图 → 主题复位 `dark`。

**③ 证据原文**

- 结构与颜色（暗/亮各一次）：`{"lineCount":18,"kinds":["hunk","context","context","context","add","add","add","add","add","context","remove","remove","add","add","context","context","context",null],"distinctColors":7}`；暗色 `distinctComputedColors` = `rgb(225,228,232)/rgb(249,117,131)/rgb(121,184,255)/rgb(179,146,240)/rgb(255,171,112)/rgb(106,115,125)/rgb(158,203,255)`，浅色 = `rgb(36,41,46)/rgb(215,58,73)/rgb(0,92,197)/rgb(111,66,193)/rgb(227,98,9)/rgb(106,115,125)/rgb(3,47,98)`。
- 行高/底色：`{"distinctLineHeights":[18],"blankLineCount":1,"wrapperMaxHeight":"none","contentHeight":240}`（`maxHeight` 在组件外层 div 上，实测块高恰好 240）。
- 控制台：整轮（打开状态页 → 展开 hunk → 切主题 → 重载）**0 error / 0 warning**（`favicon 404` 亦未出现）。
- 生产产物（`pnpm --filter @rebased/web-next build` → **exit 0**）：`static/chunks/452_5n_g92pim.js` = shiki 懒加载 chunk，**1,378KB raw / 342KB gzip**，内含 `AGFzbQ…`（wasm base64）、`github-dark`、`diff`。
- **截图账目（2 张，均落 `docs/shots/`）**

| 截图 | 内容 | SHA256（前 16 位） |
|------|------|--------------------|
| `status-patch-highlight-01-dark.png` | 暗色：hunk `@@ -201,9 +201,14 @@ function getLastUserMessage(body)` 的特写（698×241）；7 色语法 + 绿/红行底色 + `+`/`-` 前缀 + hunk 头灰底 | `2AC9FB7860914248` |
| `status-patch-highlight-02-light.png` | 同取景明亮态（`theme=light`）：同一批 token 的浅色档，底色与前景对比正常（证明主题翻转在行内颜色层生效） | `8D2A8A8C0C868F6D` |

**④ 实现期实测缺陷（均已修，各有单测/复验）**

| 缺陷 | 现象 | 根因 | 修法 |
|------|------|------|------|
| 浅色档全丢（整块同色） | 冒烟时 18 行只有 1 种计算颜色，HTML 里写着 `style="color:undefined;--shiki-dark:#E1E4E8"` | 双主题下 shiki **不写 `token.color`**，浅色与深色一起放在 `token.htmlStyle`（`{color:'#D73A49','--shiki-dark':'#F97583'}`） | `renderHighlightLines` 整体序列化 `htmlStyle`；新增纯函数单测「不产出 `color:undefined`」 |
| 每个补丁行之间多一条空行 | `innerText` 出现 33 行（实际 18 行），行高集合含 `0` | `<pre>` 的 `white-space: pre` 把 JSX 子元素之间的**缩进换行**也当内容渲染 | `pre { white-space: normal }` + `.line { white-space: pre }`；`code-block.test.tsx` 断言「行之间不夹文本节点」 |
| 空行整行塌掉 | 空行行高 0，行号/上下文对不齐 | 浏览器不为没有内联内容的行块生成行盒 | `.line { min-height: 1.5em; min-height: 1lh }` |
| 深色翻转选择器是脆弱侧写 | 当时功能正常，但 `[style*='--shiki-dark']` 会命中任何含该子串的元素 | 按 style 子串选元素属侧写（shiki 若同时输出 `--shiki-light` 会把浅色也掀成深色） | 改按 token 自身的 `.code` 类选（`[data-theme=dark] .rebased-code-block .code`） |
| 既有 testid 契约断裂 | `patch-text` 断言失败（新组件内部 testid 只在纯文本/高亮间切换） | 把 `patch-text`/`hunk-text-*` 直接落在会切换的 `<pre>` 上 | 两个既有 testid 移到**外层包裹 div**，内层变体 testid 只管渲染态 |

**⑤ 未覆盖项**：web-koa（:3082/:5173）的浏览器复验——该 app 的 `build`/`typecheck` 在本工作区本来就红（未提交的 `pages/repo.tsx` 引用 `url-select.ts` 里不存在的 `withSnapParams`，另有 `PANEL_AGGREGATE`/`browseFilePath` 未定义），Vite 生产链路未能单独复验；但两个 app 共用同一份 `@rebased/ui` 源码与同一套 Vite/Next 解析规则，且 Next 生产构建已实测通过。语法表只收 11 种语言（`language.ts` 能推出的其余语言按纯文本呈现，`highlight()` 返回 null 而非硬塞错语法），后续按需在 `LANG_GRAMMARS` 加一行 import。`scripts/check-fluid-layout.mjs` 未重跑（本轮只改块内渲染，未动页面骨架）。

**⑥ 流水线复验**：`pnpm --filter @rebased/ui test` → **73 文件 / 920 用例全绿**（本轮新增：`domain/highlight.test.ts` 10、`base/code-block.test.tsx` 8、`status-page.test.tsx` 的「补丁预览代码高亮」3）；`@rebased/ui` 的 `tsc --noEmit` 与 `eslint`（含 `format` 已跑）干净；`pnpm --filter @rebased/web-next test` → 203 全绿、`build` exit 0；`pnpm --filter @rebased/web-koa test` → 204 用例中偶发 1 条 `TypeError: fetch failed`（两次全量分别落在 `sse.test.ts`、`gitlab.test.ts`，**单跑各自全绿**，均为 ephemeral 端口的 fetch 抖动，与本轮改动无因果关系——本轮只动 `@rebased/ui` 的展示组件，这些是服务端集成用例）。

### 5.34 溯源页三栏工作台 冒烟（R24 部分重跑，2026-09-20）

> **触发**：溯源页由单列 `BlameView` 整页重构为三栏工作台（左树｜中栏提交清单｜右栏操作条 + 三标签，提交 `2bbe3fd`、`496f21f`、`c824bcd`、`f412b53`、`0903000`），旧单列组件已删除，F-101~F-104 四行的界面形态与截图全部作废，需要在真实服务 + 真实仓库里重走一遍并归档。
> **夹具**：**本 worktree 自身**（`D:\zhanglei1120\Github\rebasedjs-blame-workbench`，历史足够长、含重命名与多作者），经欢迎屏「仓库路径 → 打开」注册；浏览器侧全只读（未提交/检出/改文件）。**repoId 不作证据**：它由注册动作现场生成，重开一次就换一个（首轮为 `04cda2c7-…`，重拍时为 `aad9baff-…`），故本文只按「本 worktree 自身」这一层记录。
> **服务（全部为本 worktree 的本地实例，用户正在用的 `:3081` 全程未被触碰）**：web-next `pnpm --filter @rebased/web-next exec next dev -p 3091`（`:3091`，主要证据侧）；web-koa SPA `pnpm --filter @rebased/web-koa dev:web`（`:5173`，代理 `/api` → `:3082`）；web-koa API `pnpm --filter @rebased/web-koa dev`（`:3082`）；独立配置目录 `REBASED_CONFIG_DIR=<worktree>\.smoke-config`，与用户配置互不影响。
> **浏览器**：Playwright MCP；为不打扰用户正在使用的同一浏览器实例，全部操作在**新建的独立标签页**里完成；视口 `1440×900`。
> **入场路径**：从日志页顶栏「更多 → 溯源」进入（不用 URL 直达绕过入口），其后按真实用户路径逐项操作。

**① 范围清单（逐项）**

| # | 范围项 | 结论 | 判据（浏览器 DOM / 地址栏） | 互证（CLI / 网络） |
|---|--------|------|---------------------------|--------------------|
| 1 | 入口：日志页顶栏「更多 → 溯源」 | ✅ | 地址变为 `/repos/<id>/blame`；顶栏「更多」高亮（web-koa `:5173` 实测） | — |
| 2 | 左树点 `AGENT.md` | ✅ | 地址变为 `?file=AGENT.md`；左树该行选中；中栏出现 **12 条**提交 | `git log --follow --oneline -- AGENT.md` = **12 条**，顶条 `b96148e` 与中栏首条一致（提交标题按中栏宽度省略号截断，故按短哈希比对，不比标题全串） |
| 3 | 中栏派生选中 / 点选 | ✅ | 无 `?select=` 时首条自动选中（`blame-commit-0` 带 `data-selected="true"`）；点第 2 条 → `?select=6e1807493cf0050e9178a4e4935a8d9427a60416` | `git log -1 6e180749…` = `feat(web): 设置页按作用域拆两页 + web-koa 主题接线`，与中栏第 2 行一致 |
| 4 | 三标签切换 | ✅ | 「与最新版本差异」→ `?view=latest`；「逐行注解」→ `?view=annotate`；**均只拉当前标签的数据** | 网络面板逐次核对：非激活标签无对应 `/diff`、`/blame` 请求 |
| 5 | 逐行注解 + 点行选提交 | ✅ | 点 `blame-line-7`（归属 `8536a91`）→ `?file=AGENT.md&view=annotate&select=8536a9166d331aaad59c788df7cf35114e05e21c`；注解选中行数 1；**中栏同时高亮 `8536a91`**；注解区行数 77 | `git show -s 8536a91` = `fix(core): abort 陈旧 pid 守卫与未合并状态解析，AGENT.md 路径更新`，与注解行归属一致 |
| 6 | 操作条四出口齐备 | ✅ | `blame-action-log` / `blame-action-diff` / `blame-action-affected` / `blame-action-history` 四个 testid **全部渲染** | — |
| 7 | 根提交降级 | ✅ | `.agent/AGENT.md` 唯一提交即根提交（`13a68f62…`）；「本文件改动」显示 `blame-changes-root-hint`（「该提交为根提交（无父版本）…」），**无加载态、无错误** | `git rev-list --parents -1 13a68f62` 只有一个字段（无父）；**不发 `/diff` 请求**（网络面板 0 条，与 UI 无加载态互证） |
| 8 | 受影响文件弹窗 | ✅ | 标题「受影响文件（13a68f6）」；**52 个文件行**（`affected-file-0…51`），状标 `A`；Esc 可关 | `git show --name-only 13a68f62` 恰 **52** 条，与清单逐条一致 |
| 9 | 未知态（陈旧 `?select=`） | ✅ | `?select=deadbeef…` → 操作条只剩 **3 个**按钮（**无「差异页」**，不猜根提交）；「本文件改动」显示服务端中文错误「引用不存在或不是提交：deadbeefdeadbeefdeadbeefdeadbeefdeadbeef」；中栏不高亮任何行但 **12 条历史仍在** | 控制台唯一一条 error 是预期内的 `GET /api/repos/…/commits/deadbeef…` **400** |
| 10 | 旧 `?rev=` 深链规范化 | ✅ | web-koa `:5173`：`?file=docs/manual.md&rev=8d6d961` → 地址被改写为 `?file=docs%2Fmanual.md&select=8d6d961&view=annotate`，逐行注解 **1519 行**；web-next `:3091` 同形 | `git show -s 8d6d961` = `docs: 更新 README 与使用手册（同步新功能、精简 README、重选手册配图）` |
| 11 | 前进 / 后退 | ✅ | 浏览器后退恢复 `?file=docs/manual.md&select=8d6d961&view=annotate` + 逐行注解 1519 行（页内动作走 replace，不塞满历史） | — |
| 12 | 明暗双主题 + 列宽记忆 | ✅ | 暗色 `data-theme=dark`（body `rgb(20,20,20)`）；切偏好为 light 后 `data-theme=light`（body `rgb(255,255,255)`），**收尾已还原为 dark**；列宽偏好写入后 reload 仍为 `tree 320 / commits 260`，右栏弹性吃剩余 850。**复拍时补测**（明亮主题帧）：`[data-testid="blame-view-changes"]` 高 **759**、「本文件改动」渲染出**真实差异 3 处插入 / 5 处删除** | — |

**控制者补充核对（超出 12 项，但与本次改动直接相关）**

| # | 范围项 | 结论 | 判据 |
|---|--------|------|------|
| 13 | Tabs 高度契约端到端成立 | ✅ | 「与最新版本差异」里 Monaco 真实渲染，`[data-testid="blame-view-latest"]` 高 **580** 落在右栏 **646** 之内（Task 6 的 Important 修复在浏览器里被证实） |
| 14 | hydration 一致性 | ✅ | web-next 硬加载深链 `?file=AGENT.md&view=annotate&select=<完整哈希>` → 控制台 **0 error**（修复前必报 `Hydration failed …`）；注：范围项 9 那次陈旧哈希的唯一 error 是预期内的 400 |
| 15 | 「降级不请求」成立 | ✅ | 根提交与「该提交无此路径」两种降级下，「本文件改动」**不发 `/diff` 请求**（网络面板与 UI 加载态互证） |

**② 操作路径（点击 / 输入序列）**

1. 日志页顶栏「更多 → 溯源」进入 `/repos/<repoId>/blame`（不直达 URL；repoId 由注册现场生成，见页首夹具条）。
2. 左树 `AGENT.md` → 读中栏条数与首条选中态 → 点第 2 条提交（读 `?select=`）→ 依次切「与最新版本差异」「逐行注解」（读 `?view=` 与请求数）。
3. 「逐行注解」里点 `blame-line-7` → 读地址、注解选中行数与中栏高亮。
4. 回「本文件改动」→ 读四个出口 testid。
5. 左树点 `.agent/AGENT.md`（唯一提交 = 根提交）→ 读根提示行与网络面板 0 条 `/diff`。
6. 点「受影响」→ 数文件行 → 按 Esc 关闭。
7. 深链 `?select=deadbeef…`（陈旧哈希）→ 读操作条按钮数、右栏错误文案、中栏高亮态与控制台。
8. web-koa `:5173` 与 web-next `:3091` 各走一遍 `?file=docs/manual.md&rev=8d6d961` → 读改写后的地址与注解行数；随后浏览器后退一次。
9. `/settings` 切「明亮」→ 回同一页取三栏总览帧 → 切回「暗色」；列宽拖动后整页 reload 读三栏宽度。
10. 截图：`page.screenshot({ path })` **直接写入** `docs/shots/`（见 ③ 的落盘口径），每张对应上表一项。

**③ 证据（浏览器状态 + CLI / git 互证）**

- **截图落盘口径（本环境特有）**：本轮的截图全部由 Playwright 的 `page.screenshot({ path })` 直接写入仓库 `docs/shots/`——**MCP 的 `browser_take_screenshot` 在本环境静默不落盘**（调用返回成功但盘上无文件），故不可用；这条与 §1.1 里记的两步法（先落 `.playwright-mcp/shots/` 再 `Copy-Item`）不冲突，只是本环境的 MCP 落盘通道失效，改用页面级 API。图仍是 §1.2 口径下的**最终正确效果图**，`1440×900`。
- **CLI / git 互证**：范围项 2 的 12 条（`git log --follow --oneline -- AGENT.md`）、范围项 3 的 `6e18074`、范围项 5 的 `8536a91`、范围项 7 的 `git rev-list --parents -1 13a68f62`（单字段 = 无父）、范围项 8 的 `git show --name-only 13a68f62`（52 条）、范围项 10 的 `8d6d961`——全部逐条比对一致（见 ① 互证列）。
- **网络面板**：范围项 4 的「只拉当前标签」、范围项 7/15 的「降级不发 `/diff`」、范围项 9 的唯一 400，三者合起来覆盖了「不发多余请求」与「错误如实透出」两侧。
- **夹具自证**：注册的是本 worktree 自身；`git rev-parse --short HEAD` 在冒烟时为 `0903000`；本页只读，冒烟前后工作区状态未变。（repoId 每次注册都变，见页首夹具条，不作证据。）

**④ 截图账目（7 张，均落 `docs/shots/`，`1440×900`）**

| 截图 | 内容（最终正确效果） | 对应范围项 | SHA256（前 16 位） |
|------|----------------------|-----------|--------------------|
| `blame-01.png` | 三栏总览（暗色）：左树选中 `AGENT.md` / 中栏 12 条提交（首条选中）/ 右栏操作条 + 「本文件改动」Monaco 差异 | 2、3、6 | `0FF12E6BF0458CE7` |
| `blame-02.png` | 「与最新版本差异」标签（该提交版本 vs 工作区） | 4、13 | `05920108689926FF` |
| `blame-03.png` | 受影响文件弹窗（**根提交态**：选中根提交 `13a68f62…` 时打开）——标题「受影响文件（13a68f6）」+ **52 个** `A` 行，首行 `A .agent/AGENT.md` | 8 | `3EA02059586639CC` |
| `blame-04.png` | 「逐行注解」+ 点行选中联动（中栏与注解行同时高亮 `8536a91`） | 5 | `25B73FD59FD0FBAC` |
| `blame-05.png` | 陈旧 `?select=` 未知态（无「差异页」+ 中文错误） | 9 | `CFC48706FFD87D80` |
| `blame-05b.png` | 旧 `?rev=` 深链规范化后的落点（逐行注解） | 10 | `F2022B757D2417FB` |
| `blame-06.png` | 三栏总览（明亮主题，「本文件改动」标签，**含真实差异**：3 处插入 / 5 处删除） | 12 | `F1D7395541B3FDFD` |

> **账目口径（§1.2）**：`<NN>` = 该行最终正确效果图，`<NN>b` = 过程图/第二态图。本页属**只读检索页**，没有表单与二次确认（故 §5.27 的「表单 + 成功」成对口径不适用），`blame-05`/`blame-05b` 是「未知态」与「深链规范化落点」两个独立状态，按 §1.2 的「同一行天然同画面必须换一个有意义的状态」规则区分。
> **旧图处置**：旧的 `blame-01…05b`（单列版）被**同名覆盖/替换**——`blame-02.png` 与 `blame-04.png` 的旧图是单列内容，现为三栏内容；`blame-05.png`/`blame-05b.png` 旧图是「受影响文件 Modal」与「点文件后的联动」，现为「未知态」与「深链落点」。引用这些文件名的矩阵行（§4.16 四行、§5.27 ①、§5.27 ③）已同批改写为三栏口径。**除新拍的 `blame-06.png` 外，本轮无新增截图文件、无删除**。
> **复拍说明（审查后收口）**：上表 7 张的 SHA256 是收尾用 `Get-FileHash` 逐张复核的**当前在盘值**；其中两张在审查后复拍并已在提交 `2ad5c65` 落库——`blame-03.png` 改拍**根提交态**的受影响弹窗（旧帧是 `b96148e` 的 9 行 `M`，与「13a68f6 + 52 行 `A`」的说明不符，已作废），`blame-06.png` 改拍**明亮主题 + 真实差异**帧（旧帧是没有差异的瞬时帧，看不出「本文件改动」渲染成功）。两张的说明已按新画面改写（见上表与 §4.16 F-103、§5.27 ①）。

**⑤ 未覆盖项（如实登记，未覆盖就是未覆盖）**

| 未覆盖项 | 原因 | 处置建议 |
|----------|------|----------|
| 拖拽分隔条本身的**手势级**验证 | 本轮只验了列宽的**持久化**（写入偏好 → reload 后仍为 tree 320 / commits 260）；`ResizeObserver` 在 jsdom 不触发，属计划登记的口径 | 需要手势证据时在浏览器里手动拖 `page.mouse`，或按 §5.29 的 `localStorage` 读法补一条 |
| web-koa SPA（`:5173`）未逐项重跑 12 项 | 只做了**入口 / 落点 / 交互级抽查**（范围项 1、10 在 `:5173` 实测），主要证据在 web-next `:3091` 侧 | 需要时按 §1.1 对等抽查口径补跑全 12 项 |
| 大文件历史（数千条提交）下中栏性能 | 未压测；计划 §0.3 已列为**非目标** | 触发条件出现（真实大仓反馈卡顿）时单独立项 |
| F-104 `previousLineno` 边界 | 本轮 12 项范围里没有这一项，**未重跑**（沿用 R10 的结论）；旧图 `blame-04.png` 已被三栏态同名覆盖，单列态画面不再存在 | 三栏态下重走一次改名文件的注解（本 worktree 含重命名历史，夹具现成） |

**⑥ 流水线复验**：本轮（文档收口）**只改 `docs/`**，无源码改动——改动路径只有 `docs/` 下的三个 `.md`：`e2e-verification.md`（本节的台账与矩阵行）与 `manual.md`、`pages-and-api-audit.md`（各 1 行，已随 `6ad98d8` 提交）。工作区另有**两处与本轮文档改动无关的既有残留**，如实登记：① `docs/shots/` 下的截图（由控制者直接落盘，已由 `5a5574e`、`2ad5c65` 提交）；② `.smoke-config/`（冒烟用的独立配置目录，**仍 untracked**，待控制者收尾清理）。`git diff --check` 干净。收尾实跑 `pnpm --filter @rebased/ui test` → **79 文件 / 983 用例全绿**（含三栏工作台的 `blame-workbench` / `blame-change-pane` / `blame-commits-column` / `blame-annotate-table` / `blame-state` 五套）；因本轮零代码改动，该结果与三栏工作台各提交时的结论一致。


