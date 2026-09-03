# P2-F：贮藏（stash）+ StashPanel 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P2 阶段 stash 功能域——贮藏列表/保存/应用/弹出/删除/转为分支，交付 StashPanel 页面并挂入 LogPage 顶栏入口。

**Architecture:** 沿用既有分层与两端对称路由；写操作遵循 spec §4.3 的 POST + `{action}` 判别联合模式（P2-C branches 已建立该先例）；贮藏列表用 `git stash list` 自定义格式 + NUL 分隔解析（与 log 解析同手法）。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（stash 行：`GitStashDialog`/`GitUnstashAsDialog`/`GitStashBranchComponent`）；前序计划 P2-A…P2-E。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/`；写 UI 前用 context7 查 antd 用法或沿用仓内既有用法。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：`createTmpRepo` 无首个提交、预置 user.name/email、默认分支名用 `git symbolic-ref HEAD --short` 获取。
- 错误语义：服务层只抛 `ServiceError`（中文 message）；无效 stash 索引 → `INVALID_REF`；无工作区改动时保存 → `INVALID_QUERY`；git 失败 → `GIT_ERROR` 带 stderr。
- dev 冒烟环境事实：web-next 用 `next dev --webpack`（Turbopack ≥3 段路由 404 为已知问题）；web-koa dev UI 走 Vite :5173。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/stashes    → StashList
POST /api/repos/:repoId/stashes    {action:'save',message?,includeUntracked?} | {action:'apply',index} | {action:'pop',index} | {action:'drop',index} | {action:'branch',index,name} → StashList（刷新后）
```

## 明确不做

- Un-stash 对话框的"应用为新分支 + 可选弹出"完整矩阵（`GitUnstashAsDialog`）：本期提供 apply/pop/drop/branch 四个原子动作，组合 UX 后置；stash diff 预览（`git stash show -p`，并入 DiffPage 增强）。

---

### Task 1: contracts —— stash 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加 describe）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
/** 贮藏条目：index 为 stash@{n} 序号（列表顺序即 git stash list 顺序）；hash 为贮藏提交哈希 */
export interface StashEntry {
  index: number;
  hash: string;
  message: string;
  dateIso: string;
}
export interface StashList {
  stashes: StashEntry[];
}
```

```ts
// endpoints.ts 追加
/** 贮藏操作（判别联合）：save 保存当前工作区（includeUntracked 对应 -u）；apply/pop/drop 按 index；branch 把贮藏转为新分支（git stash branch） */
export const stashActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), message: z.string().optional(), includeUntracked: z.boolean().optional() }),
  z.object({ action: z.literal('apply'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('pop'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('drop'), index: z.number().int().min(0) }),
  z.object({ action: z.literal('branch'), index: z.number().int().min(0), name: z.string().min(1) }),
]);
export type StashAction = z.infer<typeof stashActionSchema>;
```

- [ ] **Step 1: 写失败测试** —— 五种 action 正例 + 反例（branch 缺 name、index 为 -1、枚举外 action）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**（按上方代码追加）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 贮藏端点契约"`

---

### Task 2: core —— stash 原语

**Files:**
- Create: `packages/server/core/src/stash.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/stash.test.ts`

**Interfaces:**
- Consumes: `runGit`、`GitExitError`、夹具。
- Produces:

```ts
// stash.ts
export interface CoreStash {
  index: number;
  hash: string;
  message: string;
  dateIso: string;
}
/** 贮藏列表：git stash list --format=%H%x00%gs%x00%cI（NUL 分隔字段安全解析）；无贮藏返回 []（git 输出为空串） */
export function listStashes(cwd: string): Promise<CoreStash[]>;
/** 保存贮藏：git stash push [-u] [-m message]；无改动时 git 输出 'No local changes to save'（退出码 0）——api 层据此映射 INVALID_QUERY，core 原样透传 */
export function saveStash(cwd: string, opts: { message?: string; includeUntracked?: boolean }): Promise<void>;
export function applyStash(cwd: string, index: number): Promise<void>;
export function popStash(cwd: string, index: number): Promise<void>;
export function dropStash(cwd: string, index: number): Promise<void>;
/** 贮藏转为新分支：git stash branch <name> stash@{n}（成功即应用并删除该贮藏） */
export function stashToBranch(cwd: string, index: number, name: string): Promise<void>;
```

- index.ts 追加：`export { applyStash, dropStash, listStashes, popStash, saveStash, stashToBranch } from './stash';` + `export type { CoreStash } from './stash';`

