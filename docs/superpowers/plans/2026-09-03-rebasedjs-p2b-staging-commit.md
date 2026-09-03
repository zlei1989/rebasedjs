# P2-B：暂存区 + 提交 + StatusPage 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P2 阶段核心工作流——staging（暂存/取消暂存/放弃修改，文件级 + hunk 级 API）与 commit（提交/amend/sign-off/no-verify），交付 StatusPage（Local Changes + 暂存区 + 提交框）页面，并把已实现但未挂端点的 `getFileDiff` 接到 `GET …/diff/patch`（StatusPage 行内补丁预览消费）。

**Architecture:** 沿用 P1/P2-A 分层与两端对称路由模式。hunk 级操作由服务端从 `git diff` 全文切分 hunk、按索引子集重组 patch 后 `git apply`（`--cached`/`-R` 组合）执行；客户端只传 hunk 索引，不传 patch 文本。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（staging/commit 行）、§4.3（命名模式：写操作 POST + {action}）、§4.5.2（`GitStage*` → StatusPage 暂存区对照）；前序计划 `docs/superpowers/plans/2026-09-03-rebasedjs-p2a-config-operation.md`。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动不调接口；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端（web-next / web-koa）端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`（可 `pnpm --filter` 单跑相关包，提交前全量一次）。
- 写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/` 相关指南；写 UI 前用 context7 查 antd 用法或严格沿用仓内既有用法。
- 提交信息沿用 `feat:`/`fix:`/`test:` 中文摘要风格。
- 错误语义：服务层只抛 `ServiceError`（中文 message）；git 失败经 `toServiceError` → `GIT_ERROR` 带 stderr。

## 端点总览（本计划新增，两端对称）

```text
POST /api/repos/:repoId/staging         {action:'stage'|'unstage'|'discard', paths:string[]} → RepoStatus（刷新后）
POST /api/repos/:repoId/staging/hunks   {action:'stage'|'unstage'|'discard', file:string, hunks:number[]} → RepoStatus
GET  /api/repos/:repoId/diff/patch?file&staged → DiffFile（unified 全文；getFileDiff 已有实现，本计划挂端点）
POST /api/repos/:repoId/commit          {message, amend?, signOff?, noVerify?} → {hash:string}
```

## 明确不做（留给后续计划）

- StatusPage 的 hunk 级展开 UI（三版本对比视图）：hunk 端点本期可用，UI 并入 DiffPage 增强计划。
- commit & push / push up to commit（属 P3 remote.ts）；GPG 签名界面、commit template、CRLF 提示（commit.ts 后续扩展）。
- changelist 多列表（P2-G 独立计划；本期 StatusPage 单列表）。

---

### Task 1: contracts —— staging/commit 契约

**Files:**
- Modify: `packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加 describe）

**Interfaces:**
- Produces:

```ts
/** 暂存区文件级操作：stage=加入暂存（git add）；unstage=移出暂存（git restore --staged）；discard=放弃修改（按条目状态分派 restore/clean） */
export const stagingBodySchema = z.object({
  action: z.enum(['stage', 'unstage', 'discard']),
  paths: z.array(z.string().min(1)).min(1),
});
export type StagingBody = z.infer<typeof stagingBodySchema>;

/** hunk 级操作：hunks 为 GET diff/patch 返回全文的 hunk 索引（0-based，按出现顺序） */
export const hunkStagingBodySchema = z.object({
  action: z.enum(['stage', 'unstage', 'discard']),
  file: z.string().min(1),
  hunks: z.array(z.number().int().min(0)).min(1),
});
export type HunkStagingBody = z.infer<typeof hunkStagingBodySchema>;

/** 提交请求体：message 必填；amend 改上次提交；signOff 追加 Signed-off-by；noVerify 跳过 hooks */
export const commitBodySchema = z.object({
  message: z.string().min(1),
  amend: z.boolean().optional(),
  signOff: z.boolean().optional(),
  noVerify: z.boolean().optional(),
});
export type CommitBody = z.infer<typeof commitBodySchema>;
```

- [ ] **Step 1: 写失败测试** —— 三个 schema 各一正一反用例（反例：paths 空数组、hunks 含 -1、message 空串、action 枚举外值）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**（按上方代码追加；`export *` 已自动出口）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 暂存区与提交端点契约"`

