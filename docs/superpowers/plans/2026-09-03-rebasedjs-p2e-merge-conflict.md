# P2-E：合并 + 冲突 + MergeDialog/ConflictsPanel/MergeView 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P2 阶段的 merge（发起合并 + 冲突结果 + 继续合并）与 conflict（冲突列表 + 三版本内容 + 按策略解决）两个功能域，交付 MergeDialog（合并选项）、ConflictsPanel（冲突列表）、MergeView（3-way 手动合并）三个组件与两端页面；与 P2-A 已落地的 operation（合并中状态条 + 中止）形成完整合并工作流闭环。

**Architecture:** 沿用既有分层与两端对称路由。冲突三阶段内容用 `git ls-files -u` + `git show :N:path`；手动解决 = 写文件 + `git add`；合并中止复用 P2-A `POST …/operation/abort`（merge --abort），不重复实现。

**Tech Stack:** TypeScript、React 19、antd 6、Monaco（既有 MonacoDiffView/monaco-lazy）、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（merge/conflict 行：`GitMergeDialog`/`GitMergeOption`、`GitConflictsPanel`/`MergeConflictResolveUtil`）、§4.5.2（MergeDialog 合并方向/策略选项对照；ConflictsPanel + MergeView 左右 diff + 底部合并结果面板）；前序计划 P2-A…P2-D。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/`；写 UI 前用 context7 查 antd 用法或沿用仓内既有用法（Monaco 用法沿用 `ui/src/base/monaco-diff-view.tsx` / `monaco-lazy.tsx`）。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：`createTmpRepo` 无首个提交、预置 user.name/email、默认分支名用 `git symbolic-ref HEAD --short` 获取；造冲突手法沿用 P2-A task-2 brief 的 merge 冲突配方。
- 错误语义：服务层只抛 `ServiceError`（中文 message）；无进行中合并而 continue → `INVALID_QUERY`；git 失败 → `GIT_ERROR` 带 stderr。

## 端点总览（本计划新增，两端对称）

```text
POST /api/repos/:repoId/merge                  {branch, noFf?, squash?, noCommit?, message?} → MergeOutcome
POST /api/repos/:repoId/merge/continue         （无体；squash/no-commit 场景内部走 git commit）→ RepoStatus
GET  /api/repos/:repoId/conflicts              → ConflictList
GET  /api/repos/:repoId/conflicts/contents?path=… → ConflictContents
POST /api/repos/:repoId/conflicts/resolve      {strategy:'ours'|'theirs', path} | {strategy:'manual', path, content} → ConflictList（刷新后）
```

## 明确不做（留给后续计划）

- 合并方向模型（MergeDirectionModel 的多仓库/多分支矩阵，本地优先 v1 不需要）；octopus/ours/theirs 策略级合并选项（Java UI 暴露的选项为 no-ff/squash/no-commit/message，本期对齐）；rebase 冲突的 continue（属 P3 rebase 计划，届时复用 conflicts 端点）。

---

### Task 1: contracts —— merge/conflict 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加 describe）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
/** 冲突条目：stages 为存在的阶段编号（1=base 共同祖先，2=ours 当前分支，3=theirs 合并来源）；组合即冲突类型（[2,3]=双方修改，[1,2,3]=双方修改有祖先，[2]=双方新增…） */
export interface ConflictEntry {
  path: string;
  stages: number[];
}
export interface ConflictList {
  conflicts: ConflictEntry[];
}

/** 冲突三版本内容：某阶段不存在为 null（如删除方） */
export interface ConflictContents {
  path: string;
  base: string | null;
  ours: string | null;
  theirs: string | null;
}

/** 合并结果：success=合并完成（含 squash/no-commit 未产提交）；conflicts=进入合并态待解决；up-to-date=已是最新 */
export interface MergeOutcome {
  status: 'success' | 'conflicts' | 'up-to-date';
  conflicts: ConflictEntry[];
}
```

