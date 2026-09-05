# P3-C：溯源 + 文件历史 + Committed Changes 浏览器 + 提交搜索 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P3 阶段四个**只读**功能域——blame（文件逐行溯源）、history（文件历史含重命名跟随）、committed（Committed Changes 浏览器：历史提交及其变更文件浏览）、search（提交内容/信息搜索：grep 与 pickaxe）。全部以 LogPage 为入口。

**Architecture:** 沿用既有分层与两端对称路由。四个域均无写操作、无认证回路、无 operation 状态——是四域中最轻的组合。blame 用 `--line-porcelain` 解析（字段齐全含 previous 溯源行）；history 用 `git log --follow`；committed 用 `--name-status` 分页；search 用 `--grep`/`-S`。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（blame/history/committed/search 行；`GitAnnotationProvider`、`GitFileHistory`、`CommittedChangesBrowser`、`GitSearchUtils`）；前序计划关账记录（LogPage「更多」菜单先例 P3-A/P3-B）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：core/api 夹具无首提交、预置身份、默认分支名 `git symbolic-ref HEAD --short`；多提交与重命名（history --follow 的关键装置：`git mv`）在测试内造。
- 错误语义：file 不存在 → `INVALID_REF '文件不存在：…'`；query 缺参 → zod 400；其余 `GIT_ERROR`。
- 分页风格：committed 用 `limit`（默认 50、最大 200）+ `skip` 游标（沿用 log 端点先例）；search 的 limit ≤ 100。

## 端点总览（本计划新增，两端对称；全部只读 GET）

```text
GET /api/repos/:repoId/blame?file=…         → BlameLine[]
GET /api/repos/:repoId/history?file=…       → FileHistoryEntry[]
GET /api/repos/:repoId/committed?limit&skip → CommittedPage（{entries, hasMore}）
GET /api/repos/:repoId/search?q=…&mode=&limit → SearchResult[]
```

## 明确不做

- blame 逐行点开查看该行引入提交的 diff/详情（可后接：复用既有提交详情面板，本期列表展示）。
- search 的 committed 内容全文搜索（`git log -G` regex diff 内容搜索——本期只有 `-S` pickaxe 与 `--grep`）。
- history 的「双击打开该版本的该文件版本预览」（复用 diff 端点可后接）。
- committed 的按目录树分组（Java `CommittedChangesBrowser` 的文件树视图；本期平铺列表）。

---

### Task 1: contracts —— blame/history/committed/search 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
/** 溯源行（line-porcelain 逐字段）：lineno 为最终文件行号（1-based） */
export interface BlameLine {
  lineno: number;
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  dateIso: string;
  content: string;
  /** 该行由哪一行演化而来（前一次提交中的原行号；无则 null——如文件首创建） */
  previousLineno: number | null;
}

/** 文件历史条目（git log --follow 序，最新在前） */
export interface FileHistoryEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  dateIso: string;
}

/** Committed Changes 条目：一个提交及其变更文件（name-status 解析） */
export interface CommittedEntry {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  dateIso: string;
  files: { path: string; status: 'A' | 'M' | 'D' | 'R' | 'C'; renameFrom?: string }[];
}
export interface CommittedPage { entries: CommittedEntry[]; hasMore: boolean; }