---

### Task 2: core —— exec stdin 支持 + staging/commit 原语

**Files:**
- Modify: `packages/server/core/src/exec.ts`（`runGit` opts 增加 `input?: string`）
- Create: `packages/server/core/src/staging.ts`、`packages/server/core/src/commit.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/staging.test.ts`、`packages/server/core/src/commit.test.ts`、`packages/server/core/src/exec.test.ts`（追加 stdin 用例；文件不存在则新建）

**Interfaces:**
- Consumes: `runGit`、`GitExitError`；测试夹具 `createTmpRepo/cleanupTmpRepo`。
- Produces:

```ts
// exec.ts 修改：opts 类型变为 { cwd: string; signal?: AbortSignal; timeoutMs?: number; input?: string }
// input 存在时写 child.stdin 后 end（git apply 等从 stdin 读 patch 的命令用）

// staging.ts
/** 把 paths 加入暂存区（git add --） */
export function stagePaths(cwd: string, paths: string[]): Promise<void>;
/** 把 paths 移出暂存区（git restore --staged --） */
export function unstagePaths(cwd: string, paths: string[]): Promise<void>;
/** 放弃工作区修改（git restore --worktree --，文件回到 index 版本） */
export function discardPaths(cwd: string, paths: string[]): Promise<void>;
/** 删除未跟踪文件（git clean -f --，discard 对 ?? 条目的分派） */
export function cleanUntracked(cwd: string, paths: string[]): Promise<void>;
/** 应用 patch 文本：cached=--cached（作用于暂存区），reverse=-R（反向） */
export function applyPatch(cwd: string, patch: string, opts: { cached?: boolean; reverse?: boolean }): Promise<void>;

// commit.ts
/** 提交暂存区：message 经 -m 单参数传入（多行安全）；返回新提交哈希（rev-parse HEAD） */
export function commitStaged(cwd: string, opts: { message: string; amend?: boolean; signOff?: boolean; noVerify?: boolean }): Promise<string>;
```

- index.ts 追加：`export { applyPatch, cleanUntracked, discardPaths, stagePaths, unstagePaths } from './staging';` 与 `export { commitStaged } from './commit';`

- [ ] **Step 1: 写失败测试**

staging.test.ts（tmp repo；断言用 `getStatus` 的 entries code 变化）：
- 改既有文件 → `stagePaths` 后 code 以 `M.` 开头（X=M）；`unstagePaths` 后回到 `.M`。
- 新文件 → `discardPaths` 对未跟踪条目语义不在此测（cleanUntracked 单测：`??` 文件被删除）。
- `applyPatch`：造两处相隔足够远的修改（两个 hunk）→ `collectFileDiff` 取全文 → 手工拼"头 + 第二个 hunk"的 patch 文本 → `applyPatch(cwd, patch, {cached:true})` → `git diff --cached` 只含第二个 hunk 的变更（断言 diff --cached 输出含/不含特定行）。

commit.test.ts：tmp repo 改文件 + stage → `commitStaged` 返回 40 位十六进制 hash；`git log -1 --format=%s` 等于 message；`amend` 后提交数不变；`signOff` 后 `git log -1 --format=%B` 含 `Signed-off-by`。

exec stdin 用例：`runGit(['hash-object','--stdin'], { cwd, input: 'hello' })` stdout 为已知 blob 哈希（`ce013625030ba8dba906f756967f9e9ca394464a`）。

- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**（exec.ts 仅加 stdin 分支，不动既有取消/超时语义；`git apply` 参数顺序 `['apply', ...(cached?['--cached']:[]), ...(reverse?['-R']:[])]`，patch 经 input 传入）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): runGit stdin 支持与暂存/提交原语"`

---

### Task 3: api —— staging.ts / commit.ts / diff patch 出口

**Files:**
- Create: `packages/server/api/src/staging.ts`、`packages/server/api/src/commit.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/staging.test.ts`、`packages/server/api/src/commit.test.ts`

