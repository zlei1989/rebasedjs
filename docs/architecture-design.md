# Rebased.js 架构现状

- **日期**：2026-09-21（现状记录，随架构变化更新）
- **性质**：分层、边界、约定与规则。功能覆盖现状、剩余任务与决策不在本文件，见下方现状索引。
- **参照系**：[Rebased](https://github.com/DetachHead/rebased)（Java/Kotlin 版，`D:\zhanglei1120\Github\rebased`）是功能与交互的唯一参照；逐项核对证据与复刻终态见盘点报告，本文件不重复。

**现状索引**：

- 功能复刻盘点（36 功能域 / 31 页面 / 端点与契约终态）：`docs/pages-and-api-audit.md`
- 剩余任务（1 可选 + 2 预留错误码）与「明确不做」决策清单：`docs/pages-and-api-audit.md`
- P1 验收证据：`docs/verification/`

---

## 1. 总体架构

### 1.1 分层总览

```text
┌──────────────────────────────────────────────────────────┐
│  apps/（框架层 — 两个薄下游应用，只做组装）                   │
│   web-next（Next.js）          web-koa（Koa.js）           │
│   页面壳 + 路由转调服务层        路由/中间件 + 静态托管 SPA    │
└────────────────┬─────────────────────┬────────────────────┘
                 │ 路由里面引用功能服务层
┌────────────────▼─────────────────────▼────────────────────┐
│  packages/server（服务端核心，零框架依赖）                    │
│   core       git CLI 原语层（进程执行 + 输出解析）           │
│   api        功能服务层：一个功能一个文件                    │
│   contracts  契约：zod schema + 类型 + 错误码 + SSE（跨端共享）│
└──────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────┐
│  packages/client（客户端核心，框架无关 React）                │
│   ui         纯展示组件（base/domain/composite + graph-layout）│
│   client     数据层：SWR hooks + SSE 订阅 hooks             │
└──────────────────────────────────────────────────────────┘
```

### 1.2 目录结构

```text
rebasedjs/
├── apps/
│   ├── web-next/            # 下游应用①：Next.js 16（App Router）
│   │   ├── app/layout.tsx   # SSR 壳（antd ConfigProvider、深色主题默认、全局 chrome）+ providers
│   │   ├── app/repos/[repoId]/  # 22 个功能子页面（client components 组装 ui + client）
│   │   └── app/api/**       # Route Handlers：校验→调 api→错误映射（103 个 route.ts）
│   └── web-koa/             # 下游应用②：Koa.js
│       ├── src/app.ts       # koa 组装：路由 + 中间件 + 静态
│       ├── src/routes/      # 端点注册（与 web-next 完全对称）
│       ├── src/middleware/  # 错误处理、body 解析、SSE 流、静态资源
│       ├── src/pages/**     # SPA 页面（react-router，22 子页面 + repo 主页面，路径与 web-next 一致）
│       └── public/          # Vite 构建产物（打包同一套 ui + client）
├── packages/
│   ├── server/
│   │   ├── core/      # git CLI 原语层：30+ 模块，零框架依赖
│   │   ├── api/       # 功能服务层：src/ 下一个功能一个文件
│   │   └── contracts/ # 跨端契约：domain/endpoints/errors/sse/unified-diff/patch/host
│   └── client/
│       ├── ui/        # base/domain/composite 组件分层 + graph-layout/（纯函数布局引擎）
│       └── client/    # 每功能域一个 hook 文件 + http.ts 底座 + events.ts SSE 订阅
├── docs/              # 本文件 + pages-and-api-audit.md（盘点与任务终态）+ verification/（验收证据）
└── eslint.shared.ts   # 共享规则 + withBoundary 分层边界规则
```

包名（npm scope）：`@rebased/web-next`、`@rebased/web-koa`、`@rebased/api`、`@rebased/core`、`@rebased/contracts`、`@rebased/ui`、`@rebased/client`。

### 1.3 依赖方向（单向，eslint 硬约束）

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

**关键取舍**：`ui` 必须是纯客户端 React（禁用 RSC 专属 API），同一套组件被 Next.js（SSR 壳 + client components）与 Koa 托管的 Vite SPA 共享；`contracts` 物理上放 `packages/server/` 下但逻辑上跨端共享（eslint 仅对 server 侧包施加"禁框架"约束）。

---

## 2. 分层规则

### 2.1 core —— git CLI 原语层

**职责**：与 git 进程打交道（进程执行 + 输出解析），不掺业务。是 `api` 的唯一能力来源。

**统一约定**：

- spawn 永远传参数数组（杜绝 shell 注入）、强制 `--no-pager -c core.pager=cat`、`LC_ALL=C`；
- 超时/取消：`AbortSignal` → 杀进程树（Windows 用 `taskkill /T`），退出码与 stderr 结构化（`GitExitError`）；
- 全部解析走 `-z`（NUL 分隔）或自定义分隔符，文件名含空格/换行/中文均安全；
- 流式取消语义统一：`streamGit` 与 `runGit` 同为 aborted-flag 模式；close 时 aborted 一律 reject `GitExitError`(130)；消费者 break 时 try/finally 杀子进程并清理监听器；已中止 `signal` 预检；
- 测试用**真实 git CLI + 临时仓库 fixture**（建仓模板复制 0-spawn，见 §4.2），不 mock git；纯解析函数补单测；
- 不用 simple-git（流式能力弱、长命令可控性差），自封装 `spawn` 直接可控。

**模块清单**（30+ 模块，按域分组）：

| 域 | 模块 | 职责 |
|----|------|------|
| 进程 | `exec` | spawn 执行 git、`GitExitError`、命令日志 execLog（LRU 淘汰）、git 可执行文件解析 |
| 仓库 | `repo` | 仓库发现（向上找 `.git`）、`init`/`clone` |
| 状态与引用 | `status` | `status --porcelain=v2 -z --branch` 解析 |
| | `refs` | 引用快照与差异（`refs.changed` 指纹） |
| | `operation` | 进行中操作检测（rebase-merge/apply 状态与步进）、中止 |
| 历史与内容 | `log` | 流式 `log --graph`：自定义 `--format` 分隔符 + NUL，逐条产出 `GraphLine`；分页/过滤/range |
| | `history` | 文件历史（`%P` 父哈希、重命名跟随） |
| | `blame` | `blame --porcelain` 解析、父哈希批量解析 |
| | `search` | 提交内容搜索（grep/pickaxe） |
| | `committed` | 已提交变更浏览、提交文件清单 |
| | `tree` | `ls-tree -r -z` 历史快照树 |
| | `content` | `readFileAtRev`（`git show <rev>:<file>` / 工作区读文件） |
| 差异与暂存 | `diff` | 工作区/暂存/提交间 diff、流式 chunk、分支与工作树差异清单 |
| | `staging` | 暂存/取消暂存/放弃（路径与 hunk 级）、补丁应用与预检 |
| | `crlf` | CRLF 问题检测与 `core.autocrlf` 建议值 |
| 提交 | `commit` | 提交、amend、amend 历史提交、HEAD/祖先/可 amend 目标 |
| 分支与检出 | `branch` | 分支 CRUD、上游、已合并、最近检出、保护分支发布检测 |
| | `checkout` | 检出（分支/游离 HEAD/新建分支） |
| | `reset` | reset 与 commitish 校验 |
| 合并与冲突 | `merge` | merge、continue、策略 |
| | `conflict` | 冲突清单、标记已解决、三侧内容读取 |
| 贮藏与变基 | `stash` | save/pop/apply/drop、stash as branch、stash diff |
| | `rebase` | rebase onto、交互式（todo/autosquash/edit/skip/continue）、checkout with rebase |
| | `pick` | cherry-pick / revert、continue/skip、isAncestor |
| 远程 | `remote` | fetch/pull/push、远端 CRUD、push up to commit、shallow 识别、本地独有提交 |
| 标签与工作树 | `tag` | 标签 CRUD、推送/删除远程标签 |
| | `worktree` | 工作树 CRUD、prune |
| | `submodule` | 子模块状态/更新 |
| 配置与签名 | `config` | git 配置读写 |
| | `gpg` | GPG 密钥列表解析、提交签名配置、gpg 命令解析 |

### 2.2 api —— 功能服务层（一个功能一个文件）

**统一函数约定**：

- 入参：`repoPath: string` 显式传入 + 领域参数（**无 HTTP 对象、无隐藏全局状态**，天然支持多仓库并发）；
- 返回：`contracts` 定义的领域类型；
- 流式功能（log、大 diff）：返回 `AsyncIterable<契约事件>`，由框架层转 SSE；
- 长操作与流式功能接受可选 `{ signal }` 支持取消（直通 core）；
- 错误：统一 `ServiceError { code, message, context?, cause? }`，`message` 为可直接展示的中文；**不抛 HTTP 概念**；
- 文件之间仅通过 `index.ts` 公共出口互调，禁止深层相对 import。

**功能清单**（37 个功能文件 + `errors.ts`；功能域覆盖口径见盘点报告 §2.1）：

| 文件 | 职责 |
|------|------|
| `repo.ts` | 打开/验证/初始化/克隆、最近仓库、删除注册、应用 home 目录 |
| `status.ts` | 工作区状态（core → contracts 薄映射） |
| `log.ts` | 提交图分页快照与 SSE 流 |
| `diff.ts` | 多版本 diff 全文与流、三版本、分支与工作树差异 |
| `events.ts` | 仓库状态事件流：2s 轮询 `getStatus`+operation 深比较，变化才产事件（首帧 repo/operation/refs 三事件基线），`signal` 可取消 |
| `settings.ts` | 应用设置、git 可执行文件检测/引导 |
| `gpg.ts` | GPG 提交签名配置 |
| `errors.ts` | `ServiceError` + 错误码表 + `toServiceError`（core 异常归并） |
| `config.ts` | 仓库级 git 配置读写 |
| `operation.ts` | 进行中操作状态、进度（step/total）、中止/继续/跳过 |
| `staging.ts` | 暂存/取消暂存/放弃（路径与 hunk 级） |
| `changelist.ts` | 变更列表管理 |
| `commit.ts` | 提交、amend、amend 历史提交、commit & push、CRLF 提示 |
| `branch.ts` | 分支列表与动作（保护分支联动） |
| `checkout.ts` | 检出（分支/标签/提交/文件、新建分支检出） |
| `reset.ts` | Reset 与 Undo Commit |
| `merge.ts` | 合并与继续合并 |
| `conflict.ts` | 冲突清单与解决 |
| `stash.ts` | 贮藏动作、stash diff、unstash as |
| `rebase.ts` | rebase onto、交互式、autosquash、commit-edit |
| `pick.ts` | cherry-pick / revert |
| `tag.ts` | 标签动作 |
| `remote.ts` | 远端管理、fetch/pull/push |
| `update.ts` | Update Project、检出并更新、force-pushed 修复 |
| `blame.ts` | 溯源 |
| `history.ts` | 文件历史（含重命名跟随） |
| `browse.ts` | 历史快照浏览（树 + 文件内容） |
| `committed.ts` | 已提交变更浏览 |
| `search.ts` | 提交内容搜索 |
| `patch.ts` | 补丁创建/应用/删除/导入搁置 |
| `shelf.ts` | 搁置管理 |
| `console.ts` | git 命令输出控制台 |
| `ignore.ts` | .gitignore 管理 |
| `auth.ts` | 托管平台账户凭据（token 存储，供 github/gitlab 复用） |
| `github.ts` | GitHub PR（列表/详情/时间线/评论/审查/diff 视图/合并/检出） |
| `gitlab.ts` | GitLab MR（创建/列表/详情/评论/讨论/审查/合并/检出） |
| `worktree.ts` | 工作树管理 |
| `submodule.ts` | 子模块状态/更新 |

### 2.3 contracts —— 跨端契约

- **组成**：`domain.ts`（领域类型与事件）、`endpoints.ts`（每个端点一个 zod schema）、`errors.ts`（错误码与 HTTP 映射）、`sse.ts`（SSE 帧序列化）、`unified-diff.ts`（unified diff 行映射解析）、`patch.ts`（补丁 hunk 切片）、`host.ts`。
- **路由约定**：仓库用 **repoId** 标识（`settings` 注册 `{id, path}` 映射，不暴露文件系统路径，未来可挂鉴权）；路由层以 `getRepoById` 解析 repoPath 后调 api。
- **错误形状**：`{ error: { code, message, context? } }`；`httpStatusFor(code)` 纯函数放本包，两个框架应用共用同一张映射表。

**错误码**（12 个定义；9 个实际产生，3 个预留/定档）：

| code | HTTP | 状态 |
|------|------|------|
| `REPO_NOT_FOUND` | 404 | 在用 |
| `NOT_A_GIT_REPO` | 400 | 在用 |
| `INVALID_REF` | 400 | 在用 |
| `INVALID_QUERY` | 400 | 在用 |
| `AUTH_FAILED` | 401 | 在用 |
| `RATE_LIMITED` | 429 | 在用 |
| `HOOK_FAILED` | 422 | 在用 |
| `OPERATION_IN_PROGRESS` | 409 | 在用 |
| `GIT_ERROR` | 500 | 在用（带 stderr 上下文） |
| `CONFLICT` | 409 | 定档：冲突语义由业务三态承载（`200 { status: 'conflicts' }`），此码仅留给真实资源冲突类错误 |
| `STALE_LOCK` | 409 | 预留（index.lock 竞态，待底层路径消费） |
| `CANCELLED` | 499 | 预留（客户端断开，映射仅内部兜底，实际无响应可发） |

**SSE 事件**：统一 `{ type, payload }` 帧格式，`serializeSseEvent` 纯函数统一序列化，两应用共用。在用事件类型：

| 事件 | 负载 | 用途 |
|------|------|------|
| `log.line` | 提交行 | log 图增量 |
| `diff.chunk` | 文本分块 | 大 diff 渐进渲染 |
| `repo.state-changed` | `RepoStatus` | 状态条/工作区变化 → 触发 status/log revalidate |
| `operation.state-changed` | `OperationState` | 进行中操作状态，含 step/total 进度（`/events` 首帧之一） |
| `refs.changed` | `{ refs: string[] }` | 引用指纹变化（分支/标签/贮藏/远端引用增删移；空数组 = 指纹变化但名单未知） |

**端点命名模式**（后续端点遵循）：`GET/POST/PUT/DELETE /api/repos/:repoId/<功能>/…`；写操作用 POST（语义如 `POST /api/repos/:repoId/staging` + `{action}`）；长操作返回 `{operationId}` 并推送进度。端点终态清单见盘点报告（103 route.ts ↔ 118 注册，两端对称）。

### 2.4 client —— 客户端数据层

- 类型全部来自 `contracts`；框架无关（SWR 在 Next client components 与 Vite SPA 均可运行，同源 `/api`）；
- **禁止持有业务逻辑**（不聚合、不转换业务数据，只做取数与缓存）；
- 结构：`http.ts`（fetch 底座）＋ `events.ts`（SSE 订阅，`repo.state-changed` → 触发 revalidate）＋ **每功能域一个 hook 文件**（与 api 域同构：auth/branches/commit/diff/log/…，SWR 取数 + mutation）。

### 2.5 ui —— 纯展示组件层

**规则**：props 驱动；**不 import client、api**；不发起任何接口调用；样式 antd + Tailwind（遵循 AGENT.md 风格约束）；依赖方向 `composite → domain → base`；`graph-layout` 仅被 `CommitGraph` 使用。

**组件清单**（现状）：

| 层 | 组件 |
|----|------|
| base/ | **布局原语：`PageShell`、`Toolbar`、`EllipsisText`、`SplitPane` + 密度模块 `density.ts`/`density-context.tsx`（口径见 §6）**、`VirtualList`、`GraphCanvas`、`FileTree`、`MonacoDiffView`/`MonacoTextView`（`monaco-lazy` 懒加载 monaco-editor）、`EmptyState`、`OperationStatus` |
| domain/ | `CommitGraph`、`RepoStatusBar`、`CommitDetailsPanel`、`DiffViewer`（并排/行内 + staged/工作区切换 + 忽略空白开关）、`HunkDiffView`（PR/MR 行级 diff）、`DirectoryTree`、`CommittedStatus` |
| composite/ | `RepoPage`、`LogPage`、`DiffPage`、`StatusPage`（Local Changes + 暂存区 + 内嵌提交框）、`BranchPanel`、`MergeDialog`、`RebaseDialog`（交互式）、`ResetDialog`、`StashPanel`、`TagPanel`、`RemotePanel`、`PushDialog`/`PullDialog`/`UpdateProjectDialog`、`BlameView`、`HistoryPanel`、`CommittedChangesPanel`、`SearchPanel`、`ConflictsPanel`、`PatchPanel`、`ShelfPanel`、`ConsolePanel`、`IgnoreDialog`、`BrowsePanel`、`BranchCompareView`、`DiffStreamView`（diff/stream 渐进渲染）、`ThreeWayView`/`MergeView`、`WorktreePanel`、`SubmodulePanel`、`GithubPanel`/`GitlabPanel`、`AuthDialog`、`SettingsPage` |
| graph-layout/ | 自 vcs-log/graph 移植的布局算法（纯函数，不 import React；`fixtures/java/` 为 Java testData 转制的行为等价夹具） |

### 2.6 框架层：web-next 与 web-koa

**共同模式**：每个路由只做三件事 —— **zod 校验（contracts schema）→ `getRepoById` 解析 repoPath → 调 api → `toServiceError` + `httpStatusFor` 错误映射**。`AsyncIterable → SSE` 序列化是 `contracts` 的纯函数，apps 内零逻辑重复；两应用端点清单完全对称（§2.3）。

**web-next**（Next.js 16，App Router）：

- `app/layout.tsx`：SSR 壳（antd ConfigProvider、深色主题默认、全局 chrome、加载骨架）+ providers；
- 页面主体：client components 组装 ui + client；
- `app/api/…/route.ts`：每个端点一个 `GET/POST/PUT` Route Handler，薄封装调服务层；SSE 用 `ReadableStream.from(asyncIterable 映射 serializeSseEvent)`；客户端断开用 `request.signal` → AbortController → 停写并杀 git 进程；
- Server Actions 仅作为表单类操作的便捷封装，REST 为主（保证与 web-koa 对称）。

**web-koa**（Koa.js）：

- `src/routes/`：同一份端点清单（koa-router）；SSE 写 `ctx.res` 并监听 `close` 取消；
- `src/middleware/`：错误处理、body 解析、SSE 流、静态资源；
- `public/`：**同一套 ui + client 的 Vite SPA 构建产物**（react-router，页面路径与 web-next 一致）。

**运行形态**：两个应用均本地运行（localhost，本地优先访问仓库）。`web-next`：`next dev` → http://localhost:3030。`web-koa`：Koa API 服务 → http://localhost:3031；dev 下 Vite dev server（localhost:5173）承载 SPA 页面并把 `/api` 代理到 3031；生产 `vite build` → `koa-static` 在 3031 直接托管 `public/` + API。根 `pnpm dev` 并行起两个，端口被占用先杀占用进程（AGENT.md 约定）。

---

## 3. 移植方法论（Java → Web）

### 3.1 UI 来源判定

Java 版 UI 构成三类，处置方式不同（判定原则：**算法移植、结构参照、风格对齐，不搬渲染代码**）：

| Java 侧资产 | 技术形态 | rebased.js 落点 | 复用方式 |
|------------|---------|----------------|---------|
| 通用控件（表格/树/表单/对话框/工具栏/弹窗/标签页） | Swing（JBTable/JBTree/JBPopup/JBDialog）+ Jewel（Compose Multiplatform） | antd（Table/Tree/Form/Modal/Menu/Tabs/Popover 等）+ Tailwind | **不移植**：Swing/Compose 渲染模型与 React DOM 不通；antd 覆盖通用控件需求 |
| 编辑器（语法高亮/diff/annotation gutter/inlay） | IntelliJ 自研编辑器（平台核心） | Monaco（`monaco-lazy`/`MonacoDiffView`/`MonacoTextView`） | **不移植**：Monaco 具备对应能力，替代 TextMate 插件的语法高亮职责 |
| **VCS Log 图布局算法** | `platform/vcs-log/graph` + `graph-api`（`GraphLayoutBuilder`、`EdgePrintElementImpl` 等 + testData） | `ui/graph-layout/`（纯函数布局引擎） | **算法级移植**（已落地）：TS 重写算法，Java testData 转 vitest 夹具做行为等价测试；源码 Apache-2.0，移植保留版权声明 |
| Git 专属复杂组件（交互式 rebase 编辑器、分支树、暂存区、冲突面板、提交对话框、Committed Changes 浏览器） | git4idea Swing 组件 | 自研 React 组件 + antd 组合 | **信息架构参照**：对话框字段结构、状态机、树模型分组维度逐项对照（见 3.2），不搬代码 |
| 视觉风格（Darcula/IntelliJ LAF） | 平台 LAF 资源 | antd 主题变量 + Tailwind 设计令牌 | 风格对齐：深色主题为默认，不强求像素级复刻 |

### 3.2 关键组件的落点映射（信息架构参照表）

| Java 组件 | rebased.js 落点 | 必须对照的结构 |
|-----------|----------------|---------------|
| VCS Log 表 + graph/graph-api | `CommitGraph` + `graph-layout/` | lane 分配、edge routing、分支着色算法 |
| `GitRebaseCommitsTableView/Model` + `GitInteractiveRebaseDialog` | `RebaseDialog`（交互式提交列表） | entry 状态机（pick/reword/squash/fixup/drop）、上移/下移约束、冲突标记 |
| `GitMergeDialog` + `GitOptionsPanel` | `MergeDialog` | 合并方向、merge 策略选项、commit 选项 |
| `BranchesTreeModel`（popup/dashboard） | `BranchPanel` | 分组维度（本地/远程/最近检出/标签）、过滤逻辑、合并状态图标 |
| `GitStage*`（暂存区 + 三版本对比） | `StatusPage` 暂存区 + `ThreeWayView` | 三版本模型（本地/暂存/HEAD）、hunk 展开、整文件暂存 |
| `GitConflictsPanel` + 平台 3-way merge | `ConflictsPanel` + `MergeView` | 冲突文件分组、左右 diff + 底部合并结果面板 |
| CommitDialog（modal） | `StatusPage` 内嵌提交框 | changelist 选择、amend/sign-off/GPG 选项、提交范围 |
| `CommittedChangesBrowser` | `CommittedChangesPanel` | 按目录树浏览已提交变更的结构 |
| `GitBranchesTreePopupOnBackend` / `GitQuickActionsToolbarPopup` | LogPage 顶栏 + 「更多」菜单 | 操作聚合方式（当前仓库可执行操作全集） |

---

## 4. 测试与质量

### 4.1 各层测试策略

| 层 | 测试 |
|----|------|
| core | 真实 git CLI + 临时仓库 fixture（造提交/分支/冲突/重命名）；解析函数单测；取消语义三断言（exitCode 130 / 已中止预检 / break 杀进程） |
| api | fixture 仓库集成测试，不经 HTTP 直接调服务（框架无关的可测试性红利）；`events.ts` 事件流首事件与变化检测 |
| contracts | zod 解析、`httpStatusFor` 映射、SSE 序列化单测 |
| ui | Testing Library + 交互测试；`graph-layout` 用 Java testData 转制的行为等价夹具 |
| client | mock fetch / mock SSE 测试（revalidate 触发、增量追加） |
| apps | 只测路由装配（zod 校验 + 错误映射），不重复测服务逻辑；SSE 断开回归断言 git 进程被终止（不 mock api 层，真实 git fixture）。Next route 函数直接构造 `Request` 断言 `Response`；Koa 直接调 `app.callback()`；SSE 测试读流首帧断言 `data: {"type":…`，断开连接断言 git 进程被终止 |

质量门（根命令，与 AGENT.md 一致）：`pnpm typecheck`（project references 全链类型）→ `pnpm format` → `pnpm test`。eslint 边界规则违反即失败。

### 4.2 测试性能基线（防腐化）

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

**成本模型**：本机单次 git 进程 spawn ≈ **330ms**（msys2 git + 杀软开销）。全套数千次 spawn 曾贡献 20+ 分钟纯进程开销。测试性能的第一性优化 = 削减 spawn 数，其次才是并行度。

**机制（按收益排序）**

1. **建仓模板化**（core/api `src/testing/tmp-repo.ts`）：模块级用真实 `git init` 建一次模板仓库，之后每次 `createTmpRepo()` 仅 `cpSync` 复制（0 spawn）。模板目录随进程存续，残留交给系统临时目录清理。
2. **身份环境变量**（core/api `src/testing/setup.ts`）：注入 `GIT_AUTHOR_NAME/EMAIL`、`GIT_COMMITTER_NAME/EMAIL`，夹具中所有 `git config user.name/email` 行删除。注意：**`git config --local --get` 不读环境变量**——断言 `localValue` 的用例必须显式写配置。
3. **夹具快照**（`instantiateFixture(template)`）：同构夹具（三提交/冲突/裸远端 rig）在 `beforeAll` 用真实 git 各建一次模板，用例复制独立副本（互不污染）。模板目录放独立 `templateDirs`，由**文件级** `afterAll` 清理。
4. **远程 rig 复制的 URL 修正**：repo 与 bare 两个目录都复制后，须文本替换 repo 的 origin URL 指向 bare 新副本（gitconfig 值内反斜杠以 `\\` 转义存储，`.gitmodules` 与 `.git/modules/<path>/config` 按正斜杠替换）。
5. **并行度配置**（改动前读各包 `vitest.config.ts` 注释）：
   - core：`maxWorkers: 4` + 文件级并行。历史（15 worker 全并行）下 msys2 git 并发导致交互式 rebase 30s 超时与临时目录竞态；**若复现 flake，回退 `fileParallelism: false` 即可，其余优化不受影响**。
   - api：`maxWorkers: 8`（默认 nCPU 并发 × 每文件数十 spawn 会互相拖慢单次 spawn）。
   - core/api 均设 `hookTimeout: 120000`（模板 beforeAll 钩子串行执行数十次 spawn，默认 10s 必然超时）。
   - 根 `package.json` test 脚本 `--workspace-concurrency=4`；如需继续压总时长，可实验 3 或 git 重包/轻包错峰。
6. **大套件拆分**：web-koa/web-next 按域一个 describe 一个文件（11/10 个），共享纯辅助函数放 `apps/*/src/testing/`，文件级 server/环境生命周期各自持有。单文件套件无法并行，是墙钟上限。
7. **ui 纯函数测试**：`// @vitest-environment node` 文件头跳过 jsdom；`src/testing/setup.ts` 的 DOM 补丁以 `typeof window !== 'undefined'` 守卫。

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

---

## 5. 风险

| 风险 | 缓解 |
|------|------|
| git CLI 平台差异（Windows 路径/CRLF/杀进程树） | core 统一处理 + 三平台 CI 跑集成测试 |
| 大仓库 log 图性能 | 流式解析 + 虚拟滚动 + 分页游标（分支折叠为可选后置，见 backlog §2.9） |
| 两个下游应用路由重复 | 契约（schema/错误映射/SSE 序列化）集中放 contracts，apps 只留装配 |
| GitHub/GitLab API 限流与鉴权复杂度 | `auth.ts` 集中 token 管理；`RATE_LIMITED` 统一错误 |
| credential helper 依赖系统 git 配置 | 引擎层原样调用系统 git（helper 由 git 进程自身处理），`auth.ts` 只做兜底 HTTPS 认证 |

---

## 6. 布局与响应式

> 终态口径（2026-09-11 全站流体布局重构收口）。记录**结论**而非过程：四个布局原语 + 密度模块的契约、横向沾满的实现机制、密度的生效与豁免、允许横向滚动的例外清单、以及可执行的验收方法。

### 6.1 四个布局原语与密度模块

| 原语 | 位置 | 契约 | 它取代了什么 |
|------|------|------|--------------|
| `PageShell` | `packages/client/ui/src/base/page-shell.tsx` | `density?: 'compact' \| 'default'`（默认 compact）、`padding?: number \| string`（不传不落 style）、`gap?: number`（不传不落 style）、`scroll?: 'page' \| 'inner' \| 'none'`（默认 page）、`children` | 每个页面各写一遍的根 `<Flex vertical …>`（落地：两个 app 各 20 个页面文件 + ui 层 11 个页面级 composite 使用 `PageShell`） |
| `SplitPane` | `base/split-pane.tsx` | `side`、`children`（主区）、`sideWidth?: number`（默认 300）、`sidePosition?: 'start' \| 'end'`（browse 在左、log 在右）、`collapseBelow?: number`（默认 768）、`gap?: number`（不传不落 style） | 写死 `width:300/320 + flexShrink:0` 的侧栏（窄屏必然横向溢出的结构性成因） |
| `Toolbar` | `base/toolbar.tsx` | `align?: 'start' \| 'center' \| 'end' \| 'between'`（映射**主轴** `justify`）、`gap?`、`wrap?: boolean`（默认 true）、`children`；容器带 `width:100%; minWidth:0` | 手写的 `flexWrap` 补丁（`flexWrap` 缺 `minWidth:0` 时子项仍会顶宽父级） |
| `EllipsisText` | `base/ellipsis-text.tsx` | `children: string`、`title?`（存在则走 antd 原生 ellipsis tooltip）、`mono?`、`type?`、`strong?`、`maxWidth?: number \| string`；自身带 `minWidth: 0` | 不可断行的长 hash / 长路径 / 长分支名（它们把所在行顶宽，是溢出传播源） |
| `compactTheme(mode)` + `DensityProvider` | `base/density.ts`、`base/density-context.tsx` | `compactTheme(mode: 'light' \| 'dark'): ThemeConfig`；`DensityProvider({ mode })` 只承载 `mode`，两个 app 各包一层（web-next 用 `useSettings().settings.theme`，web-koa 固定 `'dark'`） | 全站各页自行处理字号与明暗算法 |

门禁不变式：**新原语不引入可交互元素**（`EllipsisText` 内部的 Tooltip 子树只有 `Typography.Text`），一个路由**只有一个** `PageShell` 拥有密度。

### 6.2 「横向沾满」的实现机制

页面根 = 纵向 Flex，`width:100%`、`minWidth:0`、`height:100%`，**刻意不设 `alignItems`**：

1. `align-items` 的默认值（`normal` → 表现为 `stretch`）正是「子元素横向拉伸沾满」的来源。原先 44 处页面根写的是 `align="flex-start"`——在**纵向** Flex 上交叉轴是水平方向，它表示「子项不横向拉伸」，于是页面内容不沾满、且子项按内容宽溢出并把父级顶宽（意外横向滚动条）。**删掉它才是修好，加上它才是 bug**。
2. `minWidth: 0` 阻止 flex 子项以「自动最小尺寸 = 内容宽」把父级顶宽；`scroll="inner"` 另需 `minHeight: 0`（纵向 Flex 的主轴是垂直方向，默认 `min-height: auto` 会让内容撑开容器而不产生内部滚动）。
3. `padding` / `gap` 默认**不落 style**：既有页面的 16px 内边距由页面级 composite 自带，原语默认值一旦非 0，迁移会凭空新增间距并可能制造溢出。

**`align="flex-start"` 的判定口径（极易误判）**：它只在**纵向** flex 容器上是宽度 bug；在**横向** flex 容器上交叉轴是垂直方向，它表示「子项顶部对齐」，**必须保留**（例如 `github-panel.tsx` / `gitlab-panel.tsx` 的「左列表卡 + 右详情卡」行、`branch-compare-view.tsx` 的内层横向容器）。全站迁移时逐处按容器方向判定，不是全局替换。

**直接子项被拉伸的两面**：正因为根不设 `alignItems`，`Tooltip > Button type="link"` 这类**直接子项**会被拉成整行宽、文字居中（antd 按钮自带 `justify-content:center`）。这是原语的必然结果，不是原语缺陷：需要紧凑左对齐的调用点就地写 `style={{ alignSelf: 'flex-start' }}` 收回内容宽（两个 app 共 36 处，见 §6.5）；**不要去改 `PageShell` 的契约**（去掉「不设 alignItems」等于把 44 处宽度 bug 请回来）。

### 6.3 密度口径

```ts
// density.ts：只给 fontSizeSM 一个种子，其余交给 compactAlgorithm 派生
algorithm: [mode === 'light' ? theme.defaultAlgorithm : theme.darkAlgorithm, theme.compactAlgorithm]
token: { fontSizeSM: 11 }   // 实效 fontSize / fontSizeSM / fontSizeLG = 12 / 11 / 14
```

- **为什么不能写 `fontSize`**：`compactAlgorithm` 会**覆盖**传入的 `fontSize`——它以基础算法派生出的 `fontSizeSM` 为新基准再推导整档字号。显式 `fontSize: 12` 会让基础算法先把 `fontSizeSM` 派生成 10，compact 再以 10 为基准 → **实效 fontSize = 10**（比目标 12 还小）。实测矩阵见 `density.ts` 文件头与 `density.test.ts` 的「实效 token」用例。
- 间距与控件高度**交给 `compactAlgorithm`**，不重复手调 `padding*` / `controlHeight` 种子 token（会与算法叠加成过度压缩）；`lineHeight` 不动（缩小字号后行高比例已是流体的）。
- **数值校准结论（T16 六档截图实测）**：12px 基准维持不变——它在 360 / 768 / 1440 三档、明暗两主题下均可读（`responsive-{360,768,1440}[-light]-{log,browse,status,console}.png`），且 12/11/14 正是 antd 自身 small 规格的量级。
- **豁免**：设置页是唯一例外（`density="default"`，不包紧凑 `ConfigProvider`），实测同宽度下设置页 `fontSize` = 14 / 卡片标题 16，其余页面 = 12（`responsive-768-light-settings-fluid.png`）。

**硬经验：嵌套 `ConfigProvider` 的 `algorithm` 是「替换」而不是「合并」。** 这正是 `compactTheme` 必须自带完整 `[baseAlgorithm, compactAlgorithm]` 数组的原因——`PageShell` 内层的 `ConfigProvider` 一旦只写 `theme.compactAlgorithm`，就会把外层 app 的明暗底色算法**整个换掉**（暗色主题下页面会变回亮色底，而且不会有任何报错）。若按「antd 会合并算法栈」的直觉去写，暗色模式会**静默**坏掉。

### 6.4 允许横向滚动的例外清单

页面级横向滚动必须为 0（§6.5）；**组件内部**的横向滚动是允许的，且只有三类：

| 例外 | 位置 | 为什么必须允许 | 断言口径 |
|------|------|----------------|----------|
| Monaco 编辑器 | `MonacoDiffView` / `MonacoTextView` / `HunkDiffView`（`github-panel` / `gitlab-panel` 展开差异） | 代码行不换行是编辑器语义；长行必须靠编辑器自己的横向滚动条可达。编辑器宿主（`.monaco-editor`）本身是**裁剪容器**（`scrollWidth == clientWidth`），溢出**不外泄**到文档；真正持有横向滚动区间的是它内部的 `.monaco-scrollable-element` | 四条同时成立：① 长行真实存在（`.view-lines` 宽 > 编辑器 `clientWidth`）；② 宿主 `scrollWidth <= clientWidth + 1`（裁剪，不外泄）；③ `.monaco-scrollable-element` 的 `scrollWidth > clientWidth`（**注意其值是 Monaco 的大滚动哨兵 16777216，不能当长行的度量**）；④ 拖动 Monaco 自己的横向滚动条滑块后内容真的位移 |
| 长文本块 | `browse-panel` 的内容 `<pre>`、console / patch 预览等等宽文本块 | 等宽原文不折行，属于内容语义 | 这些块自身带 `overflow: auto`，滚动发生在块内 |
| 浮层 / 弹窗包裹层（overlay） | antd 的 `.ant-modal-wrap`（所有 `Modal`：认证弹窗、重置弹窗、忽略配置、CRLF 三选、手动合并全屏 Modal 等），以及同为 `position: fixed` 的浮层容器 | 浮层是**页面之外**的一层，其定位基准是视口而不是文档流：`.ant-modal-wrap` 自带 `overflow: auto`，弹窗内容横向变宽时滚动发生在这层包裹容器里，**不会**传播成文档级横向滚动。这正是「弹窗内部溢出被包裹层吃掉」的机制 | 页面级断言（§6.5）对弹窗开口的格子只能证明「**弹窗背后的页面**不溢出」——`position: fixed` 的元素既不参与文档滚动宽的计算，也被越界元素清单刻意跳过。**弹窗内部**的横向溢出要用另一把尺子：`.ant-modal-wrap`（或 `.ant-modal`）自身的 `scrollWidth <= clientWidth + 1`。目前验收脚本只做了前者，后者列为未覆盖项（`docs/e2e-verification.md` §5.16④） |

**不允许**的横向滚动：任何页面级横向滚动条（= 上述断言失败），以及「长 hash / 长路径 / 长分支名」把所在行顶宽——后者用 `EllipsisText`（截断 + 溢出时 tooltip）收口，不是滚动。

### 6.5 验收方法（可执行）

`scripts/check-fluid-layout.mjs`（Playwright 驱动，`pnpm dev` 起真实服务后运行）：

```bash
node scripts/check-fluid-layout.mjs                              # web-next(:3030) 六档 × 明暗
node scripts/check-fluid-layout.mjs --app=koa --themes=dark       # web-koa SPA(:5173) 六档 × 暗色
node scripts/check-fluid-layout.mjs --shots-only --widths=360,768,1440
```

- **核心断言**：六档宽度 `360 / 480 / 768 / 1024 / 1440 / 1920` × 明暗两主题 × 每个路由与状态，逐格断言
  `document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`（+1 容亚像素）。
- **两段式就绪门**：每格先等 `ready`（页面壳 / 工具行），再等 `content`（**数据级**条目，如 `row-stash-*` / `tag-row-*` / `config-input-*` / `.ant-tree-treenode`）真的命中；命中数记进明细，并对**又大又与夹具无关**的列表设**命中数下限**（`min`：browse 20→10、console 100→10、settings 9→4；跟着夹具变的小列表用 1）。只等页面壳会量到「数据还没到」的页面，而**空页永远不会横向溢出** —— 那样的绿什么都没证明，故内容级选择器一条都没命中、或命中数低于下限时该格直接判红。页面上确实不存在数据级内容时（对话-only 页、该夹具下必然为空的页）在脚本内逐行写明原因，不留白。
- **就绪门与主题门必须串联（防「重载洗绿」）**：主题探针迟迟不落时脚本会兜底整页重载一次，重载会把页面打回「数据还没到」的状态。因此「导航 + 就绪门 + 等静止」与主题门由**同一个入口**（脚本里的 `prepareCell`）串联：**只要这一轮发生过整页重载，就绪门就整套重跑**，绝不允许在重载后的页面上直接测量（那正是「空页永不溢出」的假绿通道，实测可复现：绕过这条规则时 `settings` 格在内容 0 条的页面上被判绿）。
- **页面 JS 异常按判据分栏**：真异常记录在案；唯一被过滤的良性噪声是 Monaco 的 diff worker 取消（`Canceled`，stack 落在 `monaco-editor` 的 `computeDiff`）——每次渲染 diff 都会发生而页面完全正常。判据锚在 **stack** 上而不是消息文本上，避免把同名真缺陷一起过滤掉。
- **夹具耦合**：内容级门要求夹具里真的有那些内容（树节点、git 配置、变更行、stash / tag / patch / shelf / worktree / submodule、console 记录），而这些是**可变状态**。夹具被改动时相关格子会如实判红（而不是静默跳过）—— 那一格此时没有可量的数据，绿了才是错的；排查时先看夹具，不要先改门。
- **环境中断可整格重跑一次（判定类失败永不重试）**：dev 服务按需编译、或同一工作区别的会话重启 dev 服务 / 改被测代码时，页面会在几十秒内**整页不渲染**（`data-theme=null`、任何 `data-testid` 都不出现，甚至 `ERR_CONNECTION_REFUSED`）—— 那种红与布局无关。脚本因此只对**中断类**失败整格重跑一次（重新导航 + 完整两段式就绪门 + 全部断言与测量），判据集中在 `isStall()`；**页面级溢出、例外断言失败、内容级命中数低于下限**都是结论，永不重试。**每次尝试的预算一字未改**（25s / 例外②的 60s），两次都没过照样判红；尝试次数与**首轮**失败原因写进明细 JSON（`attempts` / `firstAttemptReason`）并在汇总里逐格列出，所以「重试之后才绿的格子」不会被误读成一次通过。
- **覆盖**：两个 app 的全部 24 个页面（`/` 首页 + `/repos/:id` 日志页 + 22 个子页），另加静态加载不产生的状态：`?select=`（选中提交）、`?compare=`（分支对比）、GitHub/GitLab 面板**展开「查看差异」**（`hunk-diff-view`）、认证弹窗、重置弹窗、`EllipsisText` 悬停浮层。
- **例外断言**（反向断言，防止后续把例外当缺陷改掉）：① `SplitPane` 在 `collapseBelow` 以上左右并排、以下纵向堆叠且各占满宽度（阈值从 `split-pane.tsx` 源码读取，不抄常量）；② Monaco 内部横向滚动可达而页面级仍为 0。
- **`collapseBelow` 校准结论：维持 768**。实测 768px 下 browse 为「侧栏 300 + 主区 424」，可用；但日志页在同一阈值下主区只有 448px，提交信息已被截断到约 10 个字符。试降为 640 后实测（`collapsebelow-experiment-640-*.png`）日志页主区只剩 320px（比它旁边 320px 的详情栏还窄），提交信息与日期列被压到「ch…」「2026-09-11 …」，明显劣于堆叠，故不采用 640。
- **主题切换**：主题是服务端持久化设置（`PUT /api/settings`），脚本先读原值、跑完恢复；每格测量前等到 `data-theme`/底色真的落到文档（避免量到首帧的暗色兜底）。