```ts
// endpoints.ts 追加
/** 合并请求体：对照 Java GitMergeDialog 选项（no-ff 禁用快进、squash 压缩、no-commit 不自动提交、message 合并信息） */
export const mergeBodySchema = z.object({
  branch: z.string().min(1),
  noFf: z.boolean().optional(),
  squash: z.boolean().optional(),
  noCommit: z.boolean().optional(),
  message: z.string().optional(),
});
export type MergeBody = z.infer<typeof mergeBodySchema>;

/** 冲突解决：ours/theirs 整侧采纳；manual 由 MergeView 保存合并结果全文 */
export const resolveConflictBodySchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('ours'), path: z.string().min(1) }),
  z.object({ strategy: z.literal('theirs'), path: z.string().min(1) }),
  z.object({ strategy: z.literal('manual'), path: z.string().min(1), content: z.string() }),
]);
export type ResolveConflictBody = z.infer<typeof resolveConflictBodySchema>;

/** 冲突内容查询：path 必填 */
export const conflictContentsQuerySchema = z.object({ path: z.string().min(1) });
export type ConflictContentsQuery = z.infer<typeof conflictContentsQuerySchema>;
```

- [ ] **Step 1: 写失败测试** —— mergeBody 正例全选项 + 反例（空 branch）；resolveConflict 判别联合三形各一正例 + 反例（manual 缺 content、枚举外 strategy）；conflictContentsQuery 反例（空 path）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**（按上方代码追加）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 合并与冲突端点契约"`

---

### Task 2: core —— merge 原语

**Files:**
- Create: `packages/server/core/src/merge.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/merge.test.ts`

**Interfaces:**
- Consumes: `runGit`、`GitExitError`、夹具。
- Produces:

```ts
// merge.ts
export interface CoreMergeResult {
  status: 'success' | 'conflicts' | 'up-to-date';
  /** git 原始输出（诊断/展示用） */
  stdout: string;
}
/** 合并 branch 到当前分支：选项映射 --no-ff/--squash/--no-commit/-m；
 *  状态判定算法：stdout 含 'Already up to date'（LC_ALL=C 固定英文）→ up-to-date；
 *  退出码非 0 且存在 MERGE_HEAD → conflicts；退出码非 0 且无 MERGE_HEAD → 原样抛 GitExitError；
 *  退出码 0 → success（squash/no-commit 时 git 不产提交也返回 0） */
export function mergeBranch(cwd: string, opts: { branch: string; noFf?: boolean; squash?: boolean; noCommit?: boolean; message?: string }): Promise<CoreMergeResult>;
/** 继续合并：git merge --continue（无 MERGE_HEAD 时由 git 报错，api 层预检） */
export function continueMerge(cwd: string): Promise<void>;
```

- MERGE_HEAD 检测：复用既有 `getOperationState`（同包直接 import `./operation`）——`kind==='merge'` 即存在。

- [ ] **Step 1: 写失败测试**（tmp repo + 冲突配方）：
  - 快进合并：side 分支多一提交 → `mergeBranch({branch:'side'})` → `status:'success'`。
  - 已最新：重复合并 → `'up-to-date'`。
  - 冲突合并：同一行双向修改 → `'conflicts'` 且 `getOperationState(cwd).kind==='merge'`。
  - `noFf` 快进场景产合并提交（`git log --format=%P -1` 有两个父）。
  - `continueMerge` 解决冲突后（手工写文件 + add）→ 合并提交产生，操作态回到 none。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): merge/continue 原语"`

---

### Task 3: core —— conflict 原语

**Files:**
- Create: `packages/server/core/src/conflict.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/conflict.test.ts`

**Interfaces:**
- Consumes: `runGit`、`GitExitError`、夹具。
- Produces:

```ts
// conflict.ts
export interface CoreConflict {
  path: string;
  stages: number[];
}
/** 未合并路径列表：git ls-files -u -z 解析（每行 <mode> <hash> <stage>\t<path>，-z 下 path 任意字符安全）；同 path 多行聚合为 stages 数组（升序去重） */
export function listConflictedPaths(cwd: string): Promise<CoreConflict[]>;
/** 读某阶段内容：git show :<stage>:<path>；不存在（GitExitError 且 stderr 含 'does not exist' 或 'exists on disk' 类）→ null */
export function readStageContent(cwd: string, path: string, stage: 1 | 2 | 3): Promise<string | null>;
/** 整侧采纳：git checkout --ours/--theirs -- path */
export function checkoutConflictSide(cwd: string, path: string, side: 'ours' | 'theirs'): Promise<void>;
/** 标记已解决：git add -- path */
export function markResolved(cwd: string, path: string): Promise<void>;
```

- [ ] **Step 1: 写失败测试**（tmp repo + 冲突配方）：
  - `listConflictedPaths` 冲突态返回 `{path:'a.txt', stages:[1,2,3]}`。
  - `readStageContent` stage 2/3 分别返回双方内容，stage 1 返回 base 内容；不存在阶段 → null（造"双方新增"冲突：无 base → stage 1 为 null）。
  - `checkoutConflictSide('theirs')` + `markResolved` 后文件内容=对方版本且 `listConflictedPaths` 为空。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): 冲突列表/三阶段内容/解决原语"`

---

### Task 4: api —— merge.ts / conflict.ts

**Files:**
- Create: `packages/server/api/src/merge.ts`、`packages/server/api/src/conflict.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/merge.test.ts`、`packages/server/api/src/conflict.test.ts`

**Interfaces:**
- Consumes: Task 2/3 core 出口；既有 `getOperation`（同层 import，`./operation`）、`getRepoStatus`、`ServiceError`。
- Produces:

```ts
// merge.ts
/** 发起合并：core mergeBranch → 契约 MergeOutcome（conflicts 时附带 getConflicts 列表）；分支不存在等 git 失败 → GIT_ERROR */
export function mergeBranchIntoCurrent(repoPath: string, body: MergeBody): Promise<MergeOutcome>;
/** 继续合并：预检 getOperation(repoPath).kind==='merge'（否则 ServiceError('INVALID_QUERY', '当前没有进行中的合并')）；squash/no-commit 场景 core continueMerge 失败（无 MERGE_HEAD 语义差异）时退化 git commit——由 core 统一处理，api 只透传；返回刷新状态 */
export function continueMergeOperation(repoPath: string): Promise<RepoStatus>;
```

```ts
// conflict.ts
/** 冲突列表（core → 契约薄映射） */
export function getConflicts(repoPath: string): Promise<ConflictList>;
/** 三版本内容（stage 1/2/3 → base/ours/theirs 字段映射） */
export function getConflictContents(repoPath: string, path: string): Promise<ConflictContents>;
/** 按策略解决：ours/theirs → checkoutConflictSide + markResolved；manual → node:fs/promises 写 content 到工作区文件后 markResolved（api 层允许 node 内置 fs；写前校验 path 在冲突列表中，不在 → ServiceError('INVALID_QUERY', '该文件没有冲突：…')）；返回刷新列表 */
export function resolveConflict(repoPath: string, body: ResolveConflictBody): Promise<ConflictList>;
```

- index.ts 追加：`export { continueMergeOperation, mergeBranchIntoCurrent } from './merge';`、`export { getConflictContents, getConflicts, resolveConflict } from './conflict';`

- [ ] **Step 1: 写失败测试**（tmp repo + 冲突配方）：mergeBranchIntoCurrent 三分支状态断言；conflicts 时 outcome.conflicts 非空；resolveConflict ours/theirs/manual 三路径后列表刷新；manual 对非冲突路径 → `INVALID_QUERY`；continueMergeOperation 无合并态 → `INVALID_QUERY`，解决全部冲突后 → 合并提交产生且返回 status。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 合并与冲突服务"`