**Interfaces:**
- Consumes: Task 2 core 出口；既有 `getRepoStatus`（`./status`，操作后返回刷新状态——注意 api 文件互调只走 index.ts：staging.ts 内 `import { getRepoStatus } from './index'` 会形成循环，故**允许在本文件直接 `import { getRepoStatus } from './status'`**——这是既有同层调用的务实例外，eslint 边界规则只管包间不管包内；若 lint 报错则改为路由层先调操作再调 getRepoStatus 组装）。
- Produces:

```ts
// staging.ts
/** 文件级暂存操作：按 action 分派 core；discard 时先取 status，?? 条目走 cleanUntracked、其余走 discardPaths；返回刷新后的 RepoStatus */
export function applyStaging(repoPath: string, body: StagingBody): Promise<RepoStatus>;

/** hunk 级暂存操作：collectFileDiff 取 file 的 unified 全文 → 切分为"头部 + hunks 数组" → 按 body.hunks 索引子集重组 patch → applyPatch 执行。
 *  映射规则：stage→对工作区 diff（staged:false）apply --cached；unstage→对暂存 diff（staged:true）apply --cached -R；discard→对工作区 diff apply -R（放弃工作区修改）。
 *  索引越界 → ServiceError('INVALID_QUERY', 'hunk 索引超出范围') */
export function applyHunkStaging(repoPath: string, body: HunkStagingBody): Promise<RepoStatus>;
```

```ts
// commit.ts
/** 提交暂存区：前置检查 user.name/user.email 生效值（缺失 → ServiceError('INVALID_QUERY', '未配置 user.name 或 user.email，请先在设置页配置')）；提交后返回新哈希 */
export function createCommit(repoPath: string, body: CommitBody): Promise<{ hash: string }>;
```

- index.ts 追加：`export { applyHunkStaging, applyStaging } from './staging';`、`export { createCommit } from './commit';`；`getFileDiff` 已在出口（既有）。

**hunk 切分算法（写进代码注释）**：unified 文本按行扫描——`diff --git` 起至首个 `@@` 前为头部；每个 `@@ ... @@` 行开启一个 hunk，行至下一 `@@` 或文件尾。重组 = 头部 + 选中 hunk 原文拼接（保持行尾 `\n`；末行 `\ No newline at end of file` 归属其上方 hunk）。

- [ ] **Step 1: 写失败测试**

staging.test.ts（tmp repo）：
- `applyStaging(repo, {action:'stage',paths:['a.txt']})` 返回 entries 中 a.txt code `M.` 开头。
- 新建未跟踪文件 + 已跟踪修改各一，`discard` 混合 paths → 未跟踪文件被删除、已跟踪修改还原（status entries 为空）。
- `applyHunkStaging`：造两 hunk 文件 → stage hunk [1] → `git diff --cached -- a.txt` 只含第二处修改；`unstage` 同索引回退；`discard` 后工作区该 hunk 还原。越界 `hunks:[99]` → rejects `INVALID_QUERY`。

commit.test.ts：配置好 user.name/email 的 tmp repo（fixture 或测试内 setGitConfigLocal）→ stage + `createCommit({message:'测试提交'})` → hash 40 位、`git log -1 --format=%s` 为"测试提交"；缺 user.name/email 的 repo（用 `git config --local --unset` 或新 repo + 环境隔离 HOME 指向空目录避免读到全局配置——用 `runGit` env 不可控，改为：`createTmpRepo` 后 `git config --local user.name ''`? 空串视为已设置。务实做法：直接断言无配置时报错——用 `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` 环境隔离不可行（runGit 固定 env）。改为：mock 场景跳过，该前置检查用纯函数单测（抽出 `assertCommitIdentity(entries: CoreConfigEntry[])` 纯函数，单测覆盖缺失抛错分支），集成测试只覆盖成功路径。

- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**（含 `assertCommitIdentity` 纯函数导出供测试）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 暂存区与提交服务（文件级 + hunk 级）"`

---

