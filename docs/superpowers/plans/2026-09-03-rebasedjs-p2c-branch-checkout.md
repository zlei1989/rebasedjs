# P2-C：分支 + 检出 + BranchPanel 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P2 阶段的 branch（分支列表/创建/删除/重命名/设上游/合并状态）与 checkout（检出分支/新建分支检出/detached 检出标签或提交）两个功能域，交付 BranchPanel 页面（本地/远程分组 + 合并状态 + 操作集）。

**Architecture:** 沿用既有分层与两端对称路由。写操作遵循 spec §4.3 命名模式（POST + `{action}` 判别联合）；分支列表用 `git for-each-ref` 一次取全字段（含 upstream track 与合并状态）。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（branch/checkout 行）、§4.5.2（BranchesTreeModel → BranchPanel 对照：本地/远程分组、过滤、合并状态图标）；前序计划 P2-A/P2-B（`docs/superpowers/plans/`）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/`；写 UI 前用 context7 查 antd 用法或沿用仓内既有用法。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：`createTmpRepo` 无首个提交、预置 user.name/email、默认分支名随 git 版本不同（用 `git symbolic-ref HEAD --short` 取值）。
- 错误语义：服务层只抛 `ServiceError`（中文 message）；无效分支/引用 → `INVALID_REF`；检出被未提交修改阻挡等 git 失败 → `GIT_ERROR` 带 stderr。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/branches   → BranchList（本地+远程，含 current/upstream/ahead/behind/mergedIntoHead）
POST /api/repos/:repoId/branches   {action:'create',name,startPoint?} | {action:'delete',name,force?} | {action:'rename',oldName,newName} | {action:'setUpstream',name,upstream} → BranchList（刷新后）
POST /api/repos/:repoId/checkout   {action:'branch',name} | {action:'newBranch',name,startPoint?} | {action:'detach',ref} → RepoStatus（刷新后）
```

## 明确不做（留给后续计划）

- 最近检出分组（需 reflog 数据，BranchPanel 增强）；保护分支（依赖 settings 扩展）；force-push 后修复、checkout with rebase（依赖 P3 remote/rebase）；清理已合并/过时分支批量动作（列表已含 mergedIntoHead，批量清理 UI 后置）。
- 标签分组（P3 tag.ts 落地后并入 BranchPanel）。

---

### Task 1: contracts —— branch/checkout 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加 describe）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
/** 分支条目：remote=true 为远程跟踪分支；current 仅本地分支可能为 true；mergedIntoHead 表示已合并入当前 HEAD */
export interface BranchRef {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hash: string;
  mergedIntoHead: boolean;
  lastCommitIso: string;
}

/** 分支列表视图 */
export interface BranchList {
  branches: BranchRef[];
}
```

```ts
// endpoints.ts 追加
/** 分支写操作（判别联合）：create 可带 startPoint；delete 的 force 对应 git branch -D；rename 改名；setUpstream 设置上游 */
export const branchActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().min(1), startPoint: z.string().optional() }),
  z.object({ action: z.literal('delete'), name: z.string().min(1), force: z.boolean().optional() }),
  z.object({ action: z.literal('rename'), oldName: z.string().min(1), newName: z.string().min(1) }),
  z.object({ action: z.literal('setUpstream'), name: z.string().min(1), upstream: z.string().min(1) }),
]);
export type BranchAction = z.infer<typeof branchActionSchema>;

/** 检出操作：branch=既有分支；newBranch=新建并检出（可带 startPoint）；detach=detached 检出标签/提交 */
export const checkoutActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('branch'), name: z.string().min(1) }),
  z.object({ action: z.literal('newBranch'), name: z.string().min(1), startPoint: z.string().optional() }),
  z.object({ action: z.literal('detach'), ref: z.string().min(1) }),
]);
export type CheckoutAction = z.infer<typeof checkoutActionSchema>;
```

- [ ] **Step 1: 写失败测试** —— 各 action 正例 + 反例（缺字段、枚举外 action、空 name）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**（按上方代码追加）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 分支与检出端点契约"`

---

### Task 2: core —— branch/checkout 原语

**Files:**
- Create: `packages/server/core/src/branch.ts`、`packages/server/core/src/checkout.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/branch.test.ts`、`packages/server/core/src/checkout.test.ts`

**Interfaces:**
- Consumes: `runGit`、`GitExitError`；夹具 `createTmpRepo/cleanupTmpRepo`。
- Produces:

```ts
// branch.ts
export interface CoreBranch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  hash: string;
  lastCommitIso: string;
}
/** 分支列表：for-each-ref 一次取 refs/heads + refs/remotes 全字段（NUL 分隔安全）；不含 mergedIntoHead（api 层组合 --merged 结果） */
export function listBranches(cwd: string): Promise<CoreBranch[]>;
/** 已合并入 ref 的本地分支名集合（git branch --merged）；ref 省略为 HEAD */
export function mergedBranchNames(cwd: string, ref?: string): Promise<string[]>;
export function createBranch(cwd: string, name: string, startPoint?: string): Promise<void>;
export function deleteBranch(cwd: string, name: string, force?: boolean): Promise<void>;
export function renameBranch(cwd: string, oldName: string, newName: string): Promise<void>;
export function setBranchUpstream(cwd: string, name: string, upstream: string): Promise<void>;
```

```ts
// checkout.ts
export function checkoutBranch(cwd: string, name: string): Promise<void>;
export function checkoutNewBranch(cwd: string, name: string, startPoint?: string): Promise<void>;
/** detached 检出（标签/提交哈希）：git checkout <ref> 即 detached；stderr 的 detached 提示不算错误 */
export function checkoutDetached(cwd: string, ref: string): Promise<void>;
```

**实现要点：**
- `listBranches`：`git for-each-ref --format=%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(objectname)%00%(committerdate:iso-strict)%00%(HEAD) refs/heads refs/remotes`；行内 NUL 分隔字段、行间 `\n`；`upstream:track` 形如 `[ahead 2, behind 1]` 解析为 ahead/behind（无则 0/0）；`%(HEAD)` 为 `*` 时 current=true；`refs/remotes` 下 remote=true 且跳过 `origin/HEAD` 类符号引用（upstream 字段为空且名含 `->`？符号引用在 for-each-ref 里 short 名就是 `origin/HEAD`，用 `%(symref)` 非空过滤更稳——加第 7 字段 `%(symref)`，非空则跳过）。
- `mergedBranchNames`：`git branch --merged [ref] --format=%(refname:short)`。
- 删除当前分支会被 git 拒绝（GIT_ERROR 透出，符合预期）；`renameBranch` 用 `git branch -m old new`；`setBranchUpstream` 用 `git branch --set-upstream-to <upstream> <name>`。

- [ ] **Step 1: 写失败测试**（tmp repo，先造 base 提交——见 Global Constraints 夹具事实）：
  - branch：base 提交后 `listBranches` 含当前分支（current=true、ahead/behind=0）；`createBranch('feat')` 后列表含 feat；`renameBranch('feat','feature')` 后改名生效；`deleteBranch('feature')` 后消失；删除不存在的分支 rejects `GitExitError`；`mergedBranchNames` 在 base 上含当前分支。
  - checkout：`checkoutNewBranch('n1')` 后 `symbolic-ref --short HEAD` 为 n1；`checkoutBranch(main)` 切回；`checkoutDetached(<hash>)` 后 `symbolic-ref -q HEAD` 失败（detached）而 `rev-parse HEAD` 等于该 hash。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): 分支与检出原语"`

---

### Task 3: api —— branch.ts / checkout.ts

**Files:**
- Create: `packages/server/api/src/branch.ts`、`packages/server/api/src/checkout.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/branch.test.ts`、`packages/server/api/src/checkout.test.ts`

**Interfaces:**
- Consumes: Task 2 core 出口；`ServiceError`；既有 `getRepoStatus`（checkout 后返回刷新状态）。
- Produces:

```ts
// branch.ts
/** 分支列表：core 列表 + mergedBranchNames 组合 mergedIntoHead 标志 */
export function getBranches(repoPath: string): Promise<BranchList>;
/** 分支写操作分派：create/delete/rename/setUpstream → core；delete/rename/setUpstream 前校验目标分支存在（不存在 → ServiceError('INVALID_REF', '分支不存在：…')）；返回刷新列表 */
export function applyBranchAction(repoPath: string, action: BranchAction): Promise<BranchList>;
```

```ts
// checkout.ts
/** 检出分派：branch → checkoutBranch（分支不存在 → INVALID_REF）；newBranch → checkoutNewBranch（名已存在 → ServiceError('INVALID_QUERY', '分支已存在：…')）；detach → checkoutDetached（ref 无效由 git 报 GIT_ERROR）；返回刷新后的 RepoStatus */
export function applyCheckout(repoPath: string, action: CheckoutAction): Promise<RepoStatus>;
```

- index.ts 追加：`export { applyBranchAction, getBranches } from './branch';`、`export { applyCheckout } from './checkout';`

- [ ] **Step 1: 写失败测试** —— `getBranches` 返回含 `mergedIntoHead` 字段（base 上当前分支为 true，未合并新分支为 false）；`applyBranchAction create→delete force→rename→setUpstream` 轮转断言刷新列表内容；不存在分支 delete → `INVALID_REF`；`applyCheckout {action:'branch',name:'nope'}` → `INVALID_REF`；`newBranch` 重名 → `INVALID_QUERY`；`branch` 检出后返回 RepoStatus.branch 为新名。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 分支与检出服务"`

