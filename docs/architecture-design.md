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
| base/ | `VirtualList`、`GraphCanvas`、`FileTree`、`MonacoDiffView`/`MonacoTextView`（`monaco-lazy` 懒加载 monaco-editor）、`EmptyState`、`OperationStatus` |
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
