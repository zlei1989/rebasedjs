# P2-G：变更列表（changelist）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P2 阶段 changelist 功能域——变更列表的创建/删除/重命名/设默认/移动变更，作为 StatusPage 的分组维度（对照平台 ChangeListManager 的信息架构；git 无原生 changelist 概念，本实现为应用层簿记）。

**Architecture:** 簿记存于应用配置（config-store 按 repoId 扩展 `changelists` 字段）；api 层把簿记与实时 status 合并成视图（失效路径自动修剪）；无 core 层需求（纯应用层 + git status 读取）。UI 为 StatusPage 的分组改造。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（changelist 行：创建/切换/移动变更/默认列表）；前序计划 P2-A…P2-F。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 错误语义：服务层只抛 `ServiceError`（中文 message）；列表不存在 → `INVALID_QUERY`。
- 簿记一致性：assignments 只引用 status 中现存路径（读取视图时修剪失效路径并回写）；删除列表时其文件归入默认列表；默认列表不可删除。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/changelists    → ChangelistView（lists + assignments，已按实时 status 修剪）
POST /api/repos/:repoId/changelists    {action:'create',name} | {action:'rename',id,name} | {action:'delete',id} | {action:'setDefault',id} | {action:'move',paths[],targetId} → ChangelistView（刷新后）
```

## 明确不做

- 按 changelist 提交（Java 的 active-changelist 提交范围）：我们的提交粒度是暂存区，changelist 与暂存区正交（文件可先分组再按需暂存）——spec 行的"切换"语义以"设默认列表"承担；提交范围联动属 commit 增强。
- Shelf 与 changelist 的互转（属 P3 shelf 计划）。

---

### Task 1: contracts —— changelist 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加 describe）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
/** 变更列表（应用层簿记，git 无原生概念）：id 为生成的主键；isDefault 接收未分配路径 */
export interface Changelist {
  id: string;
  name: string;
  isDefault: boolean;
}
/** 变更列表视图：assignments 为 路径 → listId（仅含 status 现存路径，读取时已修剪失效条目） */
export interface ChangelistView {
  lists: Changelist[];
  assignments: Record<string, string>;
}
```

```ts
// endpoints.ts 追加
/** 变更列表操作（判别联合）：move 把 paths 移入 targetId；delete 的文件归入默认列表；默认列表不可删除（api 层拒绝） */
export const changelistActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().min(1) }),
  z.object({ action: z.literal('rename'), id: z.string().min(1), name: z.string().min(1) }),
  z.object({ action: z.literal('delete'), id: z.string().min(1) }),
  z.object({ action: z.literal('setDefault'), id: z.string().min(1) }),
  z.object({ action: z.literal('move'), paths: z.array(z.string().min(1)).min(1), targetId: z.string().min(1) }),
]);
export type ChangelistAction = z.infer<typeof changelistActionSchema>;
```

- [ ] **Step 1: 写失败测试** —— 五 action 正例 + 反例（move 缺 paths/targetId、空 name、枚举外 action）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 变更列表端点契约"`

---

### Task 2: api —— changelist.ts + config-store 扩展

**Files:**
- Modify: `packages/server/api/src/lib/config-store.ts`（AppConfig 扩展 + 读写助手）
- Create: `packages/server/api/src/changelist.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/changelist.test.ts`

**Interfaces:**
- Consumes: 既有 `getRepoStatus`（`./status`）；config-store 的 loadConfig/saveConfig。
- Produces:

```ts
// config-store.ts 扩展（AppConfig 增加可选字段，向后兼容既有配置文件）：
//   changelists?: Record<string /* repoId */, { lists: Changelist[]; assignments: Record<string, string> }>

// changelist.ts
/** 变更列表视图：簿记 + 实时 status 合并——assignments 修剪掉 status 中已不存在的路径（修剪后回写配置）；仓库无簿记时初始化默认列表「默认」（id 固定 'default'） */
export function getChangelists(repoPath: string): Promise<ChangelistView>;
/** 变更列表操作分派：create（名重复 → INVALID_QUERY '列表已存在：…'）；rename；delete（默认列表 → INVALID_QUERY '默认列表不可删除'；其文件归默认列表）；setDefault；move（targetId 不存在 → INVALID_QUERY '列表不存在：…'）；每次操作后返回刷新视图 */
export function applyChangelistAction(repoPath: string, action: ChangelistAction): Promise<ChangelistView>;
```