---

### Task 5: 两端路由 —— merge/conflicts 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/merge/route.ts`（POST）、`apps/web-next/app/api/repos/[repoId]/merge/continue/route.ts`（POST）、`apps/web-next/app/api/repos/[repoId]/conflicts/route.ts`（GET）、`apps/web-next/app/api/repos/[repoId]/conflicts/contents/route.ts`（GET）、`apps/web-next/app/api/repos/[repoId]/conflicts/resolve/route.ts`（POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（5 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 4 api 出口。
- Produces（HTTP 形状）：`POST …/merge` → `200 MergeOutcome`；`POST …/merge/continue` → `200 RepoStatus`（无合并态 400）；`GET …/conflicts` → `200 ConflictList`；`GET …/conflicts/contents?path=` → `200 ConflictContents`（zod 拒绝 400）；`POST …/conflicts/resolve` → `200 ConflictList`；未注册 repoId → 404。

**实现模板**：与前序计划 Task 4 完全同构（三件套）；contents 端点 query 校验用 `conflictContentsQuerySchema`（Object.fromEntries(searchParams) 手法同既有 diff 路由）；continue/无体 POST 不解析 body。

- [ ] **Step 1: 写失败测试** —— 两端各：openRepo → 造冲突配方（测试内用 runGit 不可行——apps 层测试无 core 依赖？检查既有 app.test.ts 是否已用 node:child_process 造仓库操作；若没有则用 execFileSync('git',…) 在测试内直接造冲突）→ `POST merge {branch:'side'}` 200 且 `status:'conflicts'`；`GET conflicts` 含 a.txt；`GET conflicts/contents?path=a.txt` 三字段齐；`POST conflicts/resolve {strategy:'theirs',path:'a.txt'}` 200 列表变空；`POST merge/continue` 200 且操作态清零（`GET operation` → none）；zod 反例各一。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): merge/conflicts 端点两端对称落地"`

---

### Task 6: client —— merge/conflicts hooks

**Files:**
- Create: `packages/client/client/src/merge.ts`、`packages/client/client/src/conflicts.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/merge.test.ts`、`packages/client/client/src/conflicts.test.ts`

**Interfaces:**
- Produces:

```ts
// merge.ts
/** 发起合并（mutation）：POST /api/repos/:repoId/merge → MergeOutcome */
export function useMerge(repoId: string): { trigger: (body: MergeBody) => Promise<MergeOutcome>; isMutating: boolean };
/** 继续合并（mutation）：POST …/merge/continue，响应 RepoStatus 回写 status 缓存 */
export function useContinueMerge(repoId: string): { trigger: () => Promise<RepoStatus>; isMutating: boolean };

// conflicts.ts
/** 冲突列表：GET /api/repos/:repoId/conflicts */
export function useConflicts(repoId: string): SWRResponse<ConflictList>;
/** 冲突三版本内容：GET …/conflicts/contents?path=；path 为空串时 key 传 null 不发请求 */
export function useConflictContents(repoId: string, path: string): SWRResponse<ConflictContents>;
/** 解决冲突（mutation）：POST …/conflicts/resolve，响应（刷新列表）回写 useConflicts 缓存 */
export function useResolveConflict(repoId: string): { trigger: (body: ResolveConflictBody) => Promise<ConflictList>; isMutating: boolean };
```

- [ ] **Step 1: 写失败测试**（mock fetch 手法沿用既有）：各 hook 的 URL/method/body 断言 + 缓存回写断言 + useConflictContents 空 path 不发请求。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): merge/conflicts hooks"`

---

### Task 7: ui —— MergeDialog + ConflictsPanel