### Task 4: 两端路由 —— staging/commit/diff.patch 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/staging/route.ts`（POST）、`apps/web-next/app/api/repos/[repoId]/staging/hunks/route.ts`（POST）、`apps/web-next/app/api/repos/[repoId]/commit/route.ts`（POST）、`apps/web-next/app/api/repos/[repoId]/diff/patch/route.ts`（GET）
- Modify: `apps/web-koa/src/routes/repos.ts`（4 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 3 api 出口 + 既有 `getFileDiff`（diff/patch 用，query 复用 `diffQuerySchema`）。
- Produces（HTTP 形状，client 依赖）：
  - `POST …/staging` / `…/staging/hunks` → `200 RepoStatus`；zod 拒绝/越界 → 400
  - `GET …/diff/patch?file=…&staged=…` → `200 DiffFile`（`{path,text}`）
  - `POST …/commit` → `200 {hash}`；缺 identity → 400 `INVALID_QUERY`

**实现模板**与 P2-A Task 4 相同（三件套）；diff/patch 的 GET 与既有 `diff/route.ts` 同构，仅把 `getFileVersions` 换成 `getFileDiff`。

- [ ] **Step 1: 写失败测试** —— 两端各：tmp repo openRepo → 改文件 → `POST staging {action:'stage',paths:[…]}` 200 且 entries 反映；`POST staging/hunks` 越界 → 400；`GET diff/patch?file=…` 200 且 text 以 `diff --git` 开头；配置 identity 后 `POST commit {message:'x'}` 200 且 hash 40 位；zod 反例各一（空 paths、空 message）→ 400。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): staging/commit/diff.patch 端点两端对称落地"`

---

### Task 5: client —— staging/commit/patch hooks

**Files:**
- Create: `packages/client/client/src/staging.ts`、`packages/client/client/src/commit.ts`
- Modify: `packages/client/client/src/diff.ts`（追加 `useDiffPatch`）、`packages/client/client/src/index.ts`
- Test: `packages/client/client/src/staging.test.ts`、`packages/client/client/src/commit.test.ts`、`packages/client/client/src/diff.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// staging.ts —— 两个 mutation 成功后由调用方 invalidate status（hooks 不持业务逻辑，只回写自身 key）
/** 文件级暂存操作：POST /api/repos/:repoId/staging，响应（最新 RepoStatus）回写 status SWR 缓存键 */
export function useStaging(repoId: string): { trigger: (body: StagingBody) => Promise<RepoStatus>; isMutating: boolean };
/** hunk 级暂存操作：POST …/staging/hunks，响应同样回写 status 缓存 */
export function useHunkStaging(repoId: string): { trigger: (body: HunkStagingBody) => Promise<RepoStatus>; isMutating: boolean };

// commit.ts
/** 提交：POST …/commit → {hash}；成功后由调用方触发 log/status 刷新（events 推送亦覆盖） */
export function useCommit(repoId: string): { trigger: (body: CommitBody) => Promise<{ hash: string }>; isMutating: boolean };

// diff.ts 追加
/** 单文件 unified 补丁全文：GET …/diff/patch?file&staged（StatusPage 行内预览、hunk 索引顺序即此全文顺序） */
export function useDiffPatch(repoId: string, file: string, staged: boolean): SWRResponse<DiffFile>;
```

- 缓存键约定（页面装配依赖）：status 的 SWR key 为 `` `/api/repos/${repoId}/status` ``；staging mutation 用 `populateCache: true, revalidate: false` 回写该 key（`useSWRMutation` 第二个参数外指定 `populateCache` 只回写自身 key——**故实现上用全局 `mutate(key, data, {revalidate:false})` 显式回写 status key**，测试断言此行为）。

- [ ] **Step 1: 写失败测试**（mock fetch 手法沿用既有）：staging trigger 后 fetch 收到正确 method/body 且 status key 缓存被回写为响应值；commit trigger 返回 `{hash}`；useDiffPatch 查询串含 `file` 与 `staged`。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): staging/commit/patch hooks"`

---

### Task 6: ui —— StatusPage 组合页面

**Files:**
- Create: `packages/client/ui/src/composite/status-page.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: `packages/client/ui/src/composite/status-page.test.tsx`

**Interfaces:**
- Consumes: 契约 `RepoStatus`、`ChangeEntry`、`DiffFile`；既有组件风格参照 `repo-page.tsx`/`log-page.tsx`。
- Produces:

```tsx
/** 状态页（Local Changes + 暂存区 + 提交框）：
 *  变更按 porcelain XY 码分三组——已暂存（X ∈ MADRC）、工作区（Y ∈ MDT 或 X 无效）、未跟踪（??；!! 已忽略条目不展示）。
 *  纯 props 驱动：数据与全部回调由容器注入。 */