- [ ] **Step 1: 写失败测试**（tmp repo，先造 base 提交）：
  - 空列表 → `[]`；改文件 → `saveStash({message:'暂存一'})` → 列表 1 条且 message 含"暂存一"、工作区干净（`getStatus` entries 空）。
  - `includeUntracked`：新建未跟踪文件 + 修改已跟踪 → 保存后两者都消失。
  - `applyStash(0)` 后改动回归且贮藏仍在；`dropStash(0)` 后列表空。
  - 再造改动保存 → `popStash(0)` 后改动回归且列表空。
  - `stashToBranch(0, 'stash-branch')` 后 `symbolic-ref --short HEAD` 为 stash-branch 且贮藏消失。
  - 无效索引 `applyStash(9)` rejects `GitExitError`。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**（`stash@{n}` 引用写作 `stash@{${index}}` 单参数，数组传参无注入面）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): 贮藏原语"`

---

### Task 3: api —— stash.ts

**Files:**
- Create: `packages/server/api/src/stash.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/stash.test.ts`

**Interfaces:**
- Consumes: Task 2 core 出口；`ServiceError`。
- Produces:

```ts
// stash.ts
/** 贮藏列表（core → 契约薄映射） */
export function getStashes(repoPath: string): Promise<StashList>;
/** 贮藏操作分派：save 前取 status，无工作区改动（entries 仅 ?? 且未 includeUntracked，或完全为空）→ ServiceError('INVALID_QUERY', '没有可贮藏的工作区改动')；
 *  apply/pop/drop/branch 前校验 index 在列表范围内（越界 → ServiceError('INVALID_REF', '贮藏不存在：stash@{n}')）；
 *  save 后 git 输出 'No local changes to save' 的兜底（并发改动消失场景）同样映射 INVALID_QUERY；返回刷新列表 */
export function applyStashAction(repoPath: string, action: StashAction): Promise<StashList>;
```

- index.ts 追加：`export { applyStashAction, getStashes } from './stash';`

- [ ] **Step 1: 写失败测试**：`getStashes` 空仓库 → `[]`；save → 列表 1 条；无改动 save → `INVALID_QUERY`；越界 apply → `INVALID_REF`；save→apply→drop 轮转后列表内容断言；branch 动作后 HEAD 分支名与列表断言。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 贮藏服务"`

---

### Task 4: 两端路由 —— stashes 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/stashes/route.ts`（GET+POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（2 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schema + Task 3 api 出口。
- Produces（HTTP 形状）：`GET …/stashes` → `200 StashList`；`POST …/stashes`（stashActionSchema）→ `200 StashList`；zod 拒绝 → 400；`INVALID_REF`/`INVALID_QUERY` → 400；未注册 repoId → 404。

**实现模板**：与前序计划 Task 4 完全同构（P2-C 的 branches 路由是最近的判别联合先例）。

- [ ] **Step 1: 写失败测试** —— 两端各：openRepo → `GET stashes` 200 `{stashes:[]}`；造改动（测试内 execFileSync git 写文件）→ `POST {action:'save',message:'x'}` 200 且列表 1 条；`POST {action:'apply',index:0}` 200；`POST {action:'drop',index:0}` 200 列表空；`{action:'pop',index:-1}` → 400；无改动 save → 400 `INVALID_QUERY`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): stashes 端点两端对称落地"`

---

### Task 5: client —— stash hooks

**Files:**
- Create: `packages/client/client/src/stash.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/stash.test.ts`

**Interfaces:**
- Produces:

```ts
/** 贮藏列表：GET /api/repos/:repoId/stashes */
export function useStashes(repoId: string): SWRResponse<StashList>;
/** 贮藏操作（mutation）：POST 同路径，响应（刷新列表）经 useSWRConfig().mutate 回写 useStashes 缓存键（跨键回写约定同 staging hooks） */
export function useStashAction(repoId: string): { trigger: (action: StashAction) => Promise<StashList>; isMutating: boolean };
```

- [ ] **Step 1: 写失败测试**（mock fetch 手法）：URL/method/body 断言 + 缓存回写断言（经共挂载 useStashes 观测）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): stash hooks"`

---

### Task 6: ui —— StashPanel 组合页面