**Files:**
- Create: `packages/client/ui/src/composite/merge-dialog.tsx`、`packages/client/ui/src/composite/conflicts-panel.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应两个 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** 合并对话框（对照 Java GitMergeDialog + GitOptionsPanel）：分支 Select（本地分支，排除当前分支）+
 *  选项 Checkbox 组（no-ff「禁用快进」/squash「压缩为单提交」/no-commit「不自动提交」）+ 合并信息 Input（可选）。
 *  纯受控：open 由父级持有。 */
export interface MergeDialogProps {
  open: boolean;
  branches: BranchList;
  onOk: (body: MergeBody) => void;
  onCancel: () => void;
  confirming?: boolean;
}
export function MergeDialog(props: MergeDialogProps): React.ReactNode;
```

```tsx
/** 冲突面板（对照 Java GitConflictsPanel）：冲突文件列表（路径 + 冲突类型徽标：stages 组合 → 双方修改[1,2,3]/双方新增[2,3]/删除修改[1,2]或[1,3]等），
 *  行操作：「用我们的」「用他们的」「手动合并」（开 MergeView）；底部「完成合并」按钮（全部解决后可用）。
 *  纯 props 驱动。 */
export interface ConflictsPanelProps {
  conflicts: ConflictList;
  onResolve: (body: ResolveConflictBody) => void;
  onOpenMergeView: (path: string) => void;
  onContinue: () => void;
  resolving?: boolean;
  continuing?: boolean;
}
export function ConflictsPanel(props: ConflictsPanelProps): React.ReactNode;
```

- 冲突类型纯函数 `conflictKindLabel(stages: number[]): string` 导出（测试复用）：`[1,2,3]`→'双方修改'、`[2,3]`→'双方新增'、`[1,2]`→'对方删除/我方修改'、`[1,3]`→'我方删除/对方修改'、其他→'冲突'。
- 「完成合并」可用条件：`conflicts.conflicts.length === 0`（未全解决时禁用 + Tooltip"还有未解决的冲突"）。

- [ ] **Step 1: 写失败测试**：conflictKindLabel 全组合；MergeDialog 选分支 + 勾选选项 → onOk 传出对应 MergeBody（不选分支确定禁用）；ConflictsPanel 渲染列表与徽标、行按钮回调、全解决时「完成合并」可用、未解决禁用。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): MergeDialog 与 ConflictsPanel"`

---

### Task 8: ui —— MergeView 3-way 合并视图

**Files:**
- Create: `packages/client/ui/src/composite/merge-view.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: `packages/client/ui/src/composite/merge-view.test.tsx`

**Interfaces:**
- Consumes: 既有 `MonacoDiffView`/`MonacoLazy`（`ui/src/base/`）；契约 `ConflictContents`。
- Produces:

```tsx
/** 3-way 合并视图（对照平台 3-way merge + spec §4.5.2：左右 diff + 底部合并结果面板）：
 *  上排两个只读 MonacoDiffView：左 base→ours（标题"当前分支"）、右 base→theirs（标题"合并来源"）；
 *  底部可编辑 Monaco（标题"合并结果"，初始内容为 ours ?? base ?? theirs ?? ''）+ 保存按钮。
 *  base 为 null（双方新增）时上排退化为 ours/theirs 并排只读（两个 MonacoLazy 普通编辑器）。
 *  全屏 Modal 形态由调用方包裹，本组件只渲染内容区。 */
export interface MergeViewProps {
  contents: ConflictContents;
  onSave: (path: string, content: string) => void;
  saving?: boolean;
}
export function MergeView(props: MergeViewProps): React.ReactNode;
```

- Monaco 只读：`options={{ readOnly: true }}`；可编辑器用 `MonacoLazy`（若其不暴露 onChange 则扩展 MonacoLazy 增加可选 onChange——检查现有实现，最小改动）。
- 测试：Monaco 重，沿用仓内"Monaco 轻 mock（懒加载与 props 断言）"手法（参照既有 ui 测试）：渲染三标题、保存按钮 onSave 传出编辑内容（mock 的编辑器 onChange 直接驱动）、base null 时退化渲染两栏。

- [ ] **Step 1: 写失败测试**（见上要点）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): MergeView 3-way 合并视图"`