---

### Task 4: 两端路由 —— branches/checkout 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/branches/route.ts`（GET+POST）、`apps/web-next/app/api/repos/[repoId]/checkout/route.ts`（POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（3 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 3 api 出口。
- Produces（HTTP 形状）：`GET …/branches` → `200 BranchList`；`POST …/branches`（branchActionSchema）→ `200 BranchList`；`POST …/checkout`（checkoutActionSchema）→ `200 RepoStatus`；zod 拒绝 → 400；`INVALID_REF` → 400；未注册 repoId → 404。

**实现模板**（与 P2-A Task 4 / P2-B Task 4 完全同构，以 web-next branches 为例）：

```ts
/** GET /api/repos/:repoId/branches —— 分支列表；POST —— zod 校验 action → applyBranchAction → 返回刷新列表 */
import { applyBranchAction, getBranches } from '@rebased/api';
import { branchActionSchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getBranches(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const action = branchActionSchema.parse(await req.json());
    return Response.json(await applyBranchAction(resolveRepo(z.string().min(1).parse(repoId)), action));
  } catch (error) {
    return handleApiError(error);
  }
}
```

web-koa 在 `repos.ts` 追加同语义 3 注册（`router.get('/api/repos/:repoId/branches', …)`、`router.post('/api/repos/:repoId/branches', …)`、`router.post('/api/repos/:repoId/checkout', …)`），import 行同步追加。

- [ ] **Step 1: 写失败测试** —— 两端各：openRepo → `GET branches` 200 含当前分支；`POST branches {action:'create',name:'b1'}` 200 列表含 b1；`POST checkout {action:'branch',name:'b1'}` 200 且 `branch==='b1'`；`POST checkout {action:'branch',name:'nope'}` → 400 `INVALID_REF`；zod 反例（`{action:'create'}` 缺 name）→ 400。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): branches/checkout 端点两端对称落地"`

---

### Task 5: client —— branches/checkout hooks

**Files:**
- Create: `packages/client/client/src/branches.ts`、`packages/client/client/src/checkout.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/branches.test.ts`、`packages/client/client/src/checkout.test.ts`

**Interfaces:**
- Produces:

```ts
// branches.ts
/** 分支列表：GET /api/repos/:repoId/branches */
export function useBranches(repoId: string): SWRResponse<BranchList>;
/** 分支写操作（mutation）：POST 同路径，响应（刷新列表）回写 useBranches 缓存（显式 mutate key，参照 staging hooks 手法） */
export function useBranchAction(repoId: string): { trigger: (action: BranchAction) => Promise<BranchList>; isMutating: boolean };

// checkout.ts
/** 检出（mutation）：POST /api/repos/:repoId/checkout，响应 RepoStatus 回写 status 缓存键 */
export function useCheckout(repoId: string): { trigger: (action: CheckoutAction) => Promise<RepoStatus>; isMutating: boolean };
```

- [ ] **Step 1: 写失败测试**（mock fetch 手法沿用既有）：useBranches key 正确；useBranchAction trigger 后缓存回写；useCheckout trigger 后 status key 缓存回写为响应值。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): branches/checkout hooks"`

---

### Task 6: ui —— BranchPanel 组合页面

**Files:**
- Create: `packages/client/ui/src/composite/branch-panel.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: `packages/client/ui/src/composite/branch-panel.test.tsx`

**Interfaces:**
- Consumes: 契约 `BranchList`、`BranchRef`、`BranchAction`、`CheckoutAction`。
- Produces:

```tsx
/** 分支面板：本地/远程两组列表（对照 Java BranchesTreeModel 分组维度），
 *  行内信息：current 标记、upstream+ahead/behind 徽标、mergedIntoHead 图标（绿色对勾 Tooltip"已合并"）。
 *  操作：新建分支（Modal：名称 + 起始点可选）、检出、删除（Popconfirm；未合并提示需 force）、重命名（Modal 单输入）、设上游（Modal 单输入）。
 *  纯 props 驱动。 */