export interface StatusPageProps {
  status: RepoStatus;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onCommit: (body: CommitBody) => void;
  committing?: boolean;
  /** 行内补丁预览：返回该文件的 unified 全文数据与加载态（容器接 useDiffPatch 按选中文件取数） */
  patch?: DiffFile;
  patchLoading?: boolean;
  onSelectPatch?: (path: string, staged: boolean) => void;
  /** 跳 diff 页（行双击或"查看对比"按钮） */
  onOpenDiff?: (path: string, staged: boolean) => void;
}
export function StatusPage(props: StatusPageProps): React.ReactNode;
```

**实现要点：**
- 布局：左/上为两个 `Card`（"已暂存（n）"、"工作区（n）"、"未跟踪（n）" 三个 `List` 或用 `Tabs`），行为 `Checkbox` + 路径文本 + code 徽标（M/A/D/R）；组头"全选"Checkbox + 组级操作按钮（工作区组：暂存/放弃；暂存组：取消暂存；未跟踪组：暂存/删除——删除即 discard 语义）。放弃/删除走 `Popconfirm`。
- 行点击选中 → `onSelectPatch(path, staged)`，下方/右侧 `Card` 渲染 `patch.text`（等宽 `Typography.Paragraph` code 或 `pre` 样式 Tailwind 类，`patchLoading` 时 `Skeleton`）。
- 提交框 `Card`：`Input.TextArea`（message，自适应行数）+ `Checkbox` amend / signOff / noVerify + `Button`（primary，"提交"，loading=committing，message 为空禁用）。amend 时 textArea 留空表示沿用原 message？否——amend 必须给新 message（服务端 git commit --amend -m），占位提示"修改上一次提交的提交信息"。
- 暗色主题沿用；不裸写 div（Space/Flex/List/Card）。
- 分组纯函数 `groupChanges(entries: ChangeEntry[])` 导出（容器/测试复用）：返回 `{ staged: ChangeEntry[]; unstaged: ChangeEntry[]; untracked: ChangeEntry[] }`——X∈`MADRC` 入 staged；Y∈`MDT` 或 code==='??' 之外且 Y 有效入 unstaged；`??` 入 untracked；`!!` 丢弃。注意同一条目可能同时入 staged 与 unstaged（X、Y 都有效），与 git status 短格式双列语义一致。

- [ ] **Step 1: 写失败测试**：`groupChanges` 分组用例（`M.`→staged；`.M`→unstaged；`MM`→两组同现；`??`→untracked；`!!`→丢弃；`A.`→staged）；渲染：三组计数徽标；勾选工作区文件点"暂存"→ onStage 以该路径数组调用；点"放弃"经 Popconfirm 确认→ onDiscard；提交框空 message 禁用、输入后点击→ onCommit 以 `{message}` 调用；patch 预览区在 patchLoading 时显骨架。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): StatusPage 状态页（分组列表 + 补丁预览 + 提交框）"`

---

### Task 7: 页面装配 —— 两端 status 路由 + LogPage 入口

