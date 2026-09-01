# Rebased.js 应用组装设计（Plan 2：web-next + web-koa 运行起来）

- **日期**：2026-09-01
- **状态**：待评审
- **范围**：在 `feat/server-core` 分支上组装两个下游应用并运行——`apps/web-next`（Next.js 16 + React 19，3030）与 `apps/web-koa`（Koa + Vite SPA，3031），实现母 spec §7 步骤 5-6 的 P1 可见产品（打开仓库 → 提交图 → 单文件 diff → 状态条/事件推送）。首跑含 graph-layout 算法移植、SSE 流式、Monaco DiffEditor、取消链路补齐。
- **依据**：母设计 `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md`（§3.2/§4.3-4.6/§5/§7）；UX 一致性基准为 Java 版 `D:\zhanglei1120\Github\rebased`（对照表见附录 A，审计结论：无 ❌ 不一致项，6 项缺口已并入第 6 节）。
- **注**：`feat/server-core` 合并回 main 的决策挂起（待本计划跑通后与用户确认）。

---

## 1. 目标与首跑范围

### 1.1 目标

1. 两个下游应用各自完整运行：`web-next` 用 Next.js 原生形态（App Router + Route Handlers + SSR 壳），`web-koa` 用 Koa 原生形态（koa-router + 中间件 + 静态托管同一套 SPA）；**API 路由两侧完全对称**（同一份端点契约）。
2. 首跑产品面：打开仓库 → LogPage（CommitGraph 真图渲染 + SSE 增量 + 提交详情面板 + RepoStatusBar）→ DiffPage（Monaco DiffEditor 并排/行内 + 忽略空白开关 + staged/工作区切换）。
3. **与 Java 版功能一致（在已声明首跑范围内）**——附录 A 为对照证据。

### 1.2 首跑包含

- REST 端点清单 + SSE 端点（log.line / diff.chunk / repo.state-changed）
- graph-layout 算法移植（vcs-log/graph 最小集）+ CommitGraph 真图渲染
- Monaco DiffEditor（懒加载）+ `core.readFileAtRev` / `api.getFileVersions` 增补（两侧全文）
- **取消链路补齐**（终审 deferred 批次：core streamGit 对齐 runGit 的 aborted 语义、api signal 透传、路由层断开杀进程、130/预检/break 三断言）
- api 新增功能文件 `events.ts`（轮询式仓库状态推送）
- UX 一致性 6 项增补（第 6 节）

### 1.3 首跑明确不做（文档化，避免误判为缺失）

- 欢迎屏整体（RepoPage 取代；Java `FlatWelcomeFrame.kt:111-125`）
- 克隆/init 的 UI（server P1 已有 clone/init 原语；P2 补 UI 时最小字段 = URL + Directory，Java 新版无 Test/无分支选择，`VcsCloneDialog.kt:33-131`）
- log 过滤/搜索 UI 与分支折叠（Java 高频入口仅"文本即滤 + 分支过滤弹窗"，列为 P2 次优先；`VcsLogClassicFilterUi.kt:148-152`）
- 独立 StatusPage（状态在 LogPage 顶栏）；进行中操作状态前缀（"Merging/Rebasing …"属 P2 operation.ts，`GitBranchUtil.java:193-204`）
- 提交详情面板的操作按钮（Java 面板内也没有，动作在右键菜单，属 P3 cherry-pick/revert）
- 欢迎屏外的自动 fetch、保护分支（P2/P3 排期）；GPG 签名状态（P2 commit.ts）

---

## 2. 总体结构与运行形态

### 2.1 包结构（在 Task 1 占位包上填充）