---

### Task 9: 页面装配 —— 两端 merge/conflicts 路由 + LogPage 入口

**Files:**
- Create: `apps/web-next/app/repos/[repoId]/merge/page.tsx`、`apps/web-next/app/repos/[repoId]/conflicts/page.tsx`
- Create: `apps/web-koa/src/pages/merge.tsx`、`apps/web-koa/src/pages/conflicts.tsx`
- Modify: `apps/web-koa/src/main.tsx`（2 Route）
- Modify: `packages/client/ui/src/composite/log-page.tsx`（顶栏加"合并"入口 `onOpenMerge?: () => void`；OperationStatus 为 merge 时追加"去解决冲突"链接 `onOpenConflicts?: () => void`——经 props 透传给 OperationStatus？OperationStatus 是 base 组件不加导航职责：LogPage 顶栏在 OperationStatus 旁自行渲染链接按钮，仅当 operation.kind==='merge' 时显示）
- Modify: `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（注入导航）
- Test: `log-page.test.tsx`（追加入口与条件链接用例）

**Interfaces:**
- Consumes: Task 6 hooks + Task 7/8 组件；P2-C 的 `useBranches`（MergeDialog 数据源）；P2-A 的 `useOperation`（conflicts 页操作态展示）。
- Produces：路由 `/repos/:repoId/merge`、`/repos/:repoId/conflicts`（两端）。

**实现要点：**
- merge 页容器：`useBranches` + `useMerge` → MergeDialog（open 常驻 true，页面化对话框；取消=返回日志页）；合并结果：`up-to-date` → message.info"已是最新"；`success` → message.success + 返回日志页；`conflicts` → message.warning + 跳 `/repos/:repoId/conflicts`。
- conflicts 页容器：`useConflicts` + `useResolveConflict` + `useContinueMerge` + `useOperation`；「手动合并」开全屏 Modal：选中 path → `useConflictContents(repoId, selPath)` → MergeView `onSave` → `useResolveConflict.trigger({strategy:'manual', path, content})` → 关 Modal；「完成合并」→ `useContinueMerge` 成功返回日志页；中止合并入口（复用 operation/abort——若已接 OperationStatus 则提示用户用日志页中止，本页不做）。
- 失败统一 `message.error(err.message)`。

- [ ] **Step 1: 写失败测试** —— log-page：传 `onOpenMerge` 渲染合并入口；`operation.kind==='merge'` 且传 `onOpenConflicts` 时渲染"去解决冲突"。容器以 typecheck + 冒烟兜底。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现全部修改**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— 冒烟：两端真实仓库造冲突 → 合并发起 → 冲突页三策略解决 → 完成合并 / 日志页中止合并（`git log`/`git status` 复核）；`git commit -m "feat(apps): merge/conflicts 页面两端落地与 LogPage 入口"`

---

## 自审记录

- Spec 覆盖：§4.2 merge 行（合并 ✓、冲突状态 ✓、方向/策略 ✓ 选项对齐 Java 暴露面）、conflict 行（冲突列表 ✓、标记已解决 ✓=markResolved、3-way 状态查询 ✓=contents 端点）；§4.5.2 MergeDialog/ConflictsPanel/MergeView 对照落实。
- 类型一致性：MergeBody/MergeOutcome/ConflictEntry/ConflictList/ConflictContents/ResolveConflictBody/三组件 Props 跨任务签名已对齐；conflicts/resolve 返回刷新列表与 staging 模式一致。
- 风险：`Already up to date` 文本匹配依赖 LC_ALL=C（exec.ts 已固定）✓；squash 合并后 `merge --continue` 不适用（无 MERGE_HEAD）——core continueMerge 内部对无 MERGE_HEAD 但有 MERGE_MSG 的场景退化 `git commit`，该分支由 api 测试覆盖（squash 冲突解决后 continue）。