**Files:**
- Create: `apps/web-next/app/repos/[repoId]/status/page.tsx`
- Create: `apps/web-koa/src/pages/status.tsx`
- Modify: `apps/web-koa/src/main.tsx`（Route `/repos/:repoId/status`）
- Modify: `packages/client/ui/src/composite/log-page.tsx`（顶栏加"变更"入口按钮，可选 prop `onOpenStatus?: () => void`）
- Modify: `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（注入 onOpenStatus 导航）
- Test: `packages/client/ui/src/composite/log-page.test.tsx`（追加入口按钮用例）

**Interfaces:**
- Consumes: Task 5 hooks + Task 6 StatusPage；既有 `useRepoStatus`/`useRepoEvents`。
- Produces：路由 `/repos/:repoId/status`（两端）；LogPage 顶栏入口。

**实现要点：**
- status 页面容器（两端同构）：`useRepoStatus(repoId)` 取 status；`useStaging/useHunkStaging`（本页只用文件级 useStaging，useHunkStaging 留给 DiffPage 增强）+ `useCommit`；选中文件态 `const [patchSel, setPatchSel] = useState<{path:string;staged:boolean}|null>(null)` → `useDiffPatch(repoId, patchSel?.path ?? '', patchSel?.staged ?? false)` 仅在选中时启用（SWR 条件请求：key 为 null 时不发请求——`useSWR(patchSel ? key : null)`，useDiffPatch 增加可选启用参数或容器直接用条件渲染包裹子 hook——**hooks 不能条件调用**：给 useDiffPatch 加第三参 `enabled` 或将 file 允许为空串且空串时 key 传 null。选后者：file === '' 时内部 key 为 null）。
- 操作失败统一 `message.error(err.message)`；成功后 staging 缓存已由 hook 回写，commit 成功后清空提交框并 `mutate` status（events 推送亦会覆盖）。
- onOpenDiff → 路由到既有 `/repos/:repoId/diff?file=…`（web-next `useRouter().push`，koa `useNavigate`）。
- LogPage 顶栏："变更"按钮（`DiffOutlined` 或 `UnorderedListOutlined`）在设置按钮旁。

- [ ] **Step 1: 写失败测试** —— log-page 入口按钮用例；StatusPage 容器以 typecheck + 冒烟兜底。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现全部修改**（含 useDiffPatch 的 enabled/空 file 语义调整与既有调用兼容——DiffPage 用的是 useFileDiff，不受影响）。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `pnpm typecheck && pnpm format && pnpm test`；冒烟：两端打开真实仓库 → 日志页"变更"入口 → StatusPage 暂存/提交全链路（命令行 `git status`/`git log` 复核）；`git commit -m "feat(apps): StatusPage 两端落地与 LogPage 变更入口"`

---

## 自审记录

- Spec 覆盖：§4.2 staging（add/取消暂存/放弃/hunk 级——文件级 UI + hunk 级 API，hunk UI 明确后置）✓；commit（提交/amend/sign-off/no-verify；modal UX 由 StatusPage 提交框承担，独立 CommitDialog 待 commit 增强计划）✓；`getFileDiff` 挂端点（审计遗留）✓。
- 类型一致性：StagingBody/HunkStagingBody/CommitBody/StatusPageProps/groupChanges 跨任务签名已对齐；useDiffPatch 空 file → null key 语义在 Task 5/7 一致。
- 风险：`git apply` 对 CRLF/权限位的 patch 敏感——hunk 重组保持原始字节（只按行切分不重排）；测试用 LF 仓库，CRLF 场景记入 ledger 待终审 triage。


---

## 关账记录（2026-09-03）

7/7 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: With fixes**——2 Important + 1 Minor 修复波（commit `08c6a02`）经限定复审全部 ADDRESSED、零新破坏，正式关账。

**Rulings（控制器裁决记录）**：
1. 计划缺陷：brief 的 exec stdin 测试期望哈希 `ce01362…` 实为 `hello\n` 的哈希；实现者修正为 `hello` 的真实哈希 `b6fc4c6…`（经审查者独立重算验证）——接受修正，断言反而更强（证明字节级透传）。
2. antd v6.6.1 `List` 运行期弃用属实（`antd/es/list` 含 Deprecated 标记）——StatusPage 行列表用 Flex 渲染，后续所有列表 UI 沿用此约定。
3. 终审 Finding 2（cleanUntracked 目录 no-op）经限定复审实测裁定为**假阳性**（显式 `dir/` pathspec 下 `clean -f` 本可删目录，git 2.47 实测）；`-fd` 作为无害硬化保留 + 新增 characterization 测试防回归。
4. 终审建议③（freshCache 提取 + useSWRConfig JSDoc）已随 Task 5 落地；流程模板「契约变更 → grep 消费方 → 同轮修复」继续沿用。

**遗留 hardening 清单**（safe-to-defer，按优先级）：①StatusPage 勾选态修剪 + 容器首载后不整树卸载（组合修复）；②koa-static SPA history fallback；③hunk 级 UI（DiffPage 增强，含 CRLF 注意）；④onOpenDiff 补 staged 查询串；⑤core 一次偶发 flaky（计时抖动，观察中）。

SDD 工作区已按规程删除，本提交为记录。