/** 搜索命中：grep 命中为提交；pickaxe 命中同（match 为可选摘要） */
export interface SearchResult {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  dateIso: string;
}
export type SearchMode = 'grep' | 'pickaxe';
```

```ts
// endpoints.ts 追加
export const blameQuerySchema = z.object({ file: z.string().min(1) });
export const historyQuerySchema = z.object({ file: z.string().min(1) });
export const committedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});
export const searchQuerySchema = z.object({
  q: z.string().min(1),
  mode: z.enum(['grep', 'pickaxe']).default('grep'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
```

- [ ] **Step 1: 写失败测试** —— 各 query schema 正反例（缺 file、limit 越界、mode 枚举外）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 溯源/历史/committed/搜索端点契约"`

---

### Task 2: core —— blame 与 history 原语

**Files:**
- Create: `packages/server/core/src/blame.ts`、`packages/server/core/src/history.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/blame.test.ts`、`packages/server/core/src/history.test.ts`

**Interfaces:**
- Produces:

```ts
// blame.ts
/** --line-porcelain 解析：<hash> <orig> <final> <cnt> 起块 + 头字段（author/author-mail/author-time/previous <hash> <lineno>）+ \t 内容行。
 *  解析要点（注释写入）：porcelain 块以「新 hash 行或 EOF」结束；previous 行在重命名/编辑溯源时出现；author-time 为 epoch 秒需转 ISO */
export function fileBlame(cwd: string, file: string): Promise<BlameLine[]>;
// history.ts
/** git log --follow --format=%H%x00%h%x00%s%x00%an%x00%aI（NUL 分隔；--follow 对重命名跟随）；
 *  注意 --follow 参数序（P2-C 教训：--format 在 --follow 之前？—— 实测：--follow 为无参旗标无吞参问题，但 order 仍按 NUL 分隔先例写测试） */
export function fileHistory(cwd: string, file: string): Promise<FileHistoryEntry[]>;
```

- [ ] **Step 1: 写失败测试**：blame——两提交改同一行 → 结果行数=文件行数、行 1 归属首提交、行 2 归属次提交（hash/author/date 断言）；重命名文件（`git mv`）+ 修改 → previousLineno 非空用例。history——三提交 → 条目序列（最新在前）；`git mv` 重命名后 `fileHistory(新名)` 仍返回重命名前提交（--follow 证据）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): blame --line-porcelain 与文件历史（--follow）原语"`

---

### Task 3: core —— committed 与 search 原语

**Files:**
- Create: `packages/server/core/src/committed.ts`、`packages/server/core/src/search.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/committed.test.ts`、`packages/server/core/src/search.test.ts`

**Interfaces:**
- Produces:

```ts
// committed.ts
export interface CoreCommittedEntry { hash: string; subject: string; author: string; dateIso: string; files: { path: string; status: string; renameFrom?: string }[]; }
/** git log --name-status --format=%H%x00%h%x00%s%x00%an%x00%aI（提交节 + 文件行聚合）；支持 limit/skip（--skip 逐提交）+ hasMore（多取 1 试探） */
export function committedPage(cwd: string, opts: { limit: number; skip: number }): Promise<{ entries: CoreCommittedEntry[]; hasMore: boolean }>;
// search.ts
/** git log --grep=<q> -i（grep 模式）或 --pickaxe-regex? 否—— -S<string>（pickaxe 增量搜索）；--format=%H%x00%h%x00%s%x00%an%x00%aI + --max-count=<limit> */
export function searchCommits(cwd: string, opts: { q: string; mode: 'grep' | 'pickaxe'; limit: number }): Promise<CoreSearchResult[]>;
```

- 实现要点：`--name-status` 输出中重命名行为 `R100\t<old>\t<new>`（两个路径字段）；`-z` 不适用（name-status 的 -z 布局不同）——用非 -z 解析 + 引号还原（core 既有 `parseLogRecord` 的引号还原手法，复用/提取）；注释写明。
- [ ] **Step 1: 写失败测试**：committed——两提交各改不同文件 → entries[0] 文件集正确、entries[1] 正确；重命名提交 → status 'R' + renameFrom；limit=1 → hasMore true；skip 越界 → 空 entries + hasMore false。search——grep 模式：提交信息含「fix」→ 命中；大小写不敏感（'FIX' 命中）；pickaxe：加/删一行特定串 → `-S` 命中该提交；limit 截断；无命中 → []。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): committed 浏览器与提交搜索原语"`

---

### Task 4: api —— blame/history/committed/search 服务

**Files:**
- Create: `packages/server/api/src/blame.ts`、`packages/server/api/src/history.ts`、`packages/server/api/src/committed.ts`、`packages/server/api/src/search.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: 对应测试文件

**Interfaces:**
- Produces:

```ts
// blame.ts
export function getFileBlame(repoPath: string, file: string): Promise<BlameLine[]>; // 文件存在性预检（fs 相对路径校验沿用 staging 的 assertValidQuery 手法——path 越界 → INVALID_QUERY '非法的文件路径'，不存在 → INVALID_REF '文件不存在：…'）
// history.ts
export function getFileHistory(repoPath: string, file: string): Promise<FileHistoryEntry[]>; // 同上预检
// committed.ts
export function getCommittedPage(repoPath: string, query: CommittedPageQuery): Promise<CommittedPage>;
// search.ts
export function searchCommitsService(repoPath: string, query: SearchQuery): Promise<SearchResult[]>;
```

- index.ts 追加四行出口。
- [ ] **Step 1: 写失败测试**：blame/history 的成功矩阵 + 越界/不存在预检；committed 分页 hasMore 语义；search 两模式（含无命中 []）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 溯源/历史/committed/搜索服务"`

---

### Task 5: 两端路由 —— 四个只读端点

**Files:**
- Create: web-next 4 个 route.ts（blame、history、committed、search，各 GET）
- Modify: `apps/web-koa/src/routes/repos.ts`（4 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 4 api 出口。
- Produces（HTTP 形状）：按端点总览；zod 拒绝/预检 → 400；未注册 404。
- **实现模板**：与既有 `diff/patch` 路由完全同构（GET + query schema + Object.fromEntries/searchParams 手法）。
- [ ] **Step 1: 写失败测试** —— 两端各：blame 200 行数与内容断言；history 200 含重命名证据；committed 200 分页 hasMore；search grep/pickaxe 两模式 200；缺 file → 400；未注册 404。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): blame/history/committed/search 端点两端对称落地"`