- repoPath → repoId 的映射：changelist 簿记按 repoId 键控，api 层入参是 repoPath——**经 config.repos 反查 repoId**（config-store 的 repos 注册表）；查不到（未注册）→ 让路由层的 resolveRepo 保证注册在先，api 层查不到时抛 `ServiceError('REPO_NOT_FOUND', …)` 防御。
- index.ts 追加：`export { applyChangelistAction, getChangelists } from './changelist';`

- [ ] **Step 1: 写失败测试**（tmp repo + `REBASED_CONFIG_DIR` 隔离——沿用既有 api 测试的环境隔离手法；仓库需先经 openRepo 注册）：
  - 初始视图：lists 恰含默认列表（isDefault=true），assignments 空。
  - create '功能A' → 两列表；move 现存路径（测试内造工作区改动）→ assignments 反映；rename → 名变；setDefault → 默认标记迁移；delete 非默认列表 → 其路径归默认。
  - 修剪：move 某路径后撤销该文件改动（restore）→ 再 getChangelists → assignments 不再含该路径。
  - 名重复 create → INVALID_QUERY；删除默认列表 → INVALID_QUERY；move 到不存在列表 → INVALID_QUERY。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**（config-store 扩展保持向后兼容：旧配置文件无 changelists 字段时按 undefined 处理；写回用既有原子保存）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 变更列表服务（应用层簿记 + status 合并修剪）"`

---

### Task 3: 两端路由 —— changelists 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/changelists/route.ts`（GET+POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（2 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schema + Task 2 api 出口。
- Produces（HTTP 形状）：`GET …/changelists` → `200 ChangelistView`；`POST …/changelists`（changelistActionSchema）→ `200 ChangelistView`；zod 拒绝/INVALID_QUERY → 400；未注册 repoId → 404。

**实现模板**：与前序计划 Task 4 完全同构（branches/stashes 的 GET+POST 判别联合先例）。

- [ ] **Step 1: 写失败测试** —— 两端各：openRepo → GET 200 含默认列表；POST create → 200 两列表；POST move 到不存在列表 → 400；zod 反例（`{action:'create'}` 缺 name）→ 400；未注册 repoId → 404。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): changelists 端点两端对称落地"`

---

### Task 4: client —— changelist hooks

**Files:**
- Create: `packages/client/client/src/changelist.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/changelist.test.ts`

**Interfaces:**
- Produces:

```ts
/** 变更列表视图：GET /api/repos/:repoId/changelists */
export function useChangelists(repoId: string): SWRResponse<ChangelistView>;
/** 变更列表操作（mutation）：POST 同路径（同键教训：mutation options revalidate:false + 显式 mutate 回写） */
export function useChangelistAction(repoId: string): { trigger: (action: ChangelistAction) => Promise<ChangelistView>; isMutating: boolean };
```

- [ ] **Step 1: 写失败测试**（mock fetch + freshCache + 共挂载观测回写 + 恰好 1 次 GET 守卫）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): changelist hooks"`

---

### Task 5: ui —— StatusPage 按 changelist 分组改造

**Files:**
- Modify: `packages/client/ui/src/composite/status-page.tsx`（分组维度升级 + 列表管理入口 + 移动操作）
- Test: `packages/client/ui/src/composite/status-page.test.tsx`（追加/更新）

**Interfaces:**
- Consumes: 契约 `ChangelistView`、`ChangelistAction`。
- Produces（StatusPageProps 追加可选字段——全部可选，缺省时维持现状三分组行为，向后兼容）：

```ts
/** StatusPageProps 追加：
 *  changelists?: ChangelistView —— 提供时，每组（已暂存/工作区/未跟踪）内按 changelist 再分组（默认列表的条目平铺不分子标题；非默认列表以列表名子标题分组）
 *  onChangelistAction?: (action: ChangelistAction) => void —— 列表管理（新建/重命名/删除/设默认，头部「管理列表」Dropdown）与条目「移动到列表」行操作（Dropdown 列出非当前列表）
 */
```