**Files:**
- Create: `packages/client/ui/src/composite/stash-panel.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: `packages/client/ui/src/composite/stash-panel.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** 贮藏面板（对照 Java GitStashDialog/GitUnstashAsDialog 的原子动作面）：
 *  顶部保存表单 Card（message Input + includeUntracked Checkbox + 保存按钮）；
 *  下方贮藏列表 Card（空态 EmptyState）：行 = stash@{index} 徽标 + message + 相对日期 + 操作（应用/弹出/转分支/删除——弹出与删除走 Popconfirm，转分支开 Modal 输入分支名）。
 *  纯 props 驱动。 */
export interface StashPanelProps {
  stashes: StashList;
  onAction: (action: StashAction) => void;
  acting?: boolean;
}
export function StashPanel(props: StashPanelProps): React.ReactNode;
```

- 注意：antd v6.6.1 `List` 已弃用（运行期警告）——行列表用 `Flex vertical` 渲染（沿用 StatusPage 的既有做法）。
- 日期展示用既有 `format.ts`（domain/）的相对时间助手（若有；没有则简单 `toLocaleString`，勿新造轮子）。

- [ ] **Step 1: 写失败测试**：空态渲染；保存表单提交调 `onAction({action:'save',message,includeUntracked})`；行操作回调（应用 `{action:'apply',index}`、弹出经确认 `{action:'pop',index}`、删除经确认、转分支 Modal 输入名后 `{action:'branch',index,name}`）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): StashPanel 贮藏面板"`

---

### Task 7: 页面装配 —— 两端 stashes 路由 + LogPage 入口

**Files:**
- Create: `apps/web-next/app/repos/[repoId]/stashes/page.tsx`
- Create: `apps/web-koa/src/pages/stashes.tsx`
- Modify: `apps/web-koa/src/main.tsx`（Route `/repos/:repoId/stashes`）
- Modify: `packages/client/ui/src/composite/log-page.tsx`（顶栏加"贮藏"入口，可选 prop `onOpenStashes?: () => void`）
- Modify: `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（注入导航）
- Test: `packages/client/ui/src/composite/log-page.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 5 hooks + Task 6 StashPanel。
- Produces：路由 `/repos/:repoId/stashes`（两端）；LogPage 顶栏"贮藏"按钮。

**实现要点：** 容器（两端同构）：`useStashes` + `useStashAction` → StashPanel；失败 `message.error`；顶部返回日志页按钮；`<StashPanel key={repoId}>`（沿用 SettingsPage 的重挂载约定）。保存/弹出后工作区变化由 events 推送驱动 status 刷新（已接线），贮藏列表由 hook 响应回写。

- [ ] **Step 1: 写失败测试** —— log-page 入口按钮用例。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现全部修改**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— 冒烟（web-next 用 `next dev --webpack`）：真实仓库保存/应用/弹出/删除全链路（`git stash list` 复核）；`git commit -m "feat(apps): StashPanel 两端落地与 LogPage 贮藏入口"`

---

## 自审记录

- Spec 覆盖：§4.2 stash 行（save/pop/apply/drop ✓、stash as branch ✓；un-stash 对话框的组合 UX 明确后置）。
- 类型一致性：StashEntry/StashList/StashAction/StashPanelProps 跨任务签名已对齐；判别联合模式与 P2-C branches 一致。
- 风险：`stash@{n}` 索引在并发操作下漂移——本地优先单客户端语义可接受，api 层越界预检兜底；pop 冲突由 git 报错透出（GIT_ERROR 带 stderr）。


---

## 关账记录（2026-09-03）

7/7 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: Yes**（无 Critical/Important；15 项 deferred minor 全部 safe-to-defer），正式关账。

**终审亮点**：stash@{n} 索引语义跨层完全闭合；同键 mutation 教训落地且有回归守卫；getStatus 预检与 git 真实行为逐条对齐（含双向用例验证）；真实 git 行为测试扎实。

**Rulings / 采纳**：
1. saveStash void 返回 → api 仅靠 getStatus 预检（controller ruling，终审核实落地干净，core JSDoc 已同步）。
2. 终审建议采纳入 hardening：行按钮 `disabled={acting}` 防连点（⑬）、空 message save 测试（⑭）。
3. P3 watcher 扩展注记：把 `.git/refs/stash` + `.git/logs/refs/stash` 纳入事件源是弥合 watcher 缺口的最低成本路径——写入 P3 计划时显式记录。
4. 公共容器 hook 抽象（页面装配逻辑逐字重复）：第 5 个同构页面出现前完成（hardening ⑮）。

终审 Minor（不修，留档）：SaveForm 失败即丢输入、BranchModal confirmLoading 死 prop、pop 文案过度断言（冲突时 git 保留贮藏）。

SDD 工作区已按规程删除，本提交为记录。