```text
apps/
├── web-next/                 # Next.js 16.2.7 + React 19
│   ├── next.config.ts        # transpilePackages: ['@rebased/ui','@rebased/client','@rebased/contracts']
│   ├── app/layout.tsx        # SSR 壳（antd ConfigProvider + 深色主题默认）
│   ├── app/page.tsx          # RepoPage（client component）
│   ├── app/repos/[repoId]/page.tsx   # LogPage + DiffPage（client components）
│   └── app/api/repos/.../route.ts    # Route Handlers（三件套）+ SSE
└── web-koa/                  # Koa + Vite SPA
    ├── src/app.ts            # koa 组装：路由 + 中间件 + 静态
    ├── src/routes/repos.ts   # 同一份端点清单（@koa/router）
    ├── index.html、src/main.tsx、vite.config.ts   # SPA（React 挂载同一套 ui/client；dev 代理 /api → Koa）
    └── public/               # vite build 产物（生产 koa-static 托管）
packages/client/
├── ui/                       # base / domain / composite + graph-layout/
└── client/                   # SWR hooks + SSE hooks（框架无关，base URL 统一 '/api'）
```

### 2.2 依赖

- `web-next`：`next@16.2.7`、`react@19`、`react-dom@19`、`antd@6`、`@ant-design/icons`、`swr`、`monaco-editor`（懒加载）、`tailwindcss`、`zod`、`@rebased/{api,ui,client,contracts}`（workspace:*）
- `web-koa`：`koa`、`@koa/router`、`@koa/bodyparser`、`koa-static`、`tsx`、`vite@7.3.6`（Ruling 9 钉版）、`@vitejs/plugin-react`、`@rebased/{api,contracts}`（workspace:*；ui/client 为构建期依赖）
- `ui`：`antd@6`、`@ant-design/icons`、`monaco-editor`、`@rebased/contracts`；`client`：`swr`、`@rebased/contracts`
- 依赖安装走 JD 镜像 + `pnpm.overrides vite 7.3.6`（Ruling 6/9 既有配置，本计划不加新钉版）

### 2.3 运行形态

- `web-next`：`next dev` → http://localhost:3030
- `web-koa`：Koa API 服务 `tsx watch src/app.ts` → http://localhost:3031；**dev 下 Vite dev server（localhost:5173）承载 SPA 页面并把 `/api` 代理到 3031**（Vite 与 Koa 不同端口，避免冲突）；**生产** `vite build` → `koa-static` 在 3031 直接托管 `public/` + API
- 根 `pnpm dev` 并行起两个；端口被占用先杀占用进程（AGENT.md 既有约定）
- web-koa SPA 路由：`react-router`（BrowserRouter；`/` 与 `/repos/:repoId` 两页，与 web-next 路径一致）

---

## 3. graph-layout 算法移植与 CommitGraph

### 3.1 移植范围（`platform/vcs-log/graph` 最小必需集）

| Java 侧 | 职责 | 首跑 |
|---------|------|------|
| `GraphLayoutBuilder` + `GraphLayoutImpl` | lane 分配 + 行布局 | ✅ 移植 |
| `EdgePrintElementImpl` / `PrintElementGeneratorImpl` | 边路由（直连/折线/merge 展开行） | ✅ 移植 |
| `GraphColorGetterByHead` / `ByNode` | 分支着色（按 HEAD ref 名 hash → HSB 色板） | ✅ 移植 |
| `VisibleGraphImpl` + `RowsMapping` | 可见行映射（分页/增量行号对齐） | ✅ 移植 |
| `BfsUtil`/`DfsUtil`/`GraphUtil` | 图遍历工具 | ✅ 移植（子集） |
| `PermanentGraph`/过滤/折叠/虚线过滤边 | 缓存与高级视图 | ❌ 首跑不做 |

**移植方式**：读 Kotlin 实现用 TS 重写（非逐行翻译）；Apache-2.0，文件头保留 JetBrains 版权声明。
**行为等价验证**：Java 7 组 testData（layoutBuilder/edgesInRow/graphBuilder/containingBranches…）转 vitest 夹具，断言 lane 分配与边形状与 Java 快照一致。

### 3.2 模块接口（纯函数，不 import React）

```ts
// packages/client/ui/src/graph-layout/
export interface LayoutCommit { hash: string; parents: string[]; refs: string[] }
export interface LayoutRow { commit: LayoutCommit; lane: number; edges: EdgeSegment[]; color: string }
export function buildLayout(commits: LayoutCommit[]): LayoutRow[]
```

- 输入来自 `CommitInfo`（core 的 `graph` 文本字段不用于渲染，仅 debug 对照——渲染完全交给 layout 模块）
- SSE 增量：每批到达对当前窗口重算（O(n)），行号经 `RowsMapping` 对齐

### 3.3 CommitGraph（domain 层）

- 渲染：DOM 行（图列 + 提交信息列），图列用 SVG 单层 + 绝对定位；不用 canvas（配合虚拟滚动与选中态）
- 虚拟滚动：`VirtualList`（固定行高窗口渲染）
- SSE 增量：首屏 `getLogPage` 快照 + `useLogStream` 追加
- 行默认列（UX 对齐 #2）：**Subject（图+refs chips）+ Author + Date**（Hash 列省）；**tag chips 默认关闭**（对齐 `showTagNames=false`），分支 chips 开
- 交互：行悬停完整 hash、点击行 → 提交详情面板

---

## 4. 路由层、SSE 与取消链路

### 4.1 首跑端点清单（两应用完全对称）

```text
GET  /api/repos                         最近仓库
POST /api/repos/open        {path} → {repoId}
GET  /api/repos/:repoId/status
GET  /api/repos/:repoId/log?limit&skip&author&path
GET  /api/repos/:repoId/log/stream        （SSE：log.line 增量）
GET  /api/repos/:repoId/diff?file&from&to&staged
GET  /api/repos/:repoId/diff/stream       （SSE：diff.chunk 分块）
GET  /api/repos/:repoId/events            （SSE：repo.state-changed）
GET/PUT /api/settings
```

**路由三件套**（终审建议 8 固化）：`zod 校验（contracts schema）→ getRepoById 解析 repoPath → 调 api 功能文件 → toServiceError + httpStatusFor + {error:{code,message,context?}}`。SSE 帧统一 `serializeSseEvent`（contracts）。

### 4.2 api 新增功能文件 `events.ts`（Plan 2 增补）

```ts
// packages/server/api/src/events.ts
export async function* watchRepoStatus(repoPath: string, opts?: { intervalMs?: number; signal?: AbortSignal })
  : AsyncIterable<{ type: 'repo.state-changed'; payload: RepoStatus }>
// 每 2s getStatus + 深比较，变化才产事件；signal 可取消；框架无关可单测
```

（`operation.ts` 仍是 P2 的进行中操作状态域，与本文件互补。）

### 4.3 取消链路补齐（终审 deferred #1/#2/#3/#6 在本计划消化）

1. **core `streamGit` 对齐 runGit**：aborted-flag 模式；close 时 aborted 一律 reject `GitExitError`(130)；消费者 break 时 try/finally 杀子进程 + 监听器清理；已中止 signal 预检
2. **api 层 signal 透传**：`getLogPage`/`streamLogEvents`/`getFileDiff`/`streamDiffEvents` 增加可选 `signal` 参数直通 core（`LogQuery`/`DiffQuery` 契约不变）
3. **路由层**：SSE 端点监听客户端断开（Next `request.signal` / Koa `ctx.req` close）→ AbortController → 停写并杀 git 进程
4. **补断言**：exitCode 130、已中止预检、break 杀进程三个测试

### 4.4 两个应用差异点

- **web-next**：`app/api/repos/.../route.ts` 每端点一个 `GET/POST/PUT` 导出函数；SSE 用 `ReadableStream.from(asyncIterable 映射 serializeSseEvent)`；取消源 `request.signal`
- **web-koa**：`@koa/router` 同清单；SSE 写 `ctx.res` 并监听 `close`；`@koa/bodyparser` 解析 JSON；生产 `koa-static` 托管 `public/`

### 4.5 测试

- 路由装配：Next route 函数直接构造 `Request` 断言 `Response`（状态码/错误 JSON/zod 拒绝）；Koa 直接调 `app.callback()`
- SSE：真实临时仓库，读流首帧断言 `data: {"type":"log.line"...`；断开连接断言 git 进程被终止（取消链路回归）
- 不 mock api 层（真实 git fixture）

---

## 5. 客户端层

### 5.1 git-client hooks（框架无关，同源 `/api`）

| Hook | 类型 | 说明 |
|------|------|------|
| `useRecentRepos` / `useOpenRepo` | SWR / mutation | 最近仓库 + 打开 |
| `useRepoStatus` | SWR | 状态条数据 |
| `useLogPage` | SWR | 首屏快照（limit/skip 游标） |
| `useLogStream` | SSE 订阅 | log.line 增量追加 |
| `useFileDiff` / `useDiffStream` | SWR / SSE | diff 全文 / 分块（UI 走全文路径） |
| `useRepoEvents` | SSE 订阅 | repo.state-changed → 触发 status/log 的 revalidate |
| `useSettings` | SWR + mutation | logInEditor 等 |

类型全部来自 contracts；不持业务逻辑。

### 5.2 git-ui 组件与页面

- **base**：`VirtualList`、`GraphCanvas`（SVG）、`MonacoDiffView`（React.lazy 懒加载 monaco-editor）、`EmptyState`
- **domain**：`CommitGraph`、`RepoStatusBar`、`DiffViewer`（side-by-side/行内 + staged/工作区切换 + 忽略空白开关）、`CommitDetailsPanel`
- **composite**：`RepoPage`、`LogPage`、`DiffPage`

**页面流程**：RepoPage 打开仓库 → `/repos/[repoId]` LogPage（顶栏 RepoStatusBar + CommitGraph + 右侧 CommitDetailsPanel）→ 点文件 → DiffPage。

### 5.3 Monaco 两侧内容来源（diff 功能域增补）

- core 加原语 `readFileAtRev(repoPath, { file, rev? }): Promise<string>`（`git show <rev>:<file>` / 工作区读文件）
- api `diff.ts` 加 `getFileVersions(repoPath, query): Promise<{ before: string; after: string }>`，三态映射两侧：
  - `staged:true` → before=HEAD 版本、after=暂存区版本
  - 默认（工作区）→ before=HEAD 版本、after=工作区内容
  - `from/to` → before=from 版本、after=to 版本（沿用 Ruling 21 成对校验）
- `getFileDiff`（unified 文本）保留（复制/调试）；contracts 新增 `FileVersions` 类型

### 5.4 测试

- git-client：mock fetch / mock SSE 事件序列（revalidate 触发、增量追加）
- git-ui：Testing Library（CommitGraph 行数/选中、RepoPage 打开流程、DiffViewer 模式切换）；Monaco 轻 mock（懒加载与 props 断言）
- graph-layout：第 3 节 testData 夹具

---

## 6. UX 一致性对齐（审计增补，证据见附录 A）

1. **提交详情面板字段集**：短 hash+复制、作者、日期（"{0} on {1} at {2}"）、加粗 subject、分支/标签 chips（两组、可复制）、父提交链接（`CommitDetailsPanel.kt:71-199`）。文件变更列表与签名状态不进（Java 面板内本来也没有）
2. **CommitGraph 行默认列**：Subject + Author + Date；tag chips 默认关闭（`VcsLogApplicationSettings.kt:113`）
3. **RepoPage 最近列表项**：显示名三级回退（`.idea/.name` → 目录名 → 路径；`RecentProjectsManagerBase.kt:1123-1184`）、路径副文本（user-home 相对化）、移除动作（带确认；`RemoveSelectedProjectsAction.kt:19-77`）、最近优先/去重/上限 50
4. **DiffPage**：默认并排；忽略空白开关（默认不忽略，对齐 Java DEFAULT）
5. **RepoStatusBar ahead/behind 形态**：彩色圆点徽标（蓝 incoming / 绿 outgoing）+ tooltip 计数，两者为 0 不显示——**Java 2025 版已无 ↑↓ 数字文本**，勿做旧版形态
6. **默认值文档化**：logInEditor=true、word diff（BY_WORD）、行号开、sync scroll 开——全部与 Java 一致