**实现要点：**
- 分组纯函数扩展：`groupChanges` 保持原签名不动；新增 `groupByChangelist(entries: ChangeEntry[], view: ChangelistView): Map<listId 或 'default', ChangeEntry[]>` 导出（测试复用）。
- 「移动到列表」行操作：Dropdown 菜单项 = 目标列表名；多选时按选中集合批量 move（沿用组级操作按钮区的既有选中机制——行级 Dropdown 对当前选中集合操作，未选中时仅该行）。
- 管理列表 Dropdown：新建（Modal 输入名）/ 各列表行（重命名 Modal、设默认、删除——默认列表项删除禁用）。
- 既有全部测试不得破坏（changelists 缺省 = 现状）。

- [ ] **Step 1: 写失败测试**：`groupByChangelist` 分组与修剪后孤儿归默认；changelists 提供时子标题渲染；「移动到列表」回调载荷 `{action:'move', paths, targetId}`；管理菜单新建 → `{action:'create', name}`；删除默认列表项禁用。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): StatusPage 按变更列表分组与管理入口"`

---

### Task 6: 页面装配 —— 两端 status 页注入 changelist

**Files:**
- Modify: `apps/web-next/app/repos/[repoId]/status/page.tsx`、`apps/web-koa/src/pages/status.tsx`
- Test: 容器以 typecheck + 冒烟兜底

**Interfaces:**
- Consumes: Task 4 hooks + Task 5 StatusPage 新 props。
- 容器：追加 `useChangelists(repoId)` + `useChangelistAction(repoId)` → 传入 StatusPage；changelist 操作失败 `message.error`；**events 订阅的 onStatus 回调里追加 `void mutateChangelists()`**（status 变化可能使 assignments 修剪——同一 watcher 事件驱动视图刷新；注释如实描述 watcher 语义）。

- [ ] **Step 1–4**: 装配 + `pnpm typecheck && pnpm format && pnpm test` 全量绿。
- [ ] **Step 5: 冒烟 + 提交** —— 冒烟（web-next 用 `next dev --webpack`）：真实仓库 StatusPage 新建列表 → 移动变更 → 暂存提交（分组与暂存正交互不影响）→ CLI `git status` 复核；`git commit -m "feat(apps): StatusPage 变更列表两端接线"`

---

## 自审记录

- Spec 覆盖：§4.2 changelist 行（创建 ✓、切换=设默认 ✓、移动变更 ✓、默认列表 ✓；按 changelist 提交明确后置）。
- 类型一致性：Changelist/ChangelistView/ChangelistAction/groupByChangelist/StatusPageProps 追加 跨任务签名已对齐。
- 风险：簿记与真实仓库状态漂移（外部 CLI 改动）——读取时修剪已兜底；watcher 缺口（assignments 变化不产事件）由 status 变化的 onStatus 重验证 + SWR focus 兜底，注释如实声明。
- 分层说明：本计划 api 直接扩展 config-store（应用簿记属服务层职责，core 只管 git CLI），无 core 任务——与 P2-A settings 同先例。


---

## 关账记录（2026-09-03）

6/6 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: With fixes**——1 Important（getChangelists 读路径写回竞态：await 期间并发配置写入被整体覆盖）+ 1 Minor（簿记字段手改损坏无容错）修复波（commit `e883892`）经限定复审全部 ADDRESSED、零新破坏（复审者专项核实：修剪为纯删除不复活失效条目、并发 ACTION 不丢失、needsInit 与自愈对齐、竞态测试对旧实现确失败），正式关账。

**Rulings / 设计要点**：
1. git 无原生 changelist → 应用层簿记（config-store 按 repoId）+ 读取时修剪合并——config-store 并发写竞态的发现直接促成了「await 后重读合并」模式，后续所有读-改-写路径参照。
2. 「按 changelist 提交」后置（我们的提交粒度是暂存区，与 Java active-changelist 语义不同，计划已明示）。
3. config-store「原子写」名不副实为 pre-existing → P3 backlog（真原子写=临时文件+rename）。

终审 triage：15 项 deferred minor 全部 safe-to-defer。SDD 工作区已按规程删除，本提交为记录。