---

### Task 6: client —— 四组 hooks

**Files:**
- Create: `packages/client/client/src/blame.ts`、`packages/client/client/src/history.ts`、`packages/client/client/src/committed.ts`、`packages/client/client/src/search.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: 对应测试文件

**Interfaces:**
- Produces（全部只读 SWR；file/q 为空串 → null key 不发请求；分页 hooks 返回完整 SWRResponse 以便容器做增量加载）：

```ts
export function useBlame(repoId: string, file: string): SWRResponse<BlameLine[]>;
export function useHistory(repoId: string, file: string): SWRResponse<FileHistoryEntry[]>;
export function useCommittedPage(repoId: string, query?: Partial<{ limit: number; skip: number }>): SWRResponse<CommittedPage>;
export function useSearch(repoId: string, q: string, mode: SearchMode): SWRResponse<SearchResult[]>; // q==='' → null key
```

- [ ] **Step 1: 写失败测试**（mock fetch + freshCache + null-key 用例）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): blame/history/committed/search hooks"`

---

### Task 7: ui —— BlameView + HistoryPanel

**Files:**
- Create: `packages/client/ui/src/composite/blame-view.tsx`、`packages/client/ui/src/composite/history-panel.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** 溯源视图（对照 GitAnnotationProvider 的展示面）：文件路径头 + 行列表（行号 | 作者 | 日期 | 内容），
 *  行按 BlameLine 渲染、hash 短名徽标可点击（onOpenCommit 可选——点开 LogPage 选中该提交，容器接线）。
 *  纯受控（file/lines/loading/error）。 */
export interface BlameViewProps { file: string; lines?: BlameLine[]; loading?: boolean; error?: string; onOpenCommit?: (hash: string) => void; }
export function BlameView(props: BlameViewProps): React.ReactNode;

/** 文件历史面板：条目列表（短哈希 + subject + 作者 + 日期）；点击回调 onSelectCommit。
 *  空态 EmptyState；行快捷键与样式沿既有面板约定。 */
export interface HistoryPanelProps { file: string; entries?: FileHistoryEntry[]; loading?: boolean; error?: string; onSelectCommit?: (hash: string) => void; }
export function HistoryPanel(props: HistoryPanelProps): React.ReactNode;
```

- [ ] **Step 1: 写失败测试**：BlameView 行数/内容/加载态/错误态/onOpenCommit；HistoryPanel 列表/空态/点击。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**（列表用 Flex vertical，antd List 弃用约定）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): BlameView 与 HistoryPanel"`

---

### Task 8: ui —— CommittedChangesPanel + SearchPanel

**Files:**
- Create: `packages/client/ui/src/composite/committed-changes-panel.tsx`、`packages/client/ui/src/composite/search-panel.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** Committed Changes 浏览器（对照平台 CommittedChangesBrowser 的平铺版）：提交列表左栏 + 选中提交的文件列表右栏（状态徽标 A/M/D/R + renameFrom）+ 文件点击 → onOpenFile(path, from, to)（容器接 diff 页）。
 *  滚动到底自动加载更多（「加载更多」按钮，属组件内简单状态：page 数据由容器注入，本组件只显示与回调）。 */
export interface CommittedChangesPanelProps {
  page?: CommittedPage;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  selectedHash?: string;
  onSelectCommit?: (hash: string) => void;
  onOpenFile?: (path: string, from: string, to: string) => void;
}
export function CommittedChangesPanel(props: CommittedChangesPanelProps): React.ReactNode;

/** 提交搜索面板：搜索框（q + mode 选择：信息 grep / 内容 pickaxe）+ 结果列表（点击 → onSelectCommit）。 */
export interface SearchPanelProps {
  onSearch: (q: string, mode: SearchMode) => void;
  results?: SearchResult[];
  searching?: boolean;
  error?: string;
  onSelectCommit?: (hash: string) => void;
}
export function SearchPanel(props: SearchPanelProps): React.ReactNode;
```

- [ ] **Step 1: 写失败测试**：提交列表/文件徽标/renameFrom 显示/onOpenFile 载荷（from=parent? 容器负责解析——本组件只传 path+hash，容器接 diff 端点 by hash：载荷改为 `onOpenFile?(path: string, hash: string)`）；搜索提交/结果/模式切换。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): CommittedChangesPanel 与 SearchPanel"`

---

### Task 9: 页面装配 —— 两端四页面 + LogPage 入口