**两处前提修正**（写入实现约束）：状态条无 ↑↓ 文本；详情面板无操作按钮（动作在右键菜单，首跑不提供按钮与 Java 完全一致）。

---

## 7. 测试与验收标准

| 层 | 测试 |
|----|------|
| core 增补（readFileAtRev、streamGit 取消） | 真实 git fixture；130/预检/break 三断言 |
| api 增补（signal 透传、events.ts、getFileVersions） | 真实 git fixture；事件流首事件与变化检测 |
| graph-layout | testData 行为等价夹具 |
| git-ui / git-client | Testing Library + mock SSE/fetch |
| web-next / web-koa 路由 | Request→Response 装配测试 + SSE 断开回归 |

**验收标准（首跑完成定义）**：
1. http://localhost:3030 与 http://localhost:3031 均可打开 RepoPage，打开真实仓库后看到 CommitGraph（真图渲染）
2. log 首屏快照 + SSE 增量渲染工作；断开页面后 git 进程被终止（无泄漏）
3. DiffPage：Monaco 并排/行内切换、忽略空白开关、staged/工作区切换正确
4. RepoStatusBar 徽标/tooltip 与 `/events` 推送触发 revalidate
5. 提交详情面板字段集完整（第 6 节 #1）
6. `pnpm typecheck` → `pnpm format` → `pnpm test` 全绿；eslint 边界（apps 互禁、api 禁框架）生效

---

## 8. 落地顺序（writing-plans 细化）

1. 依赖安装（两 app + ui/client 的 deps，锁 vite 7.3.6）+ 包配置（next.config/vite.config/tsconfig）
2. core/api 增补：streamGit 取消对齐 + readFileAtRev + signal 透传 + events.ts + getFileVersions（含三个取消断言与事件测试）
3. graph-layout：移植 + testData 夹具
4. ui：base（VirtualList/GraphCanvas/MonacoDiffView）→ domain（CommitGraph/RepoStatusBar/DiffViewer/CommitDetailsPanel）→ composite（三页面）
5. client：SWR/SSE hooks
6. web-next：壳 + 路由（含 SSE）+ 页面挂载 → 3030 可跑
7. web-koa：路由 + 中间件 + Vite SPA → 3031 可跑
8. UX 对齐 6 项逐项落地
9. 全链验收（第 7 节标准）+ 终审 + 合并决策

---

## 附录 A：UX 一致性对照（Java 版 vs 本设计，审计 2026-09-01）

结论：**无 ❌ 不一致项**；6 项 ⚠️ 已并入第 6 节；📌 推迟项与"明确不做"项如下。

### A.1 打开仓库/克隆/最近项目

| Java 侧证据 | 判定 |
|-------------|------|
| 最近列表最近优先、渲染面板 `RecentProjectPanel.java:486-557` | ✅ |
| 显示名三级回退 `RecentProjectsManagerBase.kt:1123-1184` | ⚠️→§6.3 |
| 路径副文本 user-home 相对 `RecentProjectPanel.java:521-557` | ⚠️→§6.3 |
| 移除动作+确认 `RemoveSelectedProjectsAction.kt:19-77` | ⚠️→§6.3 |
| 顺序最近优先/去重/上限 50 `RecentProjectsManagerBase.kt:387-434` | ⚠️→§6.3 |
| 打开路径表单 | ✅ |
| 欢迎屏整体 `FlatWelcomeFrame.kt:111-125` | 明确不做（RepoPage 取代） |
| 克隆对话框（URL+Directory+浅克隆行；新版无 Test/分支选择）`VcsCloneDialog.kt:33-131` | 📌 推迟（P2 补 UI，最小字段 URL+Directory） |
| 列表项分支后缀/图标/失效标记 | 📌 推迟（装饰性） |

### A.2 VCS Log UI

| Java 侧证据 | 判定 |
|-------------|------|
| CommitGraph（图+refs chips）`VcsLogGraphTable.java:176` | ✅ |
| 按 HEAD 着色 `GraphColorGetterByHead.kt:11-17` | ✅（§3.1 移植） |
| HEAD 装饰/实心描边 `GraphTableModel.kt:102-117` | ✅ |
| tag chips 默认关 `VcsLogApplicationSettings.kt:113` | ⚠️→§6.2 |
| 行默认列 Subject/Author/Date `VcsLogColumnManager.kt:31` | ⚠️→§6.2 |
| 详情面板 `CommitDetailsPanel.kt:56` | ✅ |
| 详情字段集 `CommitDetailsPanel.kt:71-199` | ⚠️→§6.1 |
| 文件变更列表（独立 `VcsLogChangesBrowser`） | 📌 推迟（Java 面板内也没有） |
| 操作按钮（面板内无，右键菜单） | ✅（首跑不提供 = 与 Java 面板一致；动作属 P3） |
| 过滤/搜索（文本即滤 Ctrl+L + 分支弹窗为高频）`VcsLogClassicFilterUi.kt:148-152` | 明确不做（P2 次优先补文本即滤+分支弹窗） |
| 分支折叠 | 明确不做 |
| showInEditor=true `VcsLogApplicationSettings.kt:145-146` | ✅（logInEditor=true；TS 免重启为改进） |

### A.3 Diff 查看器

| Java 侧证据 | 判定 |
|-------------|------|
| 并排/统一两模式 `DiffRequestProcessor.java:937-1040` | ✅（Monaco side-by-side/行内） |
| 默认并排（独立对话框）`DiffManagerImpl.kt:95-101` | ⚠️→§6.4 |
| 行号/语法高亮 | ✅（Monaco） |
| word diff BY_WORD 默认 `TextDiffSettingsHolder.kt:46` | ✅（§6.6 文档化） |
| 忽略空白开关（默认不忽略）`TextDiffSettingsHolder.kt:47` | ⚠️→§6.4 |
| staged/工作区/三版本 `GitStageDiffUtil.kt:191-252` | ✅（首跑两版本；三版本属 P2 staging） |
| 提交间对比 `GitDiffFromHistoryHandler.java:86-99` | ✅（from/to） |
| 折叠开关/sync scroll/上下文行数 | 📌 推迟（默认已对齐） |
| unified 保留 `UnifiedDiffTool.java` | ✅ |

### A.4 状态条

| Java 侧证据 | 判定 |
|-------------|------|
| 分支名（长名截断）`GitBranchWidget.kt:46,64` | ✅ |
| ahead/behind 圆点徽标+tooltip，0 不显示，无 ↑↓ 文本 `GitInOutState.kt:70-109` | ⚠️→§6.5（含前提修正） |
| 进行中操作前缀 `GitBranchUtil.java:193-204` | 明确不做（P2 operation.ts） |
| 点击弹窗/hover tooltip | 📌 推迟 |
| 事件驱动刷新 `DvcsStatusWidget.java:145-166` | ✅（对应 SSE /events） |

### A.5 设置

| Java 侧证据 | 判定 |
|-------------|------|
| logInEditor 默认 true + 复选框 `VcsLogConfigurable.kt:62-65` | ✅ |
| 自动 fetch（默认关，高级设置门控） | 明确不做（P3 remote/update） |
| 保护分支（默认 master/main） | 明确不做（P2 branch.ts） |

## 附录 B：推迟项清单（按优先级）

1. **P2 次优先**：log 文本即滤框 + 分支过滤弹窗（Java 高频入口）
2. **P2 补 UI**：克隆/init 对话框（最小字段 URL+Directory）
3. **P2 承接**：进行中操作状态前缀（operation.ts）、三版本对比（staging.ts）
4. **P3**：cherry-pick/revert 右键菜单动作、保护分支、自动 fetch
5. **装饰后置**：最近列表分支后缀/图标/失效标记、diff 折叠/sync/上下文设置、状态条点击弹窗