export interface BranchPanelProps {
  branches: BranchList;
  onAction: (action: BranchAction) => void;
  onCheckout: (action: CheckoutAction) => void;
  acting?: boolean;
}
export function BranchPanel(props: BranchPanelProps): React.ReactNode;
```

**实现要点：**
- 两个 `Card`（"本地分支"、"远程分支"）各一个 `List`；行：`Space` 组合名称（current 加 `Tag`"当前"）+ 上游文本（`↑ahead ↓behind`，0 不显示）+ 合并图标。行尾 `Dropdown` 菜单（检出/重命名/设上游/删除；远程分支行只保留"检出为本地分支"= checkout newBranch startPoint=远程名，v1 可只做本地行完整菜单、远程行禁用态 Tooltip"后续支持"——不，按 YAGNI：远程行只读展示）。
- 顶部工具条：`Button`"新建分支" 开 Modal（`Input` 名称 + `Input` 起始点可空 + 检出开关 `Checkbox`"创建后检出"，勾时走 onCheckout newBranch，否则 onAction create）。
- 删除：未合并（mergedIntoHead=false）时 Popconfirm 文案提示"该分支未合并，删除将使用强制删除"；确认后传 `force:true`。当前分支的删除菜单项禁用。
- 全部操作失败反馈由容器负责（message.error）；面板只管触发回调。

- [ ] **Step 1: 写失败测试**：分组渲染（本地/远程计数）；current 标记；merged 图标存在性；新建分支 Modal 提交调 onAction `{action:'create',name:'b1'}`（不勾检出）/ onCheckout `{action:'newBranch',name:'b1'}`（勾检出）；删除未合并分支确认后调 `{action:'delete',name:'x',force:true}`；重命名 Modal 调 `{action:'rename',oldName,newName}`。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): BranchPanel 分支面板"`

---

### Task 7: 页面装配 —— 两端 branches 路由 + LogPage 入口

**Files:**
- Create: `apps/web-next/app/repos/[repoId]/branches/page.tsx`
- Create: `apps/web-koa/src/pages/branches.tsx`
- Modify: `apps/web-koa/src/main.tsx`（Route `/repos/:repoId/branches`）
- Modify: `packages/client/ui/src/composite/log-page.tsx`（顶栏加"分支"入口，可选 prop `onOpenBranches?: () => void`）
- Modify: `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（注入 onOpenBranches 导航）
- Test: `packages/client/ui/src/composite/log-page.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 5 hooks + Task 6 BranchPanel；既有 status/events 链路（checkout 后 headHash 变化 → events 推送自动刷新日志，无需额外接线）。
- Produces：路由 `/repos/:repoId/branches`（两端）；LogPage 顶栏"分支"按钮（`BranchesOutlined` 或 antd 可用图标）。

**实现要点：**
- branches 页面容器（两端同构）：`useBranches` + `useBranchAction` + `useCheckout` → BranchPanel；失败 `message.error`；顶部返回日志页按钮。
- LogPage 顶栏按钮排布：变更 / 分支 / 设置（既有）。

- [ ] **Step 1: 写失败测试** —— log-page 入口按钮用例。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现全部修改**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— 冒烟：两端真实仓库 → 分支页新建/检出/删除全链路（命令行 `git branch` 复核）；`git commit -m "feat(apps): BranchPanel 两端落地与 LogPage 分支入口"`

---

## 自审记录

- Spec 覆盖：§4.2 branch 行（创建/删除/重命名/上游/合并状态 ✓；保护分支/最近检出/清理/force-push 修复/checkout with rebase 明确后置）；checkout 行（分支/新建分支检出/detached ✓；文件级检出已由 P2-B discardPaths 覆盖）。
- 类型一致性：BranchRef/BranchList/BranchAction/CheckoutAction/BranchPanelProps 跨任务签名已对齐；`mergedIntoHead` 在 api 层组合（core 列表不含），两端路由透传。
- 风险：`for-each-ref` 的 `upstream:track` 本地化输出（LC_ALL=C 已固定英文）✓；Windows 长分支名 NUL 分隔已处理。


---

## 关账记录（2026-09-03）

7/7 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: With fixes**——1 Important（branches 容器 events 订阅注释过度声称：watcher 为 status-diff 驱动，纯建删非当前分支不产事件）经修复波（`fa62f04` 订阅修复 + `9f67aa7` 注释修正）与两轮限定复审全部 ADDRESSED，正式关账。

**Rulings（控制器裁决记录）**：
1. `%(refname)` 替代 `%(refname:short)`（remote 判定更稳）与 `--format` 置于 `--merged` 前（防吞参）——两偏差经 git CLI 语义裁决成立。
2. `useBranchAction` 同键 mutation 需 `revalidate:false`（swr 2.5.1 源码核验）——纳入 client hooks 约定。
3. 「范围外提交」指控的回应：多计划并行同分支是有意的流水线策略，逐任务审查范围按父提交精确计算，完整性不受损。
4. next/dist/docs 存在性误会：目录实际存在（422 文件），AGENT.md 指引有效。

**登记缺口**：watcher 不感知纯 ref 建删 → P3 remote/refs 计划扩展 watcher 指纹。hardening 新增 ⑥-⑩（见终审 Recommendations/Minors）。

终审 triage：18 项 deferred minor 全部 safe-to-defer。SDD 工作区已按规程删除，本提交为记录。