**Files:**
- Create: web-next 4 页面（blame/history/committed/search）+ web-koa 4 页面
- Modify: `apps/web-koa/src/main.tsx`（4 Route）；`packages/client/ui/src/composite/log-page.tsx`（「更多」菜单追加 溯源/历史/已提交/搜索 入口——可选 props `onOpenBlame?/onOpenHistory?/onOpenCommitted?/onOpenSearch?`）；两端容器注入导航
- Test: `log-page.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 6 hooks + Task 7/8 组件。
- Produces：路由 `/repos/:repoId/blame|history|committed|search`（两端）；LogPage 四入口。
- 容器要点：blame/history 页取 `?file=` 查询串（LogPage 选中提交后经 onOpenBlame(file)/onOpenHistory(file) 跳转 + 容器默认展示当前 worktree 的常用文件列表？**v1 简化**：页面只有 file 查询串驱动；无 file 时提示空态「从日志页选择文件进入」（LogPage 的 CommitDetailsPanel 文件列表才是入口——**注意**：CommitDetailsPanel 已显示 diff？无——当前 CommitDetailsPanel 只显示提交元信息。**落点补充**：CommitDetailsPanel 追加文件列表（`git log -1 --name-only` 数据从 log 端点已有？CommitInfo 无文件字段——**简化裁定**：加入可选的「文件」区数据源为容器调用既有 log 端点不成立，v1 用页面内文件路径输入框（手动粘贴路径）+ LogPage 入口直接带空态提示。**再裁定（终）**：blame/history/committed/search 四个入口在「更多」菜单里指向空态页 + 页内文件/查询输入；DiffPage 与 LogPage 不增加侵入性改造。若后续要做「CommitDetailsPanel 文件列表」，作为独立增强。
- 冒烟：两端真实仓库——blame 页（文件输入 → 行数据）；history 重命名证据；committed 分页 + 打开 diff（onOpenFile → `/repos/:repoId/diff?file=&from=<commit>~1&to=<commit>`——diff 端点支持 from/to ✓）；search grep/pickaxe 各一；四入口渲染导航。
- [ ] **Step 1: 写失败测试**（log-page 四入口用例）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `git commit -m "feat(apps): 溯源/历史/committed/搜索四页面两端落地与 LogPage 入口"`

---

## 自审记录

- Spec 覆盖：§4.2 四行全落地（blame ✓ history ✓ 含 --follow；committed ✓ 分页浏览器；search ✓ grep+pickaxe：「Search Everywhere 提交/分支搜索」中分支搜索已有 BranchPanel，提交搜索本期交付）。
- 类型一致性：BlameLine/FileHistoryEntry/CommittedEntry/CommittedPage/SearchResult/四 query schema/组件 Props 跨任务签名已对齐。
- 简化裁定：CommitDetailsPanel 不加文件列表（四页面用页内输入 + 空态引导；「提交详情文件列表」独立增强后置）；committed 打开 diff 的 from/to 映射由容器解析 `${hash}~1`（diff 端点已支持 from/to）。
- 风险：`--name-status` 的非 -z 解析对含引号文件名的还原——复用 core 既有引号还原手法并在注释写明；blame porcelain 的 previous 字段在重命名场景的语义已标注。


---

## 关账记录（2026-09-03）

9/9 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: With fixes**——1 Important（日期漂移：blame UTC 墙钟 vs %aI 作者时区，终审查了真实消费者发现 ui formatCommitDate 只做字符串截取不解析 Date——per-task 裁定问了正确问题但没查消费者）+ 2 条计划缺陷（根提交 `~1` 无效——计划 Task 9 冒烟假定恒有父提交；from/to 下 staged 切换无效可达）+ 2 Minor，修复波（commit `db24c8e`，25 文件）经限定复审全部 ADDRESSED、零新破坏，正式关账。

**Rulings（控制器裁决记录）**：
1. previousLineno 用块头 orig 代理（brief 的 `previous <hash> <lineno>` 为事实错误，git 实际 `<hash> <路径>`；代理方向正确，两处字段注释已联动修正近似边界）。
2. committed 缺失侧 → `''`（P1 缺口扩权修复，范围克制：仅 from/to 分支，M/工作区/staged 零接触）；R 重命名由容器显示"涉及重命名"提示行（双路径 rename diff 超单文件契约，后续增强）。
3. 时间语义统一为「%aI 等价偏移 ISO + 消费方字符串截取」（author-tz 解析 + formatAuthorIso）；四处"new Date() 消费"JSDoc 谎言同步纠正（api/history.ts:4-5 两条残余 doc 断言已记 Minor 待下次触碰）。
4. 根提交降级为提示行（无父 → 不发 diff 请求，diff 容器丢弃 to-only 路径的 XOR 语义）；merge 提交显示「合并提交」提示。
5. 契约 status 联合补 'T'（typechange，brief 缺口）。

终审 triage：16 项 deferred 中 #3（JSDoc 删句）/ #9（根提交）/ #10（staged 切换）随修复波落地，其余 safe-to-defer；hardening 新增 ㉔-㉗（见任务 9 Minor 结转）。SDD 工作区已按规程删除，本提交为记录。