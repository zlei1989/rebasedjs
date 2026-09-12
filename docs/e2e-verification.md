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

1. `pnpm dev` 起服务（web-next :3030 / web-koa :3031），浏览器打开 `http://localhost:3030/`；
2. CLI 复位/构造冒烟仓；
3. 按矩阵逐行执行：入口 → 模拟人工步骤 → 等待 → 截图（最终正确效果）→ CLI 互证；
4. 每行回填「结果」列（✅/❌/跳过+理由）；❌ 行登记 §五 执行记录；
5. 一轮结束更新 §二 总览表状态；全部 ✅ 后关闭记录。

---

## 二、功能矩阵总览（31 页面）

> 行数 = 测试行（含跳过候补）；排除行见 §三。**状态列 = 最近一轮（R23，2026-09-12 起全量重跑）的实测结果**：未重跑到的页面仍保留 R1~R22 的收官状态，重跑完成后逐页改写。

| # | 页面 | 阶段 | 路由/承载 | 模拟入口（一步到达） | 测试行 | 截图前缀 | 状态 |
|---|------|------|-----------|----------------------|--------|----------|------|
| 1 | RepoPage | P1 | `/` | 浏览器打开 :3030 首页 | F-001~F-008（8） | repo-page | ✅ 8/8 |
| 2 | LogPage | P1 | `/repos/:id` | RepoPage 打开冒烟仓 | F-009~F-028（20） | log-page | ⚠️ 19/20（F-020 ❌ 见 D-39） |
| 3 | DiffPage | P1 | `/repos/:id/diff` | StatusPage 双击变更文件 | F-029~F-038（10） | diff-page | ✅ 10/10 |
| 4 | StatusPage | P2 | `/repos/:id/status` | 顶栏「状态」 | F-039~F-051（13） | status-page | ✅ 13/13 |
| 5 | CommitDialog（等效内嵌提交框） | P2 | StatusPage 内 | StatusPage 提交框 | F-052~F-058（7） | commit | ✅ 7/7（F-056 的 gpg 分支跳过） |
| 6 | ResetDialog（内嵌模态） | P2 | LogPage 内 | 详情面板「Reset 到此处」 | F-059~F-061（3） | reset | ✅ 3/3 |
| 7 | BranchPanel | P2 | `/repos/:id/branches` | 顶栏「分支」 | F-062~F-072（11） | branch | ⚠️ 10/11（F-066 ❌ 见 D-40） |
| 8 | MergeDialog（页面化） | P2 | `/repos/:id/merge` | 顶栏「合并」 | F-073~F-075（3） | merge | ✅ 3/3 |
| 9 | RebaseDialog（内嵌模态） | P3 | LogPage 内 | 更多「变基」 | F-076~F-080（5） | rebase | ✅ 5/5 |
| 10 | StashPanel | P2 | `/repos/:id/stashes` | 顶栏「贮藏」 | F-081~F-085（5） | stash | ✅ 5/5 |
| 11 | TagPanel | P3 | `/repos/:id/tags` | 更多「标签」 | F-086~F-088（3） | tag | ✅ 3/3 |
| 12 | RemotePanel | P3 | `/repos/:id/remotes` | 更多「远程管理」 | F-089~F-092（4） | remote | ✅ 4/4 |
| 13 | PushDialog（内嵌模态） | P3 | LogPage 内 | 更多「推送」 | F-093~F-095（3） | push | ✅ 3/3 |
| 14 | PullDialog（内嵌模态） | P3 | LogPage 内 | 更多「拉取」 | F-096~F-097（2） | pull | ✅ 2/2 |
| 15 | UpdateProjectDialog（内嵌模态） | P3 | LogPage 内 | 更多「更新项目」 | F-098~F-100（3） | update | ✅ 3/3 |
| 16 | BlameView | P3 | `/repos/:id/blame` | 更多「溯源」→ 页内输路径 | F-101~F-104（4） | blame | ✅ 4/4 |
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
| 30 | SettingsPage | P1/P2 | `/repos/:id/settings` | 顶栏「设置」 | F-149~F-155（7） | settings | ✅ 7/7 |
| 31 | BrowsePanel | P4 | `/repos/:id/browse?rev=` | 详情面板「浏览快照」 | F-156~F-159（4） | browse | ✅ 4/4 |

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
| F-017 | 详情面板操作按钮 | 观察面板按钮区 | 「浏览快照 / Reset 到此处 / 摘樱桃 / 还原」四按钮齐全可点 | ✅ | log-page-09.png（实测按钮集：`copy-hash`、浏览快照、查看变更集、摘樱桃、还原、`Reset 当前分支到此处`——四行要求项齐全且均可用，另含「查看变更集」） |
| F-018 | 顶栏状态条（分支名 + 徽标） | 观察顶栏 | 分支名 `master` + outgoing 绿徽标（本地领先 1） | ✅ | log-page-10.png（顶栏 `首页 \| rebased-smoke \| master`；`[data-testid=outgoing]` 存在、`incoming` 不存在；CLI `rev-list --left-right --count origin/master...master` = `0 1`） |
| F-019 | 状态变更自动刷新（事件驱动） | pwsh 检出 `feature` → 等待 | 状态条分支名自动变 `feature`，无需刷新 | ✅ | log-page-11.png（夹具工作区脏，直接 `checkout feature` 会被 git 拒——沿 R1 的 P-03 处置改为 `git checkout -b f019-probe`（同内容分支）→ **未刷新**页面状态条自动变 `f019-probe`、outgoing 徽标随上游缺失消失、chips 自动多出 `f019-probe`） |
| F-020 | `refs.changed` 订阅 | pwsh 新建分支 `tmp-refs` → 等待 | ref chips 自动出现 `tmp-refs`（CLI） | ❌ **D-39** | log-page-12.png（**失败态**：`git branch tmp-refs` 后等待 15s+，顶部行的 refs 仍为 `f019-probe master`，无 `tmp-refs`）。服务端正常：`curl -N …/events` 实收 `{"type":"refs.changed","payload":{"refs":["refs/heads/tmp-refs"]}}`，`GET …/log` 该行 refs 也含 `tmp-refs`。根因：容器 `onRefs` 只 `mutateLog()` 重验证 REST 快照，而渲染列表取自 `mergeLogCommits(pageCommits, streamCommits, connected)`——**同 hash 以流侧为准**，流侧那一行是建分支前发出的、refs 旧值。log-page-12b.png（整页重载后 chips 立即出现 `tmp-refs`/`tmp-refs2`，证明数据链路无问题，仅实时刷新缺失） |
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
| F-029 | Monaco DiffEditor（懒加载/行号/高亮/只读） | StatusPage 双击修改文件 → diff 页 | Monaco 渲染满高、行号+语法高亮、只读、vs-dark 暗色与应用一致 | ✅ | diff-page-01.png（状态页双击 `src/app.ts` → `/diff?file=src%2Fapp.ts`；`.monaco-diff-editor` 1424×818 满高、两侧编辑器均 `monaco-editor vs-dark`、body `#141414` 与应用暗色一致；decorations 5 插入 = CLI `git diff --stat` 的 `1 file changed, 5 insertions(+)`；只读口径见 `monaco-lazy.tsx:75` `readOnly:true` 与 `diff-viewer.tsx:142`） |
| F-030 | 并排/行内切换 + 忽略空白 | 依次切换「行内」「忽略空白」开关 | 默认并排；行内切换生效；忽略空白后空白差异消失 | ✅ | diff-page-02.png（默认「并排」；为验证忽略空白，临时给 `src/app.ts` 第 2 行加 3 个行尾空格 → `git diff --stat` 变 6 插入/1 删除，页面 decorations 同步 `ins=6 del=1`；开「忽略空白」后变 `ins=5 del=0`（空白差异消失），切「行内」后单栏成对显示。取证后已把空格还原、`git diff --stat` 回到 5 insertions） |
| F-031 | staged / 工作区切换（三态映射） | 切换 staged 开关 | staged 开 = HEAD vs 暂存区；关 = HEAD vs 工作区（CLI diff 互证） | ✅ | diff-page-03.png（状态页**双击「已暂存」组的 `src/util.ts`** → `/diff?file=src%2Futil.ts&staged=1`，右侧分段选中「已暂存」、4 处插入 = CLI `git diff --cached --stat`；同一文件切「工作区」→ 仍 4 处（HEAD vs 工作区，二者内容相同）；反向用 `src/app.ts` 实测：工作区模式 5 插入 = `git diff`，切「已暂存」→ 0 处 = `git diff --cached` 为空） |
| F-032 | 任意两版本对比（from/to 成对） | CommittedChangesPanel 点文件 → `/diff?file&from=<hash>~1&to=<hash>` | 两侧正确 = 该提交 vs 其父提交 | ✅ | diff-page-04.png（已提交页选 `77e62c4` → 点 `src/app.ts` → `?file=src%2Fapp.ts&from=761961d…&to=77e62c4…`；左栏 6 行（= `git show 761961d:src/app.ts`）、右栏 7 行且含 `APP_VERSION`（= `git show 77e62c4:src/app.ts`），2 处插入；from/to 模式下「工作区/已暂存」分段按契约隐藏） | |
| F-033 | 新增/删除/重命名两侧渲染 | 打开 A/D/R 文件 diff | A 侧/D 侧缺失正确；R 显示 renameFrom | ✅ | diff-page-05.png（**D**：`docs/gone.md` 工作区删除 → 左栏 4 行全文/右栏空，4 删除装饰，页面无报错，API `{before: 4 行, after: ""}`——D-14 未见回归；**A**：`src/new-file.ts`（已暂存新增）→ 左栏空/右栏全文（API `before:""`）；**R**：已提交页点 `R docs/old-name.md → new-name.md` → `?renameFrom=docs%2Fold-name.md`，页面显示提示行「该变更涉及重命名：docs/old-name.md → docs/new-name.md（改名前的历史请到「历史」页查看）」且**不做伪 diff**（两侧 0 行）） | |
| F-034 | unified diff 文本视图 | StatusPage 选中文件 → 行内补丁预览（`/diff/patch` 通道） | unified 文本正确渲染（`@@` 头 + +/- 行） | ✅ | diff-page-06.png（状态页选中 `src/app.ts` → 展开 hunk：正文为 `@@ -4,4 +4,9 @@ export const APP_VERSION = '1.0.0';` + 空格上下文行 + 5 个 `+` 行 + `\ No newline at end of file`，与 CLI `git diff` 逐行一致；通道实测 `GET …/diff/patch?file=src%2Fapp.ts&staged=false` → 200） | |
| F-035 | 大 diff 分块流渲染（DiffStreamView） | 打开 `rebased-smoke-big` 大文件 diff → 等待全文 | 先语言 diff 只读渐进累积分块 → 全文到达切换标准视图 | ✅ | diff-page-07.png（大仓 `big.txt`：网络实测同时走 `…/diff?file=big.txt&staged=false` 与 `…/diff/stream?file=big.txt&staged=false`；流侧实收 **2 个 `diff.chunk` 帧**（16724 + 53320 字符，wire 75020 B）渐进累积，全文到达后切标准 Monaco diff 视图（620 行改写：左 `rewritten for large diff streaming` / 右 `working tree rewrite（大 diff 常驻）`）） | |
| F-036 | word diff/同步滚动/折叠/上下文行数 | 逐一切换「空白字符/仅变更区」开关并滚动 | 词级高亮内建；双侧联动滚动；仅变更区 + 5 行上下文 | ✅ | diff-page-08.png（大仓 `big.txt`：词级高亮内建（44 `char-insert` + 44 `char-delete` 与行级装饰并存）；左栏滚到 2400px 后**两侧同显第 127~170 行**（联动滚动）；`hunks.txt` 上实测「折叠」默认开 + 「上下文 5 行」→ 可见行 1-10/30-41（11-29 收缩），切「上下文 2 行」→ 可见行 3-7/33-37（仅变更区 ±2）；「空白字符」切「空白显示」后可见空白符号） | |
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
| F-045 | 跳 DiffPage | 点文件「差异」/双击 | 跳 `/diff?file=` 且两侧正确 | ✅ | status-page-07.png（双击工作区 `src/util.ts` 文件名 → `/diff?file=src%2Futil.ts`（默认「工作区」模式）、4 处插入 = CLI `git diff --stat -- src/util.ts` 的 `4 insertions(+)`） | |
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
| F-058 | commit & push（提交并推送） | 提交框「提交并推送」 | commit 先落盘 → push 当前分支上游；pushed/up-to-date/rejected 三态提示正确（CLI 远端互证） | ✅ | commit-07.png（「提交并推送」→ 本地 `d5ab22d` 与裸远端 `smoke-remote` 的 HEAD **同 hash**、`rev-list --left-right --count origin/master...master` = `0 0`、`status -sb` 显示 `## master...origin/master` 无进出；再以「回执探针」复跑一次同样 0/0（`20fd3f7`）以截取成功回执） | |

### 4.6 ResetDialog（slug `reset`；P2）

- **入口**：LogPage 详情面板「Reset 到此处」（内嵌模态）；Undo Commit 走顶栏 Popconfirm。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-059 | Reset soft / mixed / hard | 详情面板「Reset 到此处」→ 依次三模式执行 | 各模式行为正确（soft 留暂存/mixed 留工作区/hard 全清；CLI 互证） | ✅ | reset-01.png（对 `HEAD~1`（`d5ab22d`）依次三模式：**soft** → `M  README.md`（暂存保留）；**mixed** → ` M README.md`（工作区保留、暂存清空）；**hard** → 工作区干净且 `README.md` 回 HEAD 版本（F-058 探针行被丢弃）；hard 模式弹窗内出现「我了解 hard 将丢弃未提交改动」勾选门，未勾选时「确 定」为 disabled） | |
| F-060 | Reset Current Branch to Here（等价入口） | 详情面板按钮 → 内嵌模态弹出 | 模态正常弹出（右键菜单形态未做，面板按钮为等价入口） | ✅ | reset-02.png（详情面板「Reset 当前分支到此处」→ 内嵌模态「重置到」：目标短 hash + 主题 `d5ab22d docs(smoke): 提交并推送冒烟（F-058）` + 三模式单选（mixed 为默认）） | |
| F-061 | Undo Commit | 顶栏 Popconfirm → 确认 | soft reset HEAD~1，改动回暂存区（CLI） | ✅ | reset-03.png（顶栏「撤销最近提交」→ Popconfirm「将撤销最近提交并保留改动到暂存区」→ 确定：`git log -1` 由 `d5ab22d` 回退到 `996030d`，被撤销提交的改动以 `M  docs/new-name.md` 回到暂存区——soft reset 语义） | |

### 4.7 BranchPanel（slug `branch`；P2）

- **入口**：顶栏「分支」→ `/repos/:id/branches`。
- **前置**：主仓 master/feature/远程跟踪分支/标签/recent checkout；分叉场景行 F-070 需先构造远端分叉。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-062 | 分组（本地/远程/最近检出/标签）与过滤 | 观察四组 → 文本过滤 → 「仅看已合并」开关 | 四组正确；过滤与已合并开关生效 | ✅ | branch-01.png（四组：最近检出 3 / 本地 8 / 远程 2 / 标签 1；文本过滤 `feat` → 1/3、1/8、1/2；仅看已合并 → 本地 3/8、远程 1/2，与 CLI `git branch --merged HEAD`（feature/master/merged-branch = 3）与 `git branch -r --merged HEAD`（origin/feature = 1）逐项一致，D-19 的远程侧未回归） | |
| F-063 | 行内信息（current/上游徽标/已合并图标） | 观察各分支行 | current 标记、ahead/behind 徽标、已合并绿勾正确 | ✅ | branch-02.png（`master`「当前」+ 上游徽标 `origin/master ↓2` + 已合并绿勾；绿勾集合与 CLI `--merged` 完全一致；未合并的 `diverge-test` 无勾） | |
| F-064 | 创建/删除/重命名/设上游 | 新建 Modal（起始点 + 检出开关）→ 删除（未合并 Popconfirm force 提示）→ 重命名 → 设上游 | 各操作 CLI `branch` 互证 | ✅ | branch-03.png（建 `smoke-created@diverge-test`（`3b0244b`）→ 改名 `smoke-renamed`（旧名 `show-ref` 失败）→ 设上游 `origin/master`（`config branch.*.merge=refs/heads/master` 落盘）→ 未合并分支删除 Popconfirm「该分支未合并，删除将使用强制删除」→ 确认后分支消失；四步 CLI 互证） | |
| F-065 | 检出三态（既有/新建并检出/detached） | 检出既有分支 → 新建并检出 → 标签行「检出」（detached） | 三态切换正确（CLI HEAD 互证） | ✅ | branch-04.png（三态：检出既有 `diverge-test` → `HEAD=3b0244b`；「新建并检出」`smoke-new-checkout` 入最近检出；标签 `v1.0` 检出 → CLI `## HEAD (no branch)` 指向 `761961d`，界面该行无「当前」标记） | |
| F-066 | 查找已合并 / 清理已合并与过时分支 | 开「仅看已合并」→ 「清理已合并（N）」批量删除 | 批量删除非当前已合并分支（CLI 互证） | ❌ **D-40** | branch-05.png（**部分通过 + 新缺陷**：按钮与确认框称「清理已合并（2）」「清理 2 个已合并分支？不可恢复」，实际删除集合比计数多一个——前两个候选 `feature`/`merged-branch` 如预期删除，随后对 worktree 占用的 `wt-merged-probe` 执行 `git branch -d` 失败 → 红 toast「git 命令失败：git branch -d wt-merged-probe 退出码 1：error: cannot delete branch 'wt-merged-probe' used by worktree at '…'」，且成功回执「已清理 N 个已合并分支」因整条 promise 抛错而从未出现。根因与修法见 §5.17 D-40：**面板计数已排除 `checkedOutInWorktree`（D-20），容器执行集没有**。探针 worktree/分支已删、夹具已复原） | |
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
| F-081 | stash save（message/-u/--keep-index） | 页内保存 Modal → 填 message → 勾 includeUntracked/keepIndex | stash 入列，选项生效（CLI `stash list`/`stash show` 互证） | ✅ | stash-01.png（说明 `smoke-stash-f081` + 勾「包含未跟踪文件」+「保持暂存区」；CLI：`stash@{0}: On …: smoke-stash-f081`、`git stash show -u --stat stash@{0}` = `README.md` + `.gitmessage` + `scratch/todo.md` + `untracked.txt`（未跟踪确实随档）；且 `git status` 仍为 `M  README.md`——keep-index 生效、暂存区保持不动） |
| F-082 | pop / apply / drop | 行内 pop → 再 apply → drop（Popconfirm） | 行为正确（pop 移除、apply 保留、drop 删除；CLI 互证） | ✅ | stash-02.png（① apply：条数不变且内容落盘；② pop：Popconfirm「确定弹出 stash@{0}？弹出后将移除该贮藏」→ 6→5 且落盘；③ drop：Popconfirm「确定删除 stash@{0}？」→ 5→4 且内容**不**入工作区；三次 CLI 逐次互证） |
| F-083 | stash as branch | 行「转分支」Modal → 执行 | 新分支出现且 stash 消费（CLI `branch` 互证） | ✅ | stash-03.png（分支名 `stash-branch-f083`；CLI：`HEAD` = `stash-branch-f083`（已检出）、该贮藏被消费（`stash list` 少一条）、工作区出现贮藏内容） |
| F-084 | Unstash As 对话框 | 行「Unstash As…」→ 选目标本地分支 → 执行 | 检出目标分支 + apply，不 drop（CLI） | ✅ | stash-04.png（选目标本地分支 → 顶部绿条「已检出 `unstash-target-2` 并应用贮藏」；CLI：HEAD = `unstash-target-2`、贮藏内容落盘、**贮藏未 drop**（条数不变））；stash-04b.png（对话框选分支过程）。注：目标分支与贮藏基点不一致时走 409 冲突提示且贮藏保留（见 §5.9 D-25 备注） |
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
| F-096 | pull（远程/分支选择、rebase 选项） | 拉取 Modal → 选远程/分支 → 勾 rebase → 拉取 | 拉取成功合入；rebase 模式生效（CLI 互证） | ✅ | pull-01.png（造分叉（本地 `d9e20e4` ahead 1 / 远端 `f1698e5` behind 1）→ 勾「使用 rebase 而非 merge」→ toast「拉取完成」；CLI：历史变**线性**——本地提交被重写为 `5f1f717` 并直接落在远端提交 `f1698e5` 之上、`rev-list --parents` 只有一个父、**未新增合并提交**）；pull-01b.png（Modal 勾选态）。**口径更正（实测）**：该 Modal **只有远端 Select**（`pull-remote-select`）+ rebase 勾选，**没有分支选择器**——分支取自当前分支的上游跟踪，行文「选远程/分支」应读作「选远程（分支随上游）」 |
| F-097 | fetch 全远程 / fetch spec 定制（通道验证） | 验证承载通道：RemotePanel 顶部 fetch 全部 + spec 定制 | 通道完成（同 remote-02 证据；本行截 RemotePanel fetch 成功态） | ✅ | pull-02.png（RemotePanel「Fetch 全部」成功态：toast「fetch 完成，更新 1 个引用」；CLI：UI fetch 建立 `origin/fetch-probe-r11` = `f1698e5`，与远端 `refs/heads/fetch-probe-r11` 同 SHA）。定制 spec 通道证据 remote-02.png / remote-02b.png（F-090） |

### 4.15 UpdateProjectDialog（slug `update`；P3，内嵌模态）

- **入口**：更多「更新项目」。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-098 | merge/rebase 策略选择 | 打开更新对话框 → 观察策略选项 | 二选一、默认 merge | ✅ | update-01.png（「更新项目」对话框：说明「更新方式（fetch 全部远程后合入当前分支）」，**merge 默认选中**、rebase 可选，并附「Reset to tracked：`rebase-topic` → `origin/rebase-topic`」说明） |
| F-099 | 更新会话（进度/结果汇总） | 执行更新 → 观察结果面板 | fetched 引用数 + pull 状态（updated 已合入/up-to-date 已最新）汇总；footer 变「关闭」 | ✅ | update-02.png（「更新结果」面板：`fetch 更新 1 个远程引用：refs/remotes/origin/rebase-topic` + 绿条「已合入当前分支」，footer 变「关 闭」；CLI：生成合并提交 `ca1efbc`（双父 `5f1f717` + `ab55a1b`），远端提交成为本地祖先）。P3 观察：结果渲染完成前有极短窗口 footer 同时存在「关 闭」与「确 定」，稳定后只剩「关 闭」，属渲染瞬时态、不计缺陷 |
| F-100 | Reset to tracked | 左下「Reset to tracked」→ Modal.confirm（danger） | reset --hard upstream、丢弃工作区/暂存（CLI）；无上游不渲染 | ✅ | update-03.png（危险确认框「Reset 到上游分支？」+「将丢弃 `rebase-topic` 的工作区/暂存变更，硬重置到 `origin/rebase-topic`；此操作不可恢复」（primary=danger）→ 确定；CLI：HEAD = `ab55a1b` = 上游、README 探针行消失、`f100-staged-probe.txt` 消失、`status` 仅剩 3 个未跟踪）。**无上游不渲染**：`rebased-smoke-big`（master 无 upstream、无远程）打开同一对话框时 `reset-to-tracked` 查无、说明也缺失 |

### 4.16 BlameView（slug `blame`；P3）

- **入口**：更多「溯源」→ `/repos/:id/blame`，页内路径输入（或 `?file=`）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-101 | 注解展示（等效行列表形态） | 打开某文件溯源 | 行列表：行号/作者/日期/内容 + hash 短名徽标 | ✅ | blame-01.png（`src/util.ts` **5 行**逐行展示：行号 + hash 短名徽标 + 作者 + 日期 + 内容；与 CLI `git blame --line-porcelain src/util.ts` **逐行一致**：行 1-3 归 `f55c880`、行 4-5 归 `86962c0`。注：本会话重写历史后 util.ts 为 5 行，旧记录的 12 行/其他 hash 已作废） |
| F-102 | 注解点击联动 | hash 徽标 → 回看后行「差异」→ 回看后行「历史」 | 徽标 → 日志 `?select=`；「差异」→ DiffPage from/to（根提交 `root=1`）；「历史」→ `/history?file=` | ✅ | blame-02.png（三条联动实测：① 行 4 hash 徽标 → `/repos/:id?select=86962c0…` 且目标行 `data-selected=true`（该图即此态）；② 行 4「差异」→ `/diff?file=src%2Futil.ts&from=199ecaf…&to=86962c0…`（from 恰为 `86962c0^`）；**根提交行**（`README.md` 行 1，`56f751a` 无父）→ `/diff?file=README.md&root=1`；③ 行 4「历史」→ `/history?file=src%2Futil.ts`） |
| F-103 | Show All Affected（受影响文件） | 行「受影响」→ Modal → 点文件 | 提交全量变更文件 Modal；文件点击 → 该文件 diff | ✅ | blame-03.png（「受影响文件（`199ecaf`）」Modal：`M README.md`、`R src/feature.ts → src/feature-renamed.ts`（renameFrom 呈现）、`A src/new-file.ts`，与 CLI `git show --name-status 199ecaf`（M/R100/A）**完全一致**；点 R 行 → `/diff?file=src%2Ffeature-renamed.ts&from=5f64516…&to=199ecaf…`） |
| F-104 | previousLineno 边界 | 抽查重命名/边界行注解 | 注解近似正确（orig 近似边界口径，抽查即可） | ✅ | blame-04.png（重命名文件 `src/feature-renamed.ts`（原 `src/feature.ts`，改名提交 `199ecaf`）溯源：4 行归因 `e03962c`（行 1、3）/`fc459ff`（行 2、4），CLI 侧 `git blame --line-porcelain` 给出 `filename src/feature.ts` 与 `previous fc459ff…`，同源；API 侧 `previousLineno` 对改动行给 1、3，未改动行为 null——近似边界口径，抽查通过） |

### 4.17 HistoryPanel（slug `history`；P3）

- **入口**：更多「历史」→ `/repos/:id/history`，页内路径输入。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-105 | 文件历史列表 | 打开某文件历史 | 条目：短哈希 + subject + 作者 + 日期 | ✅ | history-01.png（`src/util.ts` 文件历史（2）：`86962c0` / `f55c880` 各带 subject + 作者 + 日期，与 CLI `git log --format='%h \| %s \| %an \| %ad' -- src/util.ts` **逐条一致**） |
| F-106 | 重命名跟随（`--follow`） | 打开被重命名文件的历史 | 改名前的提交同样列出 | ✅ | history-02.png（`src/feature-renamed.ts` → 文件历史（3）：`199ecaf`（改名本身）+ `e03962c` + `fc459ff`（原 `src/feature.ts` 的提交），与 CLI `git log --follow` 一致；而**不跟随**的 `git log -- <path>` 只有 1 条（`199ecaf`）——跟随生效） |
| F-107 | 版本 diff 联动 | 条目点击 → 双击 → 行内「Annotate Revision」 | 点击 → 日志 `?select=`；双击 → DiffPage from/to；Annotate → `/blame?rev=` | ✅ | history-03.png（三条联动实测：① 单击条目 → `/repos/:id?select=86962c0…`；② 双击 → `/diff?file=src%2Futil.ts&from=199ecaf…&to=86962c0…`；③ 条目「Annotate」→ `/blame?file=src%2Futil.ts&rev=f55c880…` 且**真正加载该修订版本**：显示 **4 行**（= `git show f55c880:src/util.ts`），而非 HEAD 的 5 行——该图即此态） |

### 4.18 CommittedChangesPanel（slug `committed`；P3）

- **入口**：更多「已提交」→ `/repos/:id/committed`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-108 | 按提交浏览已提交变更 | 打开页面 → 观察左栏 → 分页「加载更多」 | 提交列表左栏 + 分页正确 | ✅ | committed-01.png（**图为大仓翻页后态**：`rebased-smoke-big` 的「提交列表（50）」→ 点「加载更多」→「提交列表（100）」，行数 50→100（该仓 320 提交）——分页无法用 CLI 互证，故选它做截图；主仓侧以 DOM+CLI 互证：左栏「提交列表（30）」30 条短哈希+subject+作者+日期，与 `git rev-list --count HEAD` = 30 一致，首条 `ab55a1b`、末条根提交 `56f751a`） |
| F-109 | 目录树组织变更文件 | 观察右栏目录树 | 目录节点 + A/M/D/R 徽标 + renameFrom；目录缺省展开可折叠 | ✅ | committed-02.png（选 `199ecaf` → 「变更文件（3）」：目录节点 `src` **缺省展开**，内含 `R src/feature.ts → feature-renamed.ts`（renameFrom 呈现）、`A new-file.ts`；根级 `M README.md`，与 CLI `git show --name-status` 一致。折叠实测：点 `src` 节点 → 文件行 3→1，再点恢复 3） |
| F-110 | 与 diff 查看器联动 | 点目录树文件 | 跳 `/diff?file&from=<hash>~1&to=<hash>` 两侧正确 | ✅ | committed-03.png（点 `README.md` → `/diff?file=README.md&from=5f6451617…&to=199ecaf…&files=["README.md","src/feature-renamed.ts","src/new-file.ts"]`；两侧互证：`git show 5f64516:README.md` **3 行** vs `git show 199ecaf:README.md` **5 行**（新增 `F-041 文件级暂存探针行`），页面左右两侧行数与内容一致） |

### 4.19 SearchPanel（slug `search`；P3）

- **入口**：更多「搜索」→ `/repos/:id/search`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-111 | 提交搜索（grep / pickaxe） | 双模式 Segmented 各搜一次；输入非法正则 | 结果列表正确；非法正则 → 400 提示 | ✅ | search-01.png（「信息 grep」搜 `smoke` → **18 条**，与 CLI `git log --grep=smoke` 的 18 条**逐条一致**；切「内容 pickaxe」搜 `staged new file` → 1 条 = `199ecaf`，与 `git log -S'staged new file'` 一致；非法正则 `[unclosed` → 面板红字「搜索表达式不是合法的正则表达式：[unclosed」）。**口径更新**：旧记录的 9 条与 pickaxe 词 `staged-only` 均系历史重写前的结果，现历史下分别为 18 条与 0 命中；search-01b.png（非法正则红字态）、search-01c.png（pickaxe 单条结果态，补证） |
| F-112 | 结果 → 日志页 | 点结果行 | 跳 `?select=<hash>` 且该行选中 | ✅ | search-02.png（点结果行 → `/repos/:id?select=21efcbbbcae4380b17f644d1152b6aeb859e1b6f`，目标行 `data-selected=true` 且详情面板可见） |
| F-113 | 分支快速搜索 | 输入即滤本地分支 → 点行 | 检出并回日志页（quickswitch）；当前分支仅导航（CLI） | ✅ | search-03.png（输 `diverge` → 列表即时滤为 `diverge-test` 一项 → 点击 → 回日志页且 CLI `rev-parse --abbrev-ref HEAD` = `diverge-test`（HEAD=`3b0244b`）；再点当前分支项 → 仅导航无副作用（HEAD 不变、无报错）。**夹具口径**：旧记录的 `fetch-probe-local` 在现夹具中已不存在（本地 12 分支无 `fetch-*`），故改用 `diverge-test`；冒烟后已切回 `rebase-topic`）；search-03b.png（quickswitch 落地后的日志页态，补证） |

### 4.20 ConflictsPanel（slug `conflicts`；P2）

- **入口**：`rebased-smoke-conflict` 合并/变基触发冲突自动跳入；或操作条「去解决冲突」。
- **前置**：冲突仓重新构造（master 与 feature 同区域修改）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-114 | 冲突文件列表 + 类型徽标 + 目录分组 | 观察列表 | stages 组合类型徽标正确；按目录子标题分组（带计数） | ✅ | conflicts-01.png（夹具四类冲突一次呈现：「冲突文件（4）」按「根目录（4）」分组；徽标与 `git status` 完全对应——`双方修改`=UU shared.txt/manual-merge.txt、`对方删除/我方修改`=UD deleted-by-them.txt、`双方新增`=AA both-added.txt；UD 行的「用他们的」禁用并额外提供「删除该文件」）**（R23 复跑：同一夹具四路冲突同屏，徽标与 CLI 逐条一致）** |
| F-115 | 整侧解决（ours/theirs/delete） | 行内 ours → 另文件 theirs → 另文件 delete | 对应侧禁用逻辑正确；解决后 CLI 互证 | ✅ | conflicts-02.png（shared.txt「用我们的」→ CLI 落盘 `master side`、脱离未合并；both-added.txt「用他们的」→ `feature version`；deleted-by-them.txt「删除该文件」（Popconfirm「确认以删除解决该冲突？」）→ 文件删除且暂存为 `D`；列表 4→1，`git diff --name-only --diff-filter=U` 同步收缩）**（R23 复跑：三侧解决路径均 CLI 互证，处理顺序 ours→theirs→delete）** |
| F-116 | 3-way 手动合并（MergeView） | 「手动合并」→ 全屏 Modal | 左 ours/右 theirs/底部结果编辑；保存 manual 策略（CLI） | ✅ | conflicts-03.png（「手动合并：manual-merge.txt」全屏 Modal：左「当前分支」ours=line1~3 master、右「合并来源」theirs=line1~3 feature、底部「合并结果」可编辑（Monaco）；编辑为 `line1 master / line2 feature / line3 resolved-by-hand` 后「保存」→ CLI 落盘逐行一致且该路径脱离未合并）**（R23 复跑：Modal 三栏（ours/theirs/结果）与保存落盘逐行一致）** |
| F-117 | 完成合并（continue 泛化） | 全部解决 → 「完成合并」 | merge/rebase/cherry-pick/revert 共用 continue → 回日志页（CLI） | ✅ | conflicts-04.png（冲突清零后「完成合并」可点 → 自动回日志页；CLI：生成合并提交 **`ec1320f Merge branch 'feature'`**（旧记录的 `05a16f7` 系历史重写前结果）、`.git/MERGE_HEAD` 清除、`status` 干净、四项解决结果全部保留（shared=master side / both-added=feature version / manual=手动合并内容 / deleted-by-them 仍不存在））；conflicts-04b.png（完成合并后的日志页态，补证） |
| F-118 | 跳过（skip） | rebase 冲突 → 底部「跳过」（Popconfirm） | 丢弃当前变更继续后续（CLI）；merge 无 skip 按钮 | ✅ | conflicts-05.png（变基冲突时面板底部为「跳 过」+「继续变基」；点「跳过」→ 确认框「跳过当前提交（其变更将被丢弃）？」→ CLI：`.git/rebase-merge` 清除、`feature` 落到 master 提交 `f5fdef8`、**被跳过的提交 `5271e87` 已不在历史**（`merge-base --is-ancestor 5271e87 HEAD` exit=1）、`shared.txt` 为 master 版本、工作区干净）；conflicts-05b.png（跳过确认框）。对照：F-114~F-117 的 merge 冲突态**无**「跳过」按钮（仅「完成合并」） |
| F-119 | 合并状态联动 | 观察进行中提示与操作条 | 进行中提示页内可见；中止入口在 LogPage 操作条 | ✅ | conflicts-06.png（LogPage 顶栏：橙色状态片「变基中（第 1/1 步）」+ 红色「中 止」按钮；点中止 → 确认框「确定中止当前操作？工作区将回到操作前状态」→ CLI：rebase 状态清除、分支回到 `feature`（`5271e87`）、`shared.txt` = `line3 feature`、工作区干净）；conflicts-06b.png（中止确认框）。冲突页内的提示随操作类型变化：「合并进行中：解决全部冲突后点击「完成合并」；中止请返回日志页操作条。」/「变基进行中：解决全部冲突后点击「继续变基」；…」（conflicts-01.png / conflicts-05.png） |

### 4.21 PatchPanel（slug `patch`；P3）

- **入口**：更多「补丁」→ `/repos/:id/patches`（创建也可从 StatusPage 组级入口）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-120 | 创建补丁（unified diff 三态导出） | 创建 Modal → 依次工作区/暂存/提交区间三态 | 列表出现补丁；三态内容正确（CLI 文件互证） | ✅ | patch-01.png（三态各建一枚且与 CLI **逐字节相同**：`f120-worktree` 381 B = `git diff HEAD`；`f120-staged` 166 B = `git diff --cached`（只含 `f120-staged.txt`）；`f120-range` 356 B = `git diff HEAD~2 HEAD`（`remote-side-f096`/`f099` 两个新文件）；Modal 内「工作区/暂存/提交区间」三选一，提交区间展开起点/终点输入）；patch-01b.png（创建 Modal 态） |
| F-121 | 应用补丁（check 先行） | 应用已有补丁 → 再测空补丁 | `git apply --check` 先行；应用成功；空补丁 no-op；失败诚实报错 | ✅ | patch-02.png（重置工作区后应用 `f120-worktree` → README 改动回写 + `f120-staged.txt` 复原（内容一致）；**二次应用** → toast「补丁无法应用：error: patch failed: README.md:9」且 `--numstat` 保持 1/0（check 先行、零变更）；空补丁 `f121-empty`（0 B）→ API 200 no-op、状态不变）；patch-02b.png（应用过程态） |
| F-122 | 补丁列表管理 | 观察列表 → 删除（Popconfirm）→ 重名创建 | 名/大小/时间齐全；删除成功；重名 → INVALID_QUERY 提示 | ✅ | patch-03.png（列表 5 项均带名称/大小/时间；重名建 `f120-worktree` → toast「补丁已存在：f120-worktree」且**原补丁仍 381 B**（未被截断，D-31 未回归）；「确定删除补丁 f121-empty？」→ 文件消失）；patch-03b.png（重名提示态） |
| F-123 | 导入补丁到搁置 | 行内「导入搁置」 | 成功跳 `/shelves`，同名搁置存补丁全文（CLI） | ✅ | patch-04.png（点 `f120-worktree`「导入搁置」→ toast「已导入搁置：f120-worktree」并跳 `/shelves`；CLI：`shelves/<repoId>/f120-worktree/patch.diff` 381 B，与补丁 **SHA256 相同**、首行 `diff --git a/README.md b/README.md`） |

### 4.22 ShelfPanel（slug `shelf`；P3）

- **入口**：更多「搁置」→ `/repos/:id/shelves`（保存也可从 StatusPage 页头「搁置」）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-124 | 搁置保存（工作区+暂存+未跟踪随档） | 保存 Modal 输入名 | 列表出现搁置；内容含工作区+暂存 diff + 未跟踪文件（CLI） | ✅ | shelf-01.png（保存 Modal 输入 `f124-shelf`；CLI：`shelves/<repoId>/f124-shelf/patch.diff` 381 B 与 `git diff HEAD` **逐字节相同**，`untracked/` 含 3 份原件（`.gitmessage` 52 B、`untracked.txt` 27 B、`scratch/todo.md` 45 B）；搁置语义为**快照复制**——保存后工作区保持不动）；shelf-01b.png（保存 Modal 态） |
| F-125 | 恢复 / 删除 | 行内 restore → 再 drop（Popconfirm） | 恢复回写工作区；同名冲突不覆盖；删除成功（CLI） | ✅ | shelf-02.png（**同名不覆盖两重实测**：① 工作区已有同样改动时 → 400「补丁无法应用：error: patch failed: README.md:9」（check 先行、零变更）；② 未跟踪同名文件（`untracked.txt` 被改成 `MODIFIED AFTER SHELF`）→ 恢复后**保持用户版本**、未被存档覆盖；缺失的 `scratch/todo.md` 被回拷；reset 后再恢复 → README + `f120-staged.txt` 完整回写；「确定删除搁置 f124-shelf？」→ 目录移除、列表 3→2）；shelf-02b.png（恢复确认框态） |
| F-126 | Unshelve 联动 | restore 后回 StatusPage | 工作区变更自动进入状态页（events 刷新） | ✅ | shelf-03.png（双标签实测事件刷新：标签 1 停在 `/status`（已暂存 0 / 工作区 0 / 未跟踪 3）→ 标签 0 在 `/shelves` 执行恢复 → **未刷新**标签 1 即变为 工作区（1）`README.md M` + 未跟踪（4）`f120-staged.txt`；同页 `performance.now()` ≈ 18.7 s 证明未整页重载——SSE `status.changed` 推送生效） |

### 4.23 WorktreePanel（slug `worktree`；P4）

- **入口**：更多「工作树」→ `/repos/:id/worktrees`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-127 | 工作树列表 | 观察列表 | path/branch/detached 徽标 +「当前」标记（CLI `worktree list` 互证） | ✅ | worktree-01.png（三行与 CLI `git worktree list` 逐项一致：主工作树「当前」绿标 + `rebase-topic` + `ab55a1b`；`rebased-smoke-wt` + `wt-branch` + `77e62c4`；另建分离头工作树 → 「分离」橙标 + `5c7c07a`）。P3 观感：主工作树路径显示为反斜杠 `D:\…`（来自 repo 路径），其余来自 `git worktree list` 的为正斜杠 `D:/…`，同一列表两种风格 |
| F-128 | 工作树创建 | 创建 Modal → 互斥 Radio（关联已有/新分支） | 创建成功；仓库内/嵌套路径被阻止（CLI） | ✅ | worktree-02.png（Modal：「关联已有分支 / 创建新分支」互斥 Radio（切到后者后分支输入 testid 变为 `worktree-create-new-branch`）；新建 `rebased-smoke-wt-new` + 新分支 `wt-new-branch` → toast「工作树已创建」、列表 3→4，CLI `worktree list` 与 `git branch` 均出现且目录已填充；**仓库内嵌套路径**（`…\rebased-smoke\nested-wt`）→ toast「路径无效：…」被拒且无副作用）；worktree-02b.png（Modal 态） |
| F-129 | 移除 / 清理 | 行内移除（`--force` 支持）→ prune | 移除与清理正确（CLI） | ✅ | worktree-03.png（脏工作树（README 有未提交改动）移除：不带 force → 「移除工作树失败：fatal: … contains modified or untracked files, use --force to delete it」；在确认框勾选「强制移除（--force）」→ toast「工作树已移除」、CLI `worktree list` 少一行且目录已删；手工删目录造成 prunable 条目 → 「确定清理失效工作树？」→ toast「已清理失效工作树」、`worktree list` 回到 2 行）；worktree-03b.png（确认框勾选态）。注：force 勾选框为 D-32 补的 UI 入口 |

### 4.24 SubmodulePanel（slug `submodule`；P4）

- **入口**：更多「子模块」→ `/repos/:id/submodules`。
- **前置**：主仓已 add 本地子模块。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-130 | 子模块状态列表（四态徽标） | 观察列表（含空格/点号路径） | 未初始化/已检出/提交漂移/冲突四态徽标正确（CLI `.gitmodules` 互证） | ✅ | submodule-01.png（四态**同屏**：`vendor/sub-module`「提交漂移」`0da2ac2`、`vendor/dir.with.dots`「未初始化」`17512d9`（点号路径）、`vendor/ok-sub`「已检出」`150e186`、`vendor/conflict-sub`「冲突」`00000000`；与 `git submodule status` 前缀 `+ / - / 空格 / U` 逐一对应；API 侧返回 `different-commit/uninitialized/checked-out/conflict` 四值）。**夹具为可复现构造**：`git -c protocol.file.allow=always submodule add D:\zhanglei1120\Github\smoke-sub3 vendor/ok-sub` 造「已检出」；`conflict-sub` 用两条同 base 分叉的临时分支各推一格 gitlink 后 merge 得 U（`smoke-sub3`/`smoke-sub4` 为裸仓且各 1 提交，漂移/分叉需在子模块克隆内 `commit --allow-empty` 造第二提交）。跑完已移除四态夹具并复原 `.gitmodules`/`.git/config`，`submodule status` 回到基线两行 |
| F-131 | 子模块更新（init/update） | 行内更新 → 全量（recursive Checkbox） | init/recursive 生效（CLI 互证） | ✅ | submodule-02.png（顶部「递归更新」Checkbox + 「更新全部」；行内「更 新」作用于未初始化的 `vendor/dir.with.dots` → CLI：`submodule status` 由 `-17512d9` 转为 ` 17512d9 (heads/master)`、目录出现 `.git` 与 `index.js`、`git config` 写入 `submodule.vendor/dir.with.dots.url`；勾「递归更新」+「更新全部」→ `vendor/sub-module` 由漂移 `0da2ac2` 归位 `008f798`（`+`→空格）、列表刷新为「已检出」；已冲突的 `conflict-sub` 保持 U（gitlink 冲突非 update 可解）；toast「子模块已更新」）；submodule-02b.png（勾选态）。P3 观察：「更新全部」**非乐观刷新**——服务端 4 个子模块 `git submodule update` 耗时 >3 s，期间列表仍显示旧值（POST 返回后即正确，按钮有 acting 禁用态），取证须等 POST 落地 |

### 4.25 IgnoreDialog（slug `ignore`；P3）

- **入口**：更多「忽略」→ `/repos/:id/ignore`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-132 | 创建/编辑/模板（双 target） | 双 target 切换 → 模板替换预览（Node/Python/通用）→ 保存 | `.gitignore`/`.git/info/exclude` 写入正确（CLI 文件互证） | ✅ | ignore-01.png（编辑器 Modal：双 target Radio `.gitignore` / `.git/info/exclude`、模板 Select（Node.js/Python/通用）、内容区带行号 Monaco；① `.gitignore` 目标：内容追加 `f132-probe/` 后保存 → CLI 文件尾部出现该行；② 切 `.git/info/exclude` 目标 → 内容区随之载入该文件原文（切换即换文件）→ 选 **Python** 模板 → 内容被替换为 `# Python 字节码与虚拟环境` 起始的模板 → 保存后 CLI 该文件为模板行；两 target 互不影响） |
| F-133 | 一键忽略文件/目录 | StatusPage 未跟踪行「忽略」→ Modal.confirm | 追加 `/path` 幂等；重复操作不重复写（CLI） | ✅ | ignore-02.png（状态页未跟踪行「忽略」→ 确认框「忽略文件? 将给 .gitignore 追加 /shelf-untracked-new.txt 行」→ 确定后 CLI 末行新增 `/shelf-untracked-new.txt`、该文件从未跟踪列表消失（ignore-02b.png 为确认框态）；**幂等**实测：同一路径再调一次 ignore/add → 200 且 `.gitignore` 中该行计数仍为 1） |

### 4.26 GitHubPanel（slug `github`；P3）

- **入口**：更多「GitHub」（仅 github.com 形态远程才渲染；无 → 行 F-134 验证检测门后其余按跳过处理）。
- **前置**：F-136~F-139 需真实 github.com 远端 + PAT（Settings 账户卡片录入）；不具备 → 跳过+理由。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-134 | 检测门（远程形态才渲染） | 在非 github 仓看「更多」→ 再看 github 远程仓 | 非 github 仓不渲染该项；github.com 远程仓渲染 | ✅ | github-01.png（`rebased-smoke-clone` 加 github.com 远程后，「更多」菜单出现「GitHub 面板」（17 项）；主仓（本地 file 远程）菜单 16 项、**无**该项（github-01b.png）；`GET …/github/status` 返回 `{detected:true, repo:{owner:'example', name:'rebased-smoke', remoteUrl:'https://github.com/example/rebased-smoke.git'}}`） |
| F-135 | 账户/token 认证 + 降级卡 | 打开面板（无令牌）→ 观察 → Settings 账户卡片录 PAT | 检测三态（远程+令牌）正确；无令牌 → 提示卡「去设置」；录 PAT 后回面板重检测 | ✅ | github-02.png（无令牌：卡「GitHub 认证失败 / 未配置 GitHub 令牌，请在设置中添加」+「去设置」；服务端 `GET …/github/prs` → 401 `AUTH_FAILED` 同文案）→ 点「去设置」→ 设置页「添加账户」（主机 `github.com` + 令牌）→ 「账户已保存」，账户行显示脱敏 `smok***` → 回面板**重检测**：卡片变为「GitHub 认证失败：Bad credentials」（说明令牌已被读取并真的打到 github.com，失败点从「未配置」前移到凭据本身）。冒烟后已删除该临时账户。注：卡片文案首轮为固定「令牌无效或已过期」，与无令牌实况不符，为本轮修复项 D-33） |
| F-136 | PR 列表/详情/时间线/评论 | 真实远端 → 列表点击选中 → 详情 + 时间线 tab → 发评论 | 时间线 issue comments + review summaries 合并（旧→新）；空评论拦截 | 跳过：需**真实 github.com 仓库 + 有效 PAT**（本机无可用凭据；夹具远程 `example/rebased-smoke` 不存在，录假 PAT 后 github 返回 `Bad credentials`）。PR 列表/详情/时间线/评论的端点与映射由 api/github 单测覆盖 | — |
| F-137 | PR 审查（approve/request changes） | 详情内审查 | reviewDecision 徽标正确 | 跳过：同 F-136（需真实 PR 与写权限 PAT） | — |
| F-138 | PR diff 视图 + 行级评论 | 文件行级视图 → 逐 hunk 观察 → 行级评论（新侧行号 Select + 发送） | 逐 hunk 两侧 MonacoDiffView + 绝对行号头行；评论线程按 hunk 挂靠并落地 | 跳过：同 F-136；HunkDiffView 的 hunk 解析/行级挂靠由 ui（github-panel.test.tsx）与 api 单测覆盖 | — |
| F-139 | 三种合并策略 + 检出 PR 分支 | merge/squash/rebase 各测 → 检出 PR | 三策略合并正确（warning 路径）；检出 = fetch `+refs/pull/N/head` + `checkoutNewBranch('pr-N')`（CLI） | 跳过：同 F-136。检出通道的 git 侧（`fetchRemote` 带 `+refs/pull/N/head` → `FETCH_HEAD` 指向目标提交）已在 core 单测实测（见 F-090 定制 refspec 同源能力） | — |

### 4.27 GitLabPanel（slug `gitlab`；P4）

- **入口**：更多「GitLab」（仅 gitlab.com 形态远程才渲染）。
- **前置**：F-141~F-144 需真实 gitlab.com 远端 + PAT；不具备 → 跳过+理由。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-140 | 检测门 + 账户认证 | 非 gitlab 仓 vs gitlab 远程仓入口；无令牌降级卡 | 检测门与降级卡同 GitHub 口径 | ✅ | gitlab-01.png（`rebased-smoke-big` 加 gitlab.com 远程后菜单出现「GitLab 面板」；无令牌 → 「GitLab 认证失败 / 未配置 GitLab 令牌，请在设置中添加 / 去设置」——与 GitHub 同口径，文案同样取自服务端 message（D-33 修复后）） |
| F-141 | MR 创建/列表/详情/评论 | 新建 MR Modal（源/目标分支 + 标题 + 描述）→ 列表四徽标 → 详情时间线 → 评论 | 各环节正确；时间线 notes+reviews 合并 | 跳过：需**真实 gitlab.com 项目 + 有效 PAT**（同 F-136 边界；夹具远程 `example/rebased-smoke` 不存在）。MR 端点与 notes/reviews 合并映射由 api/gitlab 单测覆盖 | — |
| F-142 | MR diff 视图 + 行级讨论 | 行级视图 → 行级讨论（position new_path/new_line） | 与 GitHub 共用 HunkDiffView；讨论锚点与提交落地 | 跳过：同 F-141；共用 HunkDiffView 的渲染由 ui 单测覆盖 | — |
| F-143 | MR 审查 / 合并 | approve/request changes → merge（squash?） | 三映射端点正确；reviewState 徽标；合并成功 | 跳过：同 F-141 | — |
| F-144 | MR 检出 | 检出 MR | fetch `refs/merge-requests/:iid/head` + `checkoutNewBranch('mr-N')`（CLI） | 跳过：同 F-141。检出通道的 git 侧已由 core 单测实测（`fetchRemote` + `refs/merge-requests/:iid/head`，见 gitlab.ts 同款调用） | — |

### 4.28 GitConsole（slug `console`；P3）

- **入口**：更多「控制台」→ `/repos/:id/console`。
- **前置**：先执行若干 git 操作（含带 `-c`/extraheader 的远程操作）再进入。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-145 | git 命令输出展示（环形缓冲 + token 剥离） | 打开控制台 → 观察列表 → 刷新 | 列表（时间/args/退出码/耗时/stderr 尾）齐全；`extraheader` 明文不存在（token 剥离） | ✅ | console-01.png（先跑若干操作再进页面：每行含 时间 + args + 退出码 + 耗时 + 失败行的 stderr 尾（如 `fetch authed2` 行显示 `128 | 1.3 s | fatal: Cannot prompt because user interactivity has been disabled…`）；**token 剥离**：配置 127.0.0.1 令牌后执行带认证注入的 fetch，条目中不含 `extraheader` 字样、页面文本不含 token 明文。注：首轮页面恒「暂无命令记录」，为本轮修复项 D-34） |
| F-146 | 输出折叠（`-c key=value`） | 观察含 `-c` 的条目 | 整对参数折叠为 `-c …` 占位 | ✅ | console-02.png（所有含 `-c` 的条目均显示为 `--no-pager -c … <子命令> …`：`status --porcelain=v2 -z --branch`、`for-each-ref --format=…`、`worktree list --porcelain` 等；API 原始 args 中 `-c` 与 `core.pager=cat` 成对存在，仅 UI 呈现折叠 + 敏感对整体剥离） |

### 4.29 QuickActionsMenu（slug `quick-actions`；P2+，等效聚合）

- **入口**：LogPage 顶栏按钮区（独立组件明确不做，等效 = 顶栏 5 按钮 + 更多菜单 18 项 + OperationStatus 操作条）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-147 | 分支快捷弹窗（等效 = 顶栏「分支」） | 顶栏「分支」→ 分支页 | 等效承载可达（同 branch-01 证据；本行截顶栏入口态） | ✅ | quick-actions-01.png（LogPage 顶栏入口态；点顶栏「分支」（`button[aria-label="分支"]`）→ 直达 `/repos/:id/branches`（等价承载可用）；分支页功能证据见 branch-01/02.png（F-062 起）） |
| F-148 | 操作聚合（等效 = 顶栏 + 更多菜单 + 操作条） | 展开顶栏按钮区 + 更多菜单 | 5 按钮 + 18 项全量入口聚合在位（同 log-page-14/15 证据；本行截聚合展开态） | ✅ | quick-actions-02.png（同屏聚合：顶栏动作按钮 撤销最近提交/变更/分支/合并/贮藏（另 首页/设置/更多 工具位）+ 「更多」展开 17 项——溯源/历史/已提交/搜索/变基/标签/拉取/推送/更新项目/远程管理/补丁/搁置/控制台/忽略/GitHub 面板/工作树/子模块；菜单项随宿主检测增减：无托管远端 16 项、github.com 远程 17 项、gitlab.com 远程 17 项，故 18 为含两种托管面板的全集上限）+ 操作进行中时的 LogPage 操作条（见 conflicts-06.png） |

### 4.30 SettingsPage（slug `settings`；P1/P2）

- **入口**：顶栏「设置」→ `/repos/:id/settings`（key=repoId 切仓强制重挂载）。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-149 | 应用设置读写 | 切 logInEditor 开关 → 刷新后仍保持；观察 recentRepoIds 生效 | 应用设置持久化正确 | ✅ | settings-01.png（「在编辑器中查看提交日志」开关 true→false → 刷新页面仍为 false；CLI：`config.json` → `settings.logInEditor=false`；同卡片「界面主题」Segmented 与 recentRepoIds（8 条）均生效——首页最近仓库列表即其消费方，见 repo-page 行） |
| F-150 | git 配置白名单 9 键读写 | ConfigRow 逐行：生效值 + local 覆盖输入 + 保存 | 保存写仓库配置成功（CLI `git config` 互证）；含 gpgsign/signingkey/commit.template | ✅ | settings-02.png（「Git 配置（仓库级）」9 行：user.name/user.email/core.autocrlf/pull.rebase/commit.gpgsign/user.signingkey/commit.template/fetch.prune/init.defaultBranch，每行显示生效值 + 覆盖输入 + 保存）；写入实测：`core.autocrlf` 填 `input` → 保存成功 → CLI `git config --local --get core.autocrlf` = `input`；值未变化时保存按钮保持禁用（如 commit.template 已是 `.gitmessage`） |
| F-151 | 账户/令牌管理 | 添加/覆盖 host+account+token → Popconfirm 删除 | 列表正确；token 仅掩码不下行；配置文件 0600（CLI 文件互证） | ✅ | settings-03.png（添加 `example.com` + 令牌 → 列表 `example.com \| smoke-f151 \| toke***`——**仅掩码**；同名再存 → 仍只一条（覆盖更新）；Popconfirm「确定删除账户 smoke-f151（example.com）？」→ 删除后「暂无账户」、`config.json` accounts 归零）。权限：`config-store` 每次写盘 `chmodSync(file, 0o600)`（POSIX）；Windows 下 ACL 仅 SYSTEM/Administrators/当前用户（无 Everyone），等价收敛 |
| F-152 | 集中存储（config-store） | 修改任一应用设置 → 重启服务 → 复查 | 配置集中于 config-store 持久化（口径由单测锁定，页面验证持久化即可） | ✅ | settings-04.png（**真重启**实测：切主题为「明亮」→ `data-theme=light`、body `#ffffff` → 杀掉 `pnpm dev` 并重启新进程 → 重新打开设置页仍为亮色（`data-theme=light`、body `rgb(255,255,255)`）；CLI 复查 `config.json`：theme=light / logInEditor=true / patterns=0 / repos=8 全在。冒烟后已还原 theme=dark） |
| F-153 | git 可执行文件检测/引导 | 观察「Git 可执行文件」卡片 | PATH 查找 `git` + 版本输出 + 已检测徽标 | ✅ | settings-05.png（卡片：`已检测` 徽标 + `git（PATH 查找）` + `git version 2.47.0.windows.2`；未检测态引导文案由 `resolveGitExecutableInfo` ok=false 分支承载（api 单测覆盖）） |
| F-154 | GPG 专属配置对话框 | 「GPG 提交签名」卡片 → 「配置…」Modal → 勾选 + 密钥下拉 | 状态行正确；密钥下拉列 secret keys；无密钥 → Alert 禁启用；取消勾选仅写 false 不清 key（CLI config 互证） | ✅ | settings-06.png（卡片状态行「未启用 / commit.gpgsign 为 false/未设置」；Modal：启用勾选框 + 密钥下拉 + 说明「配置与 git config 同步（commit.gpgsign / user.signingkey）」；本机无 gpg 密钥 → Alert「未找到可用的 gpg 密钥…」且**勾选框与密钥下拉均禁用**。CLI 实测「取消勾选仅写 false 不清 key」：先设 gpgsign=true + signingkey=DEADBEEF1234 → `PUT settings/gpg-config {enabled:false}` → 返回 `{enabled:false, key:'DEADBEEF1234'}`，CLI `commit.gpgsign=false` 而 `user.signingkey` 保留；冒烟后已清掉该临时 key） |
| F-155 | 保护分支设置 | 卡片输入正则列表（含一个非法正则）→ 保存 | 非法标红禁保存；合法保存成功；联动：已发布到匹配远程分支的提交编辑 → 「不可重写」拦截提示 | ✅ | settings-07.png（① 输入含 `[unclosed` → 卡片内红字「非法正则：[unclosed」且「保 存」禁用（settings-07b.png）；② 改为 `main`+`master` → 保存成功，CLI `config.json` → `protectedBranchPatterns = main, master`；③ **联动实测**：对已推送到 `origin/master` 的提交 f47f36d（命中 `master` 规则）右键 → Reword Commit → 填新信息确定 → 拦截提示「目标提交已推送到受保护分支，不可重写」（settings-07c.png 为右键菜单态），CLI 复核该提交哈希与 subject 分毫未变。冒烟后规则已清空） |

### 4.31 BrowsePanel（slug `browse`；P4）

- **入口**：LogPage 详情面板「浏览快照」→ `/repos/:id/browse?rev=<hash>`。

| 编号 | 功能点 | MCP 冒烟操作（模拟人工） | 预期最终正确效果（截图判定） | 结果 | 截图 |
|------|--------|--------------------------|------------------------------|------|------|
| F-156 | 文件树浏览（目录聚合 + 初始一层展开） | 打开快照浏览 → 观察文件树 → 展开目录 | `ls-tree -r` 聚合：目录在前字母序、初始一层展开；子模块/符号链接仅徽标 | ✅ | browse-01.png（`?rev=master`：文件（17）——目录 `assets/docs/src/vendor` 在前且字母序，随后根级文件；目录初始一层展开；四个 gitlink 以「子模块」徽标呈现（`conflict-sub/dir.with.dots/ok-sub/sub-module`）；根提交 `?rev=3236538` 对照 CLI `ls-tree -r` 的 3 个文件（`README.md`、`docs/gone.md`、`docs/old-name.md`）完全一致） |
| F-157 | 文件内容只读查看 | 点文本文件 → 再点二进制文件 | 该版本内容正确展示（`git show <rev>:<file>`）；二进制（含 NUL）仅提示不渲染 | ✅ | browse-02.png（点 `README.md` → 右栏渲染该版本内容（`# Rebased Smoke … sign-off 冒烟行 …`）与 `git show master:README.md` 一致；点 `assets/logo.bin`（含 NUL）→ 仅提示「二进制文件，不支持文本预览」，不渲染乱码；API `browse/content` 返回 `{content, binary}`，二进制以 `binary` 标志交由 UI 抑制渲染） |
| F-158 | 降级边界 | 无效 rev → 路径越界 → 空版本 | 无效 rev → INVALID_REF 提示；越界 → INVALID_QUERY；空版本空态 | ✅ | browse-03.png（① 无效 rev `deadbeef…` → 页面红字「无效的 ref：deadbeef…」，API 400 `INVALID_REF`；② 路径越界 `../../secret.txt` 与绝对路径 `C:\Windows\win.ini` → 均 400 `INVALID_QUERY`「非法的文件路径」；③ 未输入 rev → 空态「输入 ref 开始浏览快照 / 以该提交为根只读浏览文件树，不触碰工作区」；空仓 `rebased-smoke-init` 的 `rev=HEAD`（unborn）→ 诚实报「无效的 ref：HEAD」） |
| F-159 | 入口与导航边 | 详情面板「浏览快照」→ 回日志页 | 入口与回边均可用（边 #22） | ✅ | browse-04.png（日志页详情面板（`?select=92794979…`）→ 点「浏览快照」→ `/browse?rev=92794979530b4e1ecff513d1a2fdd807f44f816f`（文件（13），树即该提交快照）→ 点「返回日志」→ 回 `/repos/:id`（无残留参数）） |

---

## 五、执行记录与缺陷登记

> 按 AGENT.md §冒烟测试记录规范回填：① 范围清单逐项 ✅/❌/跳过+理由；② 操作路径（点击/输入序列）；③ 证据（浏览器状态 + CLI 输出互证）；④ 未覆盖项与后续计划。

| 轮次 | 日期 | 执行范围（F-xx…） | 结果汇总（✅/❌/跳过） | 缺陷登记（根因/修复/复验） |
|------|------|-------------------|------------------------|----------------------------|
| R1 | 2026-09-10 | F-001~F-028（RepoPage 8 + LogPage 20）、F-029~F-031（DiffPage 3）；暗黑/明亮双主题与 1440/768/480 三档宽度抽查 | ✅ 30 / 跳过 1（F-025） | D-01~D-12 全部修复并复验，见下表 |
| R2 | 2026-09-10 | F-032~F-038（DiffPage 7）+ F-039~F-051（StatusPage 13）+ F-052~F-058（CommitDialog 7） | ✅ 27 / 跳过 0.5（F-056 的 gpg 分支） | D-14~D-17 修复并复验（见 §5.4）；夹具纠偏 P-06~P-10（见 §5.5） |
| R3 | 2026-09-10 | F-059~F-061（ResetDialog 3）+ F-062~F-068（BranchPanel 7） | ✅ 10（ResetDialog 3/3、BranchPanel 7/11） | D-19~D-21 修复并复验（见 §5.4）；F-069~F-072 待续 |
| R4 | 2026-09-10 | F-069~F-072（BranchPanel 余下 4 行）+ F-073~F-075（MergeDialog 3 行） | ✅ 7（BranchPanel 11/11、MergeDialog 3/3 收官） | D-22 修复并复验（见 §5.7）；远端分叉/新分支由 rebased-smoke-other 克隆构造；冲突仓停在 merge 冲突态供 F-114~F-119 复用 |
| R5 | 2026-09-10 | F-076~F-080（RebaseDialog 5 行：onto/交互式 todo/continue·skip·abort/auto-squash/单提交编辑四动作） | ✅ 5（RebaseDialog 5/5 收官） | D-23 修复并复验（见 §5.8）；夹具纠偏 P-11（右键定位竞态） |
| R6 | 2026-09-11 | F-081~F-085（StashPanel 5 行：save 三选项 / pop·apply·drop / 转分支 / Unstash As… / 查看差异） | ✅ 5（StashPanel 5/5 收官） | D-24（贮藏冲突无理由提示）、D-25（「查看差异」弹窗正文恒空白）修复并复验（见 §5.9）；环境说明 E-01（Next dev 代码框多字节 panic） |
| R7 | 2026-09-11 | F-086~F-088（TagPanel 3 行：创建轻量/附注、删除本地/远程、推送单个/全部） | ✅ 3（TagPanel 3/3 收官） | D-26（缺省远程未解析：删除远程 500 ssh 空 host）、D-27（推送单个 500 且远程类动作无成功回执）修复并复验（见 §5.10）；夹具：file:// 裸远端 `D:\zhanglei1120\Github\smoke-remote` |
| R8 | 2026-09-11 | F-089~F-092（RemotePanel 4 行：远程 CRUD / fetch 三形态 / shallow·unshallow / 401 认证回路） | ✅ 4（RemotePanel 4/4 收官） | D-28（审计声称既有、实际缺失的 fetch refspec 与 unshallow 入口）、D-29（解除浅克隆后徽标不刷新）修复并复验（见 §5.11）；F-092 用本地恒 401 服务（`http://127.0.0.1:9418`）触发真实认证回路 |
| R9 | 2026-09-11 | F-093~F-100（PushDialog 3 + PullDialog 2 + UpdateProjectDialog 3：推送/上游设置/强推/被拒自动更新；拉取与 rebase；更新策略·结果汇总·Reset to tracked） | ✅ 8（三页各自收官：push 3/3、pull 2/2、update 3/3） | 本轮无新缺陷；夹具：由 `rebased-smoke-other` 推送远端侧提交制造分叉与领先态，`rebase-topic` 经 F-093 建立上游（后续需要「无上游」形态时改用 rebased-smoke-big） |
| R10 | 2026-09-11 | F-101~F-104（BlameView 4 行：注解列表 / 三联动 / 受影响文件 / previousLineno 边界）+ F-025 补测（认证重试回路，用本地 401 服务解除原「跳过」） | ✅ 5（BlameView 4/4 收官；LogPage 20/20） | 本轮无新缺陷；每行均与 CLI（`blame`/`blame --line-porcelain`/`show --name-status`）逐项互证 |
| R11 | 2026-09-11 | F-105~F-110（HistoryPanel 3 + CommittedChangesPanel 3：文件历史 / --follow 跟随 / 版本 diff 联动；提交浏览与分页 / 目录树 / diff 联动） | ✅ 6（两页各自收官：history 3/3、committed 3/3） | 本轮无新缺陷；F-108 分页在 321 提交的大仓实测 50→100；P3 观察（不改）：溯源/历史页的页内路径输入不回写 URL（`?file=` 仅作入口深链），刷新后回到入口态 |
| R12 | 2026-09-11 | F-111~F-113（SearchPanel 3 行：grep/pickaxe 双模式与非法正则、结果→日志、分支快速搜索） | ✅ 3（SearchPanel 3/3 收官） | D-30（非法正则抛内部 `git log` 命令行原文给用户）修复并复验（见 §5.12）；两模式结果均与 CLI 逐条互证 |
| R13 | 2026-09-11 | F-114~F-119（ConflictsPanel 6 行：冲突列表与徽标 / 整侧解决 / 3-way 手合并 / 完成合并 / 跳过 / 状态联动与中止） | ✅ 6（ConflictsPanel 6/6 收官） | 本轮无新缺陷（说明见 §5.12.1）；夹具重建为一次性呈现 AA/UD/UU 四路冲突 + rebase 冲突，每步均与 CLI 互证 |
| R14 | 2026-09-11 | F-120~F-126（PatchPanel 4 + ShelfPanel 3：补丁三态创建/应用/列表管理/导入搁置；搁置保存/恢复与删除/事件联动） | ✅ 7（两页各自收官：patch 4/4、shelf 3/3） | D-31（补丁重名静默覆盖，把既有补丁截断为 0 字节）修复并复验（见 §5.13）；F-126 用双标签页实测 SSE 事件驱动刷新 |
| R15 | 2026-09-11 | F-127~F-129（WorktreePanel 3 行：列表徽标 / 创建与路径校验 / 移除·强制移除·清理） | ✅ 3（WorktreePanel 3/3 收官） | D-32（脏工作树在 UI 上无法移除：缺 `--force` 入口）修复并复验（见 §5.14） |
| R16 | 2026-09-11 | F-130~F-133（SubmodulePanel 2 + IgnoreDialog 2：四态徽标与更新 / 双 target 编辑与模板 / 一键忽略幂等） | ✅ 4（两页各自收官：submodule 2/2、ignore 2/2） | 本轮无新缺陷；子模块四态夹具由 `protocol.file.allow=always` 新增子模块 + 两侧分叉 gitlink 合并构造 |
| R17 | 2026-09-11 | F-134~F-135（GitHubPanel 检测门 + 账户认证降级卡）、F-140（GitLabPanel 同口径）+ F-136~F-139 / F-141~F-144 边界核实 | ✅ 3 / 跳过 8（缺真实托管仓库与 PAT） | D-33（认证降级卡文案与实况不符：无令牌却提示「令牌无效或已过期」）修复并复验（见 §5.15）；github.com 经假 PAT 实测可达（返回 `Bad credentials`） |
| R18 | 2026-09-11 | F-145~F-146（GitConsole 2 行：命令记录展示与 token 剥离、`-c` 成对折叠） | ✅ 2（GitConsole 2/2 收官） | D-34（执行日志缓冲为模块级 Map，dev 下路由间不共享 → 控制台恒空）修复并复验（见 §5.15） |
| R19 | 2026-09-11 | F-147~F-148（QuickActions 等效聚合 2 行：顶栏分支入口、顶栏+更多菜单+操作条聚合） | ✅ 2（QuickActions 2/2 收官） | 本轮无新缺陷；菜单项数随宿主检测（16/17 项，18 为含两种托管面板的上限）已在行内说明 |
| R20 | 2026-09-11 | F-149~F-155（SettingsPage 7 行：应用设置读写 / git 配置 9 键 / 账户令牌 / config-store 重启持久化 / git 可执行文件 / GPG 配置 / 保护分支与联动拦截） | ✅ 7（SettingsPage 7/7 收官） | 本轮无新缺陷；F-152 真杀进程重启后复查，F-155 用「已推送提交 Reword」实测联动拦截 |
| R21 | 2026-09-11 | F-156~F-159（BrowsePanel 4 行：文件树 / 只读查看与二进制 / 降级边界 / 入口与回边） | ✅ 4（BrowsePanel 4/4 收官） | 本轮无新缺陷；树与内容均与 `ls-tree -r` / `show <rev>:<file>` 互证，越界与绝对路径均被 `INVALID_QUERY` 拦下 |
| R22 | 2026-09-11 | **全站流体布局与密度几何验收**（非 F-xx 功能行）：六档宽度 × 明暗 × 24 路由 + 6 个状态（含 GitHub/GitLab 展开差异、认证/重置弹窗、EllipsisText 浮层）+ 两条例外断言；web-koa 对等抽查 | ✅ 576/576 格（web-next 384 + web-koa 192） | 修复前基线 375/384：`stashes` 行在 360/480 顶宽（`scrollWidth 492 > clientWidth 360/480`）→ 该行加 `wrap`；另 4 格为断言测量竞态（已修断言）。见 §5.16 |
| **R23** | **2026-09-12** | **全量重跑**：按 §1.3 用 `scripts/smoke-setup.ps1` 复位重建全部冒烟仓后，从 F-001 起按矩阵顺序重跑；本轮已完成 **F-001~F-131**（截至 §4.24：RepoPage 8 / LogPage 20 / DiffPage 10 / StatusPage 13 / CommitDialog 7 / ResetDialog 3 / BranchPanel 11 / MergeDialog 3 / RebaseDialog 5 / StashPanel 5 / TagPanel 3 / RemotePanel 4 / PushDialog 3 / PullDialog 2 / UpdateProjectDialog 3 / BlameView 4 / HistoryPanel 3 / CommittedChangesPanel 3 / SearchPanel 3 / ConflictsPanel 6 / PatchPanel 4 / ShelfPanel 3 / WorktreePanel 3 / SubmodulePanel 2），截图全量重拍 | ✅ 128 / ❌ 2（F-020、F-066）/ ⏭ 1（F-056 的 gpg 分支，template 部分 ✅） | **D-39**（`refs.changed` 后 chips 不刷新）、**D-40**（「清理已合并（N）」计数与执行集不一致）、**D-41**（并发下 `.git/index.lock` raw 报错透出，P3）、**D-42**（配置 BOM 化 → 全站 400 且文案误导，P2）为本轮新登记缺陷（均未修复，转交）；另记流程/夹具纠偏 **P-12~P-24**（见 §5.17） |

**收官复核（R21 末）**

- **主题**：明亮主题下复核本轮新增页面——冲突页/子模块/快照浏览/补丁/工作树（`theme-light-conflicts.png`、`theme-light-submodules.png`、`theme-light-browse.png`、`theme-light-patches.png`、`theme-light-worktrees.png`），均 `data-theme=light` + body `#ffffff`、无暗色残留；连同 R1 的 `theme-light-log/diff/settings.png` 覆盖三类渲染面（列表 / Monaco / 表单）。复核后已切回暗色。
- **响应式**：768 与 480 两档复核日志页与设置页（`responsive-768-light-log.png`、`responsive-480-light-log.png`、`responsive-768-light-settings.png`）——顶栏按钮与过滤行按 `flex-wrap` 折行、提交主题省略号截断、详情面板纵向堆叠，`documentElement.scrollWidth` 均未超出视口（无横向滚动）。
- **截图账目**：`docs/shots/` 共 183 张，文档引用 175 个文件名**全部存在**；跨文件 SHA256 无重复；无未被引用的孤儿截图。

**全量收官（R21 末）**：159 行 F-001~F-159 = ✅ 150 / 跳过 9（F-136~F-139、F-141~F-144 共 8 行缺真实托管仓库与 PAT；F-056 的 gpg 分支）；31 个页面全部走到收官状态。缺陷累计 D-01~D-34（全部修复并复验）+ 环境说明 E-01。

### 5.16 R22 全站流体布局与密度六档验收（Task 16，2026-09-11）

> 本轮不按 F-xx 功能行冒烟，而是对「全站流体布局与密度统一」重构做**几何验收**：六档宽度 × 明暗两主题 × 每个页面与状态，逐格断言页面级横向溢出为 0。入口：`scripts/check-fluid-layout.mjs`（Playwright 驱动，先 `pnpm dev` 起真实服务）。
> 被测端：web-next `http://localhost:3030`（六档 × 明暗）、web-koa `http://localhost:5173`（其 SPA 固定暗色，故只跑暗色）；夹具：既有主冒烟仓 `rebased-smoke`（id `18726c5c-f4b2-499d-ac82-6eac8f46ec26`，`sub-b @ 4f27441`，23 提交、2 stash、2 tag、2 shelf、2 worktree、2 submodule），**未**重建夹具。
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
| 例外①：browse / log 两栏在 `collapseBelow` 以下纵向堆叠且各占满宽度、以上左右并排 | 同上（双向断言） | ✅ |
| 例外②：Monaco 内容宽于编辑器和宿主不溢出 + 拖动其横向滚动条内容真位移 + 页面级仍为 0 | 同上 | ✅ |
| web-koa 对等抽查（全部 24 路由 + 6 个状态，暗色） | 360 / 480 / 768 / 1024 / 1440 / 1920 | ✅ **192/192 格**（**Fix round 3 用当前脚本** `node scripts/check-fluid-layout.mjs --app=koa` 整轮重跑：0 格溢出、0 格重试、0 格未测量。早先那个 192/192 出自 Fix round 1 的脚本，与这次不是同一把尺子 —— 见 ③） |
| **跳过**：conflicts 页的「冲突行」状态 | — | 跳过：需仓库停在冲突态；本轮不动共享夹具（用户可能正在使用），空态已断言。后续用 `rebased-smoke-conflict` 现造冲突态补测 |
| **跳过**：Monaco 在 1440/1920 档的「内部横向滚动」 | — | 非跳过而是否定式通过：该两档长行放得下（内容 889px ≤ 编辑器 937px），断言按分支记 pass（本档无需内部滚动） |
| **按路由的密度断言**（终修新增，`assertDensity()`）：每格文本的**主导**基准字号 = 该路由的密度归属 —— compact **12px**，只有设置页 **14px** | 同上（与溢出断言同一时刻、同一页面状态取样） | ✅ **384/384 格**（同一整轮；`/merge`、`/diff`、`committed` 三处本轮修复的路由均在其中，逐格实测见 ③ 的密度记账）。**这条断言此前不存在**：`/repos/:id/merge` 曾整条路由没有密度归属、以 antd 默认 14px 渲染，而当时的 576 格溢出矩阵**全绿** —— 溢出为 0 与密度正确是两件独立的事，这是唯一能看见后者的断言 |

> **两条 Modal 格的口径（重要，勿按字面读成「弹窗内容也不溢出」）**：本轮的断言对象始终是 `document.documentElement.scrollWidth`。antd v6 的 `.ant-modal-wrap` 是 `position: fixed; overflow: auto` —— **弹窗内部的横向溢出被这层包裹容器自己吃掉**，不可能增长文档滚动宽；测量助手在列越界元素时也刻意跳过 `position: fixed` 的元素（浮层是「页面之外」的一层，不参与文档级判定）。因此这两格能证明的只有「**弹窗打开时它背后的页面**没有横向溢出」，**不能**证明「弹窗自己的内容没有横向溢出」。后者的度量对象应是 `.ant-modal-wrap` / `.ant-modal` 自身的 `scrollWidth vs clientWidth`，本轮未做，已列入 ④ 未覆盖项。

#### ② 操作路径（点击/输入序列）

1. `pnpm dev`（web-next :3030 / web-koa API :3031）+ `pnpm --filter @rebased/web-koa dev:web`（SPA :5173）；三个端口启动前均为空闲，无需 kill。
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

#### 缺陷登记（本轮新增；D-35~D-37 已修复 + 复验，D-38 是本轮**观察到但未修复**的产品瞬时态，已转交）

| 编号 | 现象 | 根因 | 修复 | 复验 |
|------|------|------|------|------|
| D-35 | **web-koa 冷启动 `/repos/:id` 整页空白**（`document.body.innerText` 为空、无任何 `data-testid`），React 控制台报「Rendered more hooks than during the previous render」；web-next 同页正常。该缺陷让本轮 6 个 koa 断言格（日志页及其派生的 `?select=`/`?compare=`/三处弹窗状态）无法渲染 | `apps/web-koa/src/pages/repo.tsx` 里「跨仓库复位」`useEffect` 被放在 `if (!status) return null;` **之后**：首帧 `status` 未就绪走提前 return（少调一个 hook），次帧 status 到达后补上该 hook → hook 数不等即崩。文件内注释本就写着「必须注册在下方任何提前 return 之前」，说明是位置被写反了；web-next 的同构容器是 hook 在前、return 在后 | 把 `if (!status) return null;` 移到该 `useEffect` **之后**（与 web-next 容器对齐），并就地补注释说明为何不能再挪回去。该 hook 的复位值与首帧初值逐一相同（`select ?? null` / `null` / `false` / `''` / `50`），故首帧多跑一次无行为变化 | 复跑 koa 六档全量：`192/192` 通过，日志页与三处弹窗状态均正常渲染；web-next 侧六档日志页本就通过（`384/384`） |
| D-36 | 贮藏页在 360/480 两档、明暗两主题下出现**页面级横向滚动**：实测 `scrollWidth 492 > clientWidth 360 / 480`，越界元素是该行 5 个操作按钮（`Unstash As…` / `查看差异` / `删除` 等） | `stash-panel.tsx` 的行是「Tag + 消息(flex:1) + 日期 + 5 个按钮」的**不换行**横排：按钮组不可收缩，窄视口下整行内容超出卡片宽度并外泄为文档级横向滚动 | 行容器 `Flex` 加 `wrap`（只交出换行能力，宽视口一行放得下时视觉不变，与 `Toolbar` 同一口径） | 复跑六档 × 明暗：`stashes` 六档全部 `scrollWidth == clientWidth`（360/480 由 492 降为 360/480）；`wrap` 只在放不下时生效，故 768 及以上各档（修复前本就通过）行为不变 |
| D-37 | **视觉回归**（重构引入）：`Tooltip > Button type="link"` 作为 `PageShell` 直接子项时被拉伸到**整行宽**、文字居中（实测 1440 档按钮宽 1440px、`justify-content:center`），悬停/下划线区域横贯整行；原先是紧凑的左对齐链接 | `PageShell` 刻意不设 `alignItems`（这正是「横向沾满」的修法），纵向 Flex 的交叉轴是水平方向，未显式声明 `alignSelf` 的子项即被拉伸 | 在两个 app 共 **38 处**调用点就地写 `style={{ alignSelf: 'flex-start' }}`（web-next **19** + web-koa **19** = 首轮 36 处（各 18）+ Fix round 1 补的 `ignore` 页 2 处，两侧对称；github/gitlab 页里那两对按钮在 `<Flex gap={8}>` 内，不受影响、保持原样），**不改 `PageShell` 契约** | 截图 `link-stretch-1440-console-before.png`（拉伸态、文字居中）↔ `responsive-1440-console.png`（修复后紧凑左对齐），并复跑全量断言确认无横向溢出 |
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

#### 缺陷

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-39 | **`refs.changed` 事件到达后，提交行的 ref chips 不刷新**——F-020：`git branch tmp-refs` 后等待 15s+，顶部行 chips 仍为 `f019-probe master`，`tmp-refs` 始终不出现；整页重载后立刻出现（log-page-12b.png）。用户新建/删除分支、拉取产生新远程分支时，日志页的 chips 会一直停在旧值，直到手动刷新 | 服务端正常：`curl -N /api/repos/:id/events` 实收 `{"type":"refs.changed","payload":{"refs":["refs/heads/tmp-refs"]}}`，`GET …/log` 的该行 `refs` 也含 `tmp-refs`。问题在容器：`apps/web-next/app/repos/[repoId]/page.tsx` 的 `onRefs` 只做 `mutateLog()`（重验证 REST 快照键）+ 全局重验证 branches 键；而实际渲染的列表来自 `mergeLogCommits(pageCommits, streamCommits, streamConnected)`（`apps/web-next/src/log-merge.ts`）——**「先流后快照按 hash 合并，同 hash 取流」**，即已由 log/stream 送达的那一行永远以流侧旧 `refs` 为准，快照重验证拿不回这一行。只有 `onStatus`（HEAD 变化）会 `setRefreshKey` 重订阅流，才顺带把 refs 刷新 | **本轮未修复**（属他人正在演进的分页/流式链路，冒烟轮次不动产品代码）：建议修法二选一——① `onRefs` 也 `setRefreshKey(k=>k+1)` 重订阅 log/stream；② `mergeLogCommits` 在「快照侧存在同 hash 行且其 refs 与流侧不同」时以快照侧 refs 覆盖流侧（快照是新取的，流侧是旧的） | 复现路径：日志页 → `git branch tmp-refs` → 观察 15s（chips 不变）→ 整页刷新（chips 立刻含 `tmp-refs`）。已用 `curl` 服务端帧 + `GET /log` 载荷交叉确认非服务端问题；`log-page-12.png` 为失败态、`log-page-12b.png` 为重载后正确态 |
| D-40 | **「清理已合并（N）」的 N 与真正删除的集合不一致：承诺 2 个、实删 3 个，且整条操作以 raw git 报错收场、成功回执从不出现**——F-066：存在「已合并 + 被 worktree 检出」的本地分支时，按钮与确认框说「清理已合并（2）」「清理 2 个已合并分支？不可恢复」，确定后先删掉 2 个候选，再对 worktree 占用分支执行 `git branch -d` → 红色 toast「git 命令失败：git branch -d wt-merged-probe 退出码 1：error: cannot delete branch 'wt-merged-probe' used by worktree at '…'」；因整条 promise 抛错，「已清理 N 个已合并分支」的回执**从未出现**，用户看到「删了 2 个却只收到一条 raw git 报错」，无法判断剩余候选是否还会被删 | **D-20 只修了面板计数、没修容器执行集**，两处口径分叉：`packages/client/ui/src/composite/branch-panel.tsx:521` 的计数含 `b.checkedOutInWorktree !== true`；而 `apps/web-next/app/repos/[repoId]/branches/page.tsx:121` 与 `apps/web-koa/src/pages/branches.tsx:119` 的 `targets = branches.branches.filter((b) => !b.remote && b.mergedIntoHead && !b.current)` **没有该条件** | **本轮未修复**（冒烟轮次不动产品代码）。建议：两个容器的 `targets` 过滤器补上 `&& b.checkedOutInWorktree !== true`（与 ui 计数同源），或把候选计算上移到 ui 层由回调传出唯一集合，避免「计数与执行各算一遍」 | 复现：`git worktree add <tmp> -b wt-merged-probe 761961d`（761961d 已合并入 master）→ 分支页「清理已合并（2）」→ 确定 → 见上述报错；CLI `git branch --merged HEAD` 当时为 feature/master/merged-branch/wt-merged-probe。证据 `branch-05.png`。探针 worktree 与分支已删除、夹具已复原 |
| D-41 | **并发写入时把 git 的 `index.lock` 原始报错直接抛给用户**（P3，偶发）：应用自身的 watcher/状态轮询与界面触发的 git 写操作并发时，接口返回 500，前端 toast 显示 `Unable to create '<repo>/.git/index.lock': File exists.`——用户既看不懂也不知道该重试 | 写操作为「读-改-写」式独占索引操作，与后台轮询/事件监听里的 git 调用争抢 `.git/index.lock`；错误按未知错误原样透出（无重试、无中文映射） | **本轮未修复**（P3）：建议对写操作加短退避重试（如 50ms×3）或把该错误映射为可读提示（「仓库正忙，请重试」） | 本轮命中 1 次（F-071 首次「检出并变基到当前」的初次触发），**重试即成功**；同一会话内其余写操作未复现 |
| D-42 | **配置文件被写入 BOM 后，全站 `/api/*` 一律 400「请求体不是合法 JSON」、页面只剩空白 + dev 覆盖层**（本轮实测事故：18:49:22 的 `config.json` 被外部写成 UTF-8 带 BOM，18:53 起 web-next 全线不可用，直到剥离 BOM 才恢复）。错误文案把**服务端内部**的 JSON 解析失败说成**客户端请求体**问题，用户与排障者都会被引偏；且页面没有任何降级提示 | 两处叠加：① `packages/server/api/src/lib/config-store.ts:50` 的 `JSON.parse(readFileSync(file, 'utf8'))` **不剥离 BOM**——Node 以 utf8 读出的首字符是 `U+FEFF`，`JSON.parse` 直接抛 `SyntaxError: Unexpected token '\uFEFF'`（该文件自己写盘用的是 `writeFileSync(..., 'utf8')`，**不产 BOM**，故只有外部工具写坏才触发）；② `apps/web-next/src/server-context.ts:18` 与 `apps/web-koa/src/server-context.ts:18` 把**任何** `SyntaxError` 一律映射为 400 `INVALID_QUERY`「请求体不是合法 JSON」，内部异常被伪装成客户端问题，所有依赖配置的端点共用该出口 → 全站 400 | **本轮未修复**（P2）：建议 ① `loadConfig` 读入后先 `text.replace(/^\uFEFF/, '')`（容错外部编辑），② 把 400 映射限定在「解析请求体」这一处（例如把 `req.json()` 的失败包成显式的 RequestBodyError 再映射），其余 `SyntaxError` 不再吞成 400 而按 500 + 可读提示处理 | 复现：给 `config.json` 加 3 字节 BOM（PowerShell 5.1 的 `Set-Content`/`Out-File`/`ConvertTo-Json \| Set-Content` 默认带 BOM）→ 访问任意页面或 `/api/settings` → 400 同文案、页面空白。**取证方法警示**：PowerShell 的 `ConvertFrom-Json` **容忍 BOM**，用 PS 自检会误判「JSON 正常」，须用 `node -e "JSON.parse(require('fs').readFileSync(p,'utf8'))"` 或直接查首字节。事故副本保留为 `~/.rebasedjs/config.bom-broken-20260912.json`（8359 B = 正常 8356 B + 3 B BOM），剥离 BOM 后原样写回即恢复 |

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

#### 本段夹具与断点（R23，2026-09-12）

- **主冒烟仓（重建后新 id）**：`rebased-smoke` → repoId `f761a9f6-5c91-4115-9261-69715687e875`（`D:\zhanglei1120\Github\rebased-smoke`；R23 起 id 与旧轮次不同：F-002 的「移除→重开」会重新分配 id，旧 `18726c5c-…` 已作废）。
- 其余 id（重建后仍按路径复用）：`rebased-smoke-conflict` `82168d54-…`、`rebased-smoke-big` `7649bb35-…`、`rebased-smoke-shallow` `450e90ca-…`、`rebased-smoke-noident` `b908870c-…`、`rebased-smoke-init` `9918c699-…`、`rebased-smoke-clone` `9b0168bb-…`、`rebased-smoke-wt` `aa675a60-…`、`rebased-smoke-huge` `f40d0c37-…`。
- `scripts/smoke-setup.ps1` 本轮已扩写（供后续轮次一键复现 §1.3 + 扩展夹具）：新增 ① 分叉分支 `diverge-test`（commit-tree 造，`master...diverge-test` = `1 1`）；② 冲突仓改为「四路冲突夹具、交付干净态」（合并 `feature` 到 `master` 即得 AA/UD/UU/UU，供 F-075/F-114~F-117）；③ 大仓 `hunks.txt`（40 行，改第 5/35 行 → 2 hunk 常驻工作区）与 `big.txt` 工作区改写（620 行大 diff 常驻，修掉 P-06/P-10 两处缺口）。**注意**：该脚本为 UTF-8 **带 BOM**（PowerShell 5.1 读中文必需），改动后务必保留 BOM。

### 5.15 R17 缺陷登记（已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-33 | GitHub/GitLab 面板的认证降级卡文案与实况不符：**从未配置过令牌**时也提示「令牌无效或已过期，请到设置中重新配置。」——服务端 `prs` 明确返回「未配置 GitHub 令牌，请在设置中添加」，两处口径矛盾，用户被误导去排查「过期」 | 两端容器把 AUTH_FAILED 一律渲染成固定说明文案，丢弃了服务端 message（该 message 已区分「未配置令牌」与「令牌无效/认证失败」两种成因） | 容器改用服务端 message 作为 description（`prsError.message`，空则回落原通用文案），保留「去设置」动作 | 复跑 F-135：无令牌 → 卡显示「未配置 GitHub 令牌，请在设置中添加」（github-02.png）；录入假 PAT 后重检测 → 卡显示「GitHub 认证失败：Bad credentials」（成因切换正确）。F-140 同口径复核 GitLab 侧（gitlab-01.png） |
| D-34 | Git 控制台页恒显示「暂无命令记录」——无论此前在界面里执行多少 git 操作（状态页/分支页/远程 fetch 等），列表始终为空；同进程的 `/api/repos/:id/console` 也返回 `[]` | core 的执行日志缓冲是**模块级** `Map`（`execLogByCwd`）；Next dev（Turbopack）为每个路由单独产出 chunk、模块注册表彼此独立 → 「A 路由跑的 git 命令」写进 A 的 Map，「控制台路由」读的是自己那份空 Map，两者永不相见（生产单进程语义下才会共享） | 缓冲改为挂在 `globalThis`（`Symbol.for('rebased.core.execLogStore')` 键）的进程级单例，`touchExecLogCwd`/`recordExec`/`getExecLog` 统一经 `execLogStore()` 取用；LRU 上限与逐条语义不变 | 复跑 F-145/F-146：跑一次 `/status`+`/branches` 后 `/console` 立即返回 10 条记录（此前恒 `[]`），页面列表齐全（时间/args/退出码/耗时/stderr 尾）且 `-c` 成对折叠、token 无明文（console-01.png / console-02.png）；core exec 用例 17/17 通过（含 LRU 淘汰与 limit 截断） |

### 5.14 R15 缺陷登记（已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-32 | 工作树内有未提交改动时，行内「移除」只会失败：toast「移除工作树失败：fatal: '…' contains modified or untracked files, use --force to delete it」——界面**没有任何 force 入口**，用户被卡住只能去终端；而 F-129 明确要求「行内移除（`--force` 支持）」 | 后端链路早已支持 force（契约 `worktreeRemoveBodySchema.force`、api/core 透传 `git worktree remove --force`），但 ui 层当年按「force 仅终端使用」的裁定只传单参 path，容器也未接 force——能力在最后一跳断掉 | ui `WorktreeRow` 的移除确认框增加「强制移除（--force）」勾选框（默认不勾，安全默认不变；`data-testid=worktree-force-<path>`），`onRemove(path, force)`；web-next 与 web-koa 容器透传 `{ path, force: force === true }` | 复跑 F-129：不加 force → 明确报错且工作树保留；勾选 force → toast「工作树已移除」、CLI `worktree list` 少一行、目录已删（worktree-03.png/03b.png）；ui 用例由「单参不携带 force」改为「默认 onRemove(path,false)」+ 新增「勾选后 onRemove(path,true）」，worktree-panel 16/16 通过 |

### 5.13 R14 缺陷登记（已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-31 | 用已存在的名字创建补丁时**不报错也不提示，直接覆盖**——冒烟中把已有 334 B 的 `f120-range` 覆盖成 0 字节（当时工作区恰好无变更），既有存档内容就此丢失——F-122 期望「重名 → INVALID_QUERY 提示」 | api `createPatch` 按注释即为「同名覆盖更新」：`writeFileSync` 无条件写入，无重名预检；而同层搁置（shelf save/import）与标签（tag create）均已在重名时抛 `INVALID_QUERY`「…已存在」，补丁为唯一例外 | `createPatch` 先判 `existsSync(<name>.patch)` → `ServiceError('INVALID_QUERY', '补丁已存在：<name>')`（沿搁置 `搁置已存在` 约定；空 diff 照常创建 0 字节文件的行为保持不变） | 复跑 F-122：同名创建 → toast「补丁已存在：f120-worktree」且原补丁字节数不变（patch-03.png）；api 用例由「同名覆盖」改写为「重名创建：INVALID_QUERY 且原补丁内容分毫不动」，patch 用例 14/14 通过 |

### 5.12 R12 缺陷登记（已修复 + 复验）

#### 5.12.1 R13 执行说明（ConflictsPanel，无新缺陷）

- **夹具**：`rebased-smoke-conflict` 重建为「一次呈现四类冲突」：基底含 `shared.txt`/`deleted-by-them.txt`/`manual-merge.txt`（→ UU/UD），`both-added.txt` 不入基底（两侧各自新增 → AA）；master 侧改为 master 版内容、feature 侧改为 feature 版并删除 `deleted-by-them.txt`，`git merge --no-edit feature` 得到 `AA/UD/UU/UU` 四路冲突。
- **rebase 侧**：另造「master 与 feature 改同一行」的分叉 → `git rebase master` 得 UU 冲突，用于 F-118 跳过与 F-119 中止。
- **观察（不改）**：手动合并 Modal 内 Monaco 会在并发计算差异被中断时向控制台打 `no diff result available` / `Canceled: Canceled`，Next dev 浮层因此亮起「1 Issue」角标；编辑与保存功能不受影响（本轮实测保存内容逐行正确）。这是 Monaco worker 生命周期噪声（dev 浮层可见性放大），非产品缺陷。
| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-30 | 提交搜索输入非法正则（`[unclosed`）后，界面直接显示内部命令行原文：「git 命令失败：git log --grep=[unclosed -i --format=%H%x00… --max-count=50 退出码 128：fatal: command line, '[unclosed': Unmatched [ or [^」——用户看不懂，且暴露服务端命令细节——F-111 | api `searchCommitsService` 本意是把非法正则映射为 `INVALID_QUERY`，但判定依赖 stderr 含英文串 `Invalid regular expression`；git 对本例的措辞是 `Unmatched [ or [^`，判定失配 → 落到 GIT_ERROR（500）原样透出 | api 层在调用 git 之前用 JS `new RegExp(q)` 预校验（`mode==='grep'`；pickaxe 为 `-S` 字面量语义，不校验），非法即 `INVALID_QUERY`「搜索表达式不是合法的正则表达式：<原文>」；同时把 stderr 特征串兜底扩为多种措辞（`Invalid regular expression`/`Unmatched [`/`Unmatched (`/`bracket expression`/`Invalid range end`），覆盖 JS 接受而 POSIX ERE 拒绝的写法 | 复跑 F-111：同一输入 → 面板红字「搜索表达式不是合法的正则表达式：[unclosed」（search-01b.png）；合法模式不受影响（grep `smoke` 9 条、pickaxe `staged-only` 1 条，均与 CLI 一致，search-01.png）；api 用例改为双写法（`[`、`[unclosed`）+ 新增「pickaxe 不校验、按字面量返回空结果」，7/7 通过 |

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
| D-12 | 窄屏（≤768）挤压：顶栏仓库名折行、过滤行「标签」文字被压成竖排 | 顶栏/过滤行无 `flex-wrap`，标签文本无 `nowrap` | 顶栏与过滤行加 `flexWrap: 'wrap'`、仓库名与标签文本加 `whiteSpace: 'nowrap'`、首页路径行加 `wrap` 且输入框 `flex:1;minWidth:200` | 1440/768/480 三档截图（responsive-768-log.png、responsive-480-log.png、差异页同档 responsive-768-diff.png）复核不再折行/竖排 |
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
### 5.8 R5 缺陷登记（已修复 + 复验）
| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-23 | 对「位于合并提交之下」的历史提交执行单提交编辑（drop/squash/fixup/reword）→ 整页跳冲突页但**无任何冲突**，仓库卡在半程 rebase：`.git/rebase-merge` 残留且 todo 非法（`error: 'pick' does not accept merge commits` + `invalid line 4`），用户无法继续也无法理解原因——F-080 | `editCommitAction` 用 `git rebase -i` + 自备 todo 重放区间内全部提交，一律写 `pick`；区间含合并提交时 git 拒绝 `pick <merge>`，而失败发生在 rebase 启动之后 | core 抽出 `editCommitBase`（基计算口径唯一）与 `hasMergeCommitInRange`（`git log --merges <base>..HEAD`）；api `commitEdit` 在动手前判定并抛 `INVALID_QUERY`「目标提交区间内含合并提交…单提交编辑暂不支持」 | 修复前：报错 + 半程状态（实测）；修复后：同一动作给出明确中文提示且仓库分毫未动（HEAD/状态/无 `.git/rebase-merge`）；api 新增用例「区间含合并提交 → INVALID_QUERY 且不留半程 rebase 状态」 |

### 5.9 R6 缺陷登记（已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-24 | 贮藏「应用/弹出」遇冲突时只弹一句「退出码 1」，不说明原因、不指出冲突文件；工作区已被写入冲突标记，用户既不知发生了什么也不知该动哪些文件（pop 遇未跟踪文件同名时更只报 `crlf.txt already exists, no checkout`）——F-082/F-084 路径 | api `stashAction`/`unstashAs` 直接透传 core 的 `GitExitError`，冲突（apply 非零退出但已落冲突标记）与普通 git 失败混为一类，只带退出码 | api `stash.ts` 新增 `runStashRestoreGuarded`：捕获后先查 `git diff --name-only --diff-filter=U`，有冲突文件 → `CONFLICT(409)`「应用贮藏产生冲突：<路径列表>」；否则 `GIT_ERROR` 并附 git 首行可读原因（去掉 `退出码 N` 噪声） | 复跑贮藏冲突场景：toast 显示中文冲突提示与文件路径（此前为 `[object Object]`，已随 `.map(c => c.path)` 修正）；api stash 用例 13 通过（新增冲突/非冲突分流断言）；正常路径不受影响（F-084 成功路径绿条「已检出 unstash-target 并应用贮藏」） |
| D-25 | 贮藏行「查看差异」弹出 Modal 后**正文恒为空白**（无补丁、无 loading、无错误），且全程不发任何 `GET …/stashes/:index/diff` 请求——F-085 首轮实测 | `StashPanel` 自持 `diffIndex` 局部状态（点击行 → `setDiffIndex` 开窗），而容器另有一份 `diffIndex` 状态才驱动 `useStashDiff` 条件拉取；两份状态互不相通，容器那份永远是 `null` → 弹窗开着但没人拉数据，`stashDiff/diffLoading/diffError` 全为空故渲染 `null` | ui 层改为受控：`StashPanelProps` 增加 `diffIndex`/`onOpenDiff(index)`/`onCloseDiff()` 并删除面板内自持状态；web-next 与 web-koa 两个容器均传 `diffIndex={diffIndex}` `onOpenDiff={setDiffIndex}` `onCloseDiff={() => setDiffIndex(null)}`（拉取键与开关状态同源） | 复跑 F-085：`GET /api/repos/…/stashes/1/diff` 200，Modal 内 `stash-diff-text` 全文补丁与 CLI `git stash show -p stash@{1}` 逐行一致（stash-05.png）；ui 用例重写为「点击只回传下标（未持有 diffIndex 时不开窗）→ 回填后 loading → patch → error → 关闭按钮回传容器」并新增「未传 onOpenDiff 时不渲染按钮」 |

**环境说明**

| 编号 | 现象 | 处置 |
|------|------|------|
| E-01 | 冒烟中 Next dev server（16.2.7 Turbopack）曾整体崩溃：Rust panic `end byte index 93 is not a char boundary`（`next-code-frame/src/highlight.rs:1011`）——为**含中文的源码行**渲染 500 错误代码框时按字节切分多字节字符 | 与产品代码无关（dev-only 报错渲染路径）；重启 `pnpm dev` 后恢复。副作用：崩溃/重启期间浏览器标签的 HMR 连接损坏，页面只剩 SSR 外壳（`.ant-app` 无子节点、`body.innerText` 为空），表现为「白屏但接口全 200」——**处置：关闭标签重新导航**即可（另注：用 `127.0.0.1:3030` 访问时 HMR WebSocket 握手失败，须用 `http://localhost:3030`） |

### 5.10 R7 缺陷登记（已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-26 | 标签行「删除远程」确认后整条操作失败：`git push :refs/tags/v9.9.9-smoke 退出码 128：ssh: connect to host  port 22: Connection refused`——对端标签纹丝不动，用户看到一条连「空主机」的 ssh 报错——F-087 | 删除远程标签走 `git push :refs/tags/<name>`（push 空 ref）。远程名只在调用方显式给出时才拼进参数，而 UI 三个按钮一律不传 `remote`，于是 git 收到单个参数 `:refs/tags/<name>` 后按「位置参数 = 仓库地址」解析，把它当成 URL（空 host）去连 ssh | core 新增 `defaultRemoteName`（分支 `branch.<name>.remote` → 约定 `origin` → 唯一远程，解析不到给可读中文错）；`deleteRemoteTag` 改用 `git push <remote> --delete refs/tags/<name>`（显式远程 + `--delete` 语义，不再依赖位置参数猜测）；api `resolveRemote` 统一解析并交给 `withAuth`（认证注入同样需要远程名），无远程 → `INVALID_QUERY`「仓库未配置远程…」 | 复跑 F-087：确认框后 toast「已删除远程标签 v9.9.9-smoke」，`ls-remote --tags origin` 清空而本地标签保留（tag-02.png）；core 新增 3 用例（缺省解析删除成功／无远程可读报错／`defaultRemoteName` 三级回退）、api 新增 2 用例（UI 真实调用形态删除成功／无远程 → INVALID_QUERY） |
| D-27 | 标签行「推送」确认后 500：`git push refs/tags/v9.9.9-smoke 退出码 128：fatal: 'refs/tags/v9.9.9-smoke' does not appear to be a git repository`（当前分支无上游时必现）；另外「推送」「推送全部」「删除远程」成功后界面**毫无反馈**——本地列表本来就不变，用户无法判断是否生效——F-088 | 同 D-26 的「远程名未解析」根因（`pushTag`/`pushAllTags` 同样只在显式传 remote 时才拼远程名），只是报错形态不同；反馈缺失则是两个容器只注册了失败提示（`message.error`），远程类动作没有成功回执 | core `pushTag`/`pushAllTags` 同样经 `requireDefaultRemote` 解析（推送到分支上游或 origin）；api `resolveRemote` 复用于 push/pushAll/deleteRemote；web-next 与 web-koa 容器对 `push`/`pushAll`/`deleteRemote` 增加成功回执（「标签推送完成：x」「全部标签推送完成」「已删除远程标签 x」） | 复跑 F-088：单推 → toast「标签推送完成：v9.9.9-smoke」且 `ls-remote` 仅该标签；「推送全部」→ toast「全部标签推送完成」且 `ls-remote` = v1.0 + v9.9.9-smoke（tag-03.png）；core 新增 2 用例（无上游分支缺省推送成功／无远程可读报错）、api 新增 1 用例（无上游 + 不传 remote 推送成功） |

### 5.11 R8 缺陷登记（已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-28 | 审计文档称「远程 CRUD（含 fetch spec/unshallow）」且「unshallow 经 fetch 端点既有」，实际全链路皆无入口：契约 `fetchBodySchema` 只有 `remote`、api 不透传 refspec/unshallow、ui 无任何定制 spec 或解除浅克隆控件——F-090 的「定制 spec」与 F-091 的「unshallow 后徽标消失」在界面上无从触发 | core `fetchRemote` 本就支持 `refspec`；但契约→api→client→ui 四层未打通，审计按 core 能力误记为产品能力 | 契约 `fetchBodySchema` 增 `refspec`（非空）与 `unshallow`；api `fetchRepo` 透传两者并在「给 refspec 未给远程」时抛 `INVALID_QUERY`（refspec 与 `--all` 互斥）；core `fetchRemote` 支持 `--unshallow`（未点名远程时按 `defaultRemoteName` 解析，与 D-26 同源口径）；ui RemotePanel 增「定制 Fetch…」Modal（远程 Select + refspec 输入，缺回调不渲染）与「解除浅克隆」按钮 | F-090：定制 refspec `+refs/pull/9/head:refs/remotes/origin/pr-9` → CLI 建立 `origin/pr-9` 且与远端 `refs/pull/9/head` 同 SHA（remote-02.png/02b.png）；F-091：CLI `is-shallow-repository` true→false、提交数 1→17（remote-03.png/03b.png）；用例：contracts +3（schema 接受/拒绝）、core +2（unshallow 成功/无远程可读报错）、api +3（定制 refspec、refspec 缺远程 → INVALID_QUERY、unshallow 后 shallow 翻转为 false）、ui +4（定制 Modal 回调与禁用态、解除按钮回调与缺省隐藏） |
| D-29 | 「解除浅克隆」执行成功（CLI 已 `is-shallow-repository=false`）后，页面橙色「浅克隆（历史截断）」徽标与按钮**仍在**，需刷新页面才消失——F-091 期望「unshallow 后消失」 | fetch 响应体本就带回 fetch 后的 `shallow` 状态，但两个远端页容器只把结果做成 toast，未回写 `useRemotes` 缓存；而仪表盘式徽标数据源正是该缓存的 `shallow` 字段（远程配置本身不产 watcher 事件，等不到自动重验证） | web-next 与 web-koa 容器取用 `useRemotes` 的 `mutate`，在 fetch/定制 fetch/unshallow 成功后以响应体的 `shallow` 回写缓存（`revalidate: false`，不再多发一次请求） | 复跑 F-091：点击后徽标**即时**消失、按钮随条件卸载（remote-03.png），CLI 同步 false；再次造浅克隆复现前置态仍显示徽标（remote-03b.png） |
| — | **P3 说明（非缺陷，本轮登记不改）**：401 认证重试回路（AuthDialog + upsertAccount + 重放）目前只在日志页容器装配；远程管理页的 fetch 遇 401 时仅弹「认证失败，请配置该主机的访问令牌」提示（可去设置页存令牌后重试），不弹 AuthDialog。F-092 按行内路径（日志页「拉取」）验证通过，此处记为后续统一装配的 P3 缺口 | | | |

### 5.7 R4 缺陷登记（已修复 + 复验）


| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-22 | 「force-push 修复」中途失败：`git cherry-pick … 退出码 1：The previous cherry-pick is now empty`，本地分支卡在重放中途并遗留 `.git/sequencer` 停态（用户看到一条 raw git 报错，仓库处于半修状态）——F-070 | 重放走通用 `cherryPickCommits`（git 缺省 `--empty=stop`）：本地独有提交里存在空提交（`--allow-empty` 占位提交，本例为 F-055 造的两笔空提交）时，git 在首个空提交处中止整条重放 | core `cherryPickCommits` 增加 `opts.keepEmpty`（`--empty=keep`）；api 新增 `replayLocalCommits`（跳过祖先预检 + keepEmpty）供 force-push 修复专用；交互式摘樱桃保持缺省（用户摘空补丁提交应见错误而非静默造空提交） | 修复前实测：报错 + 遗留 sequencer；修复后同一场景 → toast「已重置并重放 4 个本地提交」，CLI：远端提交成为基、0/4、工作区干净、无 sequencer（branch-09.png）；api 新增用例「强推修复：本地独有提交含空提交时仍完整重放」 |
### 5.6 R3 缺陷登记（全部已修复 + 复验）

| 编号 | 现象（冒烟行） | 根因 | 修复 | 复验 |
|------|----------------|------|------|------|
| D-19 | 「仅看已合并」把远程分支整组隐藏（显示 0/2、无匹配的远程分支），而 CLI `git branch -r --merged HEAD` 明确列出 origin/feature 与 origin/master——F-062 | core `mergedBranchNames` 只查本地（`git branch --merged`），api `toBranchRef` 又把远程分支硬编码 `mergedIntoHead:false` | core 增加 `git branch -r --merged` 查询并合并结果（远程项为全名）；api 去掉远程排除，按名单统一判定 | 表格：本地 6/7、远程 2/2；远程行亦出现已合并绿勾（branch-01/02.png）；core 新增用例「mergedBranchNames 含已合并的远程跟踪分支」 |
| D-20 | 「清理已合并（1）」承诺可清理，点击后整条操作失败：`git branch -d wt-branch` 退出码 1「cannot delete branch 'wt-branch' used by worktree」——F-066 | 候选集只排除当前分支，未排除被 worktree 检出的分支（git 必然拒绝） | 契约 `BranchRef.checkedOutInWorktree`；api 经 `listWorktrees` 标记；ui 清理候选排除该标记 | 复跑：按钮变「清理已合并（0）」且禁用（branch-05.png）；api 新增用例「getBranches 标记 checkedOutInWorktree」、ui 新增用例「清理候选排除 worktree 占用的已合并分支」 |
| D-21 | BranchPanel「与工作树差异」打开的文件 diff 显示 0 处差异，与 CLI `git diff wt-branch -- src/app.ts`（17 处新增）相悖——F-068 | api `getFileVersions` 的 from-only 分支被并入「工作区模式」并写死左侧 `HEAD`，忽略 `from`（仅 from+to 成对时才用 from） | from-only 左侧改取 `query.from`（`query.from ?? 'HEAD'`），保持 from/to 成对分支不变 | API：before 7 行 / after 24 行（此前两侧同内容）；页面 17 处新增与 CLI 一致（branch-07.png）；api 新增用例「from-only（分支 vs 工作树）：左侧取指定分支而非 HEAD」 |
### 5.5 R2 夹具纠偏
| P-11 | 提交行右键菜单：先用 `boundingBox()` 取坐标再 `mouse.click`，因日志流（SSE）重排导致落点偏移到相邻行，误判「右键目标错位」为产品缺陷 | 改为对行 locator 直接 `click({ button: 'right' })`（原子动作，自动滚动与定位）；复测确认同一行右键 → Reword 弹窗预填该行信息（UI 侧本就一致） |
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
