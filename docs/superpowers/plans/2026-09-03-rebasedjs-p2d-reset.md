# P2-D：Reset + Undo Commit + ResetDialog 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P2 阶段 reset 功能域——Reset（soft/mixed/hard，日志"Reset Current Branch to Here"）与 Undo Commit（撤销最近提交），交付 ResetDialog 对话框并集成进 LogPage（提交详情面板"Reset 到此处" + 顶栏"撤销最近提交"）。

**Architecture:** 沿用既有分层与两端对称路由；ResetDialog 是 LogPage 内嵌对话框（无独立路由）；操作后状态/日志刷新复用既有 events 推送（headHash 变化 → repo.state-changed）。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（reset 行：`GitResetAction`/`GitNewResetDialog`/`GitUncommitAction`）、§4.5（ResetDialog 组合组件）；前序计划 P2-A/B/C。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/`；写 UI 前用 context7 查 antd 用法或沿用仓内既有用法。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：`createTmpRepo` 无首个提交、预置 user.name/email、默认分支名用 `git symbolic-ref HEAD --short` 获取。
- 错误语义：服务层只抛 `ServiceError`（中文 message）；无效 ref → `INVALID_REF`；无提交可撤销 → `INVALID_QUERY`；git 失败 → `GIT_ERROR` 带 stderr。

## 端点总览（本计划新增，两端对称）

```text
POST /api/repos/:repoId/reset              {ref, mode:'soft'|'mixed'|'hard'} → RepoStatus（刷新后）
POST /api/repos/:repoId/reset/undo-commit  （无体）→ RepoStatus（刷新后）
```

## 明确不做

- Reset 的进度事件（reset 为秒级操作，走同步响应）；`git reset --keep/--merge` 模式（Java 版亦无 UI 暴露）。

---

### Task 1: contracts —— reset 契约

**Files:**
- Modify: `packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加 describe）

**Interfaces:**
- Produces:

```ts
/** Reset 请求体：ref 为目标引用（提交哈希/分支/HEAD~n 表达式）；mode 三选（对照 Java GitNewResetDialog：soft 仅移 HEAD、mixed 重置暂存区、hard 连工作区一起重置） */
export const resetBodySchema = z.object({
  ref: z.string().min(1),
  mode: z.enum(['soft', 'mixed', 'hard']),
});
export type ResetBody = z.infer<typeof resetBodySchema>;
```

- [ ] **Step 1: 写失败测试** —— 正例 `{ref:'HEAD~1',mode:'soft'}`；反例：空 ref、mode 枚举外值。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**（按上方代码追加）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): reset 端点契约"`

---

### Task 2: core —— reset 原语

**Files:**
- Create: `packages/server/core/src/reset.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/reset.test.ts`

**Interfaces:**
- Consumes: `runGit`、`GitExitError`；夹具。
- Produces:

```ts
// reset.ts
/** 重置当前分支到 ref：git reset --<mode> <ref>；mode 直传（soft/mixed/hard 由契约层枚举保证） */
export function resetToRef(cwd: string, ref: string, mode: 'soft' | 'mixed' | 'hard'): Promise<void>;
```

- index.ts 追加：`export { resetToRef } from './reset';`

- [ ] **Step 1: 写失败测试**（tmp repo，先造 base 提交再造第二提交）：
  - `resetToRef(repo, 'HEAD~1', 'soft')` 后 `rev-parse HEAD` 等于 base 哈希，且第二提交的文件改动出现在 `git status --porcelain` 暂存列（soft 保留暂存）。
  - 重做第二提交后 `resetToRef(repo, 'HEAD~1', 'hard')` → 工作区文件回到 base 内容（status 干净）。
  - 无效 ref（`resetToRef(repo, 'nope-ref', 'mixed')`）rejects `GitExitError`。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**（单行 runGit 薄封装 + 文件头注释）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): reset 原语"`

---

### Task 3: api —— reset.ts

**Files:**
- Create: `packages/server/api/src/reset.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/reset.test.ts`

**Interfaces:**
- Consumes: Task 2 `resetToRef`；既有 `getRepoStatus`（`./status` 同层直接 import，沿用 P2-B 同约定）；`ServiceError`。
- Produces:

```ts
// reset.ts
/** 重置当前分支到 ref：ref 有效性预检（git rev-parse --verify <ref>^{commit}，失败 → ServiceError('INVALID_REF', '引用不存在或不是提交：…')）；执行后返回刷新状态 */
export function applyReset(repoPath: string, body: ResetBody): Promise<RepoStatus>;

/** 撤销最近提交（Undo Commit，对照 Java GitUncommitAction）：soft reset 到 HEAD~1；无父提交（根提交/无提交）→ ServiceError('INVALID_QUERY', '没有可撤销的提交')；返回刷新状态 */
export function undoCommit(repoPath: string): Promise<RepoStatus>;
```

- index.ts 追加：`export { applyReset, undoCommit } from './reset';`
- 预检实现：`runGit` 不出口到 api——rev-parse 预检用 core 既有原语做不到，**在 core/reset.ts 增加 `verifyCommitish(cwd, ref): Promise<boolean>`**（`git rev-parse --verify --quiet <ref>^{commit}`，exitCode 1 → false）并出口——Task 3 允许回补 core（同包追加一行导出 + core 测试一行用例），在报告里注明。

- [ ] **Step 1: 写失败测试**（tmp repo）：
  - 两提交仓库 `applyReset({ref:'HEAD~1',mode:'mixed'})` → 返回 status.headHash 等于 base 哈希。
  - `applyReset({ref:'nope',mode:'soft'})` → rejects `INVALID_REF`。
  - `undoCommit` 两提交仓库 → headHash 回退且改动保留在暂存区（entries 非空）；再调一次（根提交上）→ rejects `INVALID_QUERY`。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**（含 core `verifyCommitish` 回补）。
- [ ] **Step 4: 运行确认通过**（含 core 包测试）。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api+core): reset/undo-commit 服务与 ref 预检原语"`

---

### Task 4: 两端路由 —— reset 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/reset/route.ts`（POST）、`apps/web-next/app/api/repos/[repoId]/reset/undo-commit/route.ts`（POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（2 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schema + Task 3 api 出口。
- Produces（HTTP 形状）：`POST …/reset`（resetBodySchema）→ `200 RepoStatus`；`POST …/reset/undo-commit`（无体）→ `200 RepoStatus`；zod 拒绝/`INVALID_REF`/`INVALID_QUERY` → 400；未注册 repoId → 404。

**实现模板**：与 P2-A Task 4 完全同构（三件套）。undo-commit 无请求体、不解析 body。

- [ ] **Step 1: 写失败测试** —— 两端各：tmp repo 两提交 + openRepo → `POST reset {ref:'HEAD~1',mode:'soft'}` 200 且 headHash 回退；`POST reset {ref:'',mode:'soft'}` → 400；`POST reset/undo-commit` 200；再调一次到根提交后再调 → 400 `INVALID_QUERY`。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): reset/undo-commit 端点两端对称落地"`

---

### Task 5: client —— reset hooks

**Files:**
- Create: `packages/client/client/src/reset.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/reset.test.ts`

**Interfaces:**
- Produces:

```ts
/** Reset（mutation）：POST /api/repos/:repoId/reset，响应 RepoStatus 回写 status 缓存键 */
export function useReset(repoId: string): { trigger: (body: ResetBody) => Promise<RepoStatus>; isMutating: boolean };
/** 撤销最近提交（mutation）：POST …/reset/undo-commit（无体），响应回写 status 缓存 */
export function useUndoCommit(repoId: string): { trigger: () => Promise<RepoStatus>; isMutating: boolean };
```

- [ ] **Step 1: 写失败测试**（mock fetch）：useReset trigger 的 method/body/缓存回写；useUndoCommit 无请求体（`postJson(url, {})`）与缓存回写。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): reset/undo-commit hooks"`

---

### Task 6: ui —— ResetDialog + CommitDetailsPanel/LogPage 集成

**Files:**
- Create: `packages/client/ui/src/composite/reset-dialog.tsx`
- Modify: `packages/client/ui/src/domain/commit-details-panel.tsx`（可选 prop `onResetHere?: (hash: string) => void`）、`packages/client/ui/src/composite/log-page.tsx`（可选 props `onUndoCommit?: () => void; undoCommitting?: boolean` + ResetDialog 渲染所需的受控 props）
- Modify: `packages/client/ui/src/index.ts`
- Test: `packages/client/ui/src/composite/reset-dialog.test.tsx`、`log-page.test.tsx`（追加）、`commit-details-panel` 测试（存在则追加，不存在则新建）

**Interfaces:**
- Consumes: 契约 `ResetBody`；既有组件风格。
- Produces:

```tsx
/** Reset 对话框（对照 Java GitNewResetDialog）：目标 ref 展示（只读文本，由调用方从选中提交带入）+
 *  mode 三选 Radio（soft「保留暂存区与工作区」/ mixed「保留工作区、重置暂存区（默认）」/ hard「丢弃暂存区与工作区全部改动」，默认 mixed），
 *  hard 二次确认（Popconfirm 包确定按钮或 Modal 内 Checkbox「我了解 hard 将丢弃未提交改动」——选后者：勾选才放行）。
 *  纯受控组件：open/ref 由父级持有，onOk 回调 {ref, mode}。 */
export interface ResetDialogProps {
  open: boolean;
  ref: string;
  refLabel?: string; // 展示用（如短哈希+主题）
  onOk: (body: ResetBody) => void;
  onCancel: () => void;
  confirming?: boolean;
}
export function ResetDialog(props: ResetDialogProps): React.ReactNode;
```

- LogPage 追加可选 props：`onUndoCommit?: () => void; undoCommitting?: boolean;`——顶栏"撤销最近提交"按钮（`RollbackOutlined`，Popconfirm"将撤销最近提交并保留改动到暂存区"）；仅当 `onUndoCommit` 存在时渲染。
- CommitDetailsPanel 追加可选 prop `onResetHere?: (hash) => void`——操作区加"Reset 当前分支到此处"按钮；存在时渲染。

- [ ] **Step 1: 写失败测试**：ResetDialog 默认 mixed；选 hard 未勾选确认时确定禁用、勾选后放行；onOk 传出 `{ref, mode}`；LogPage 传 onUndoCommit 时按钮渲染且 Popconfirm 确认后回调；CommitDetailsPanel 传 onResetHere 时按钮回调带选中 hash。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): ResetDialog 与 LogPage/提交详情集成"`

---

### Task 7: 页面装配 —— 两端 repo 页容器接线

**Files:**
- Modify: `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`
- Test: 容器以 typecheck + 冒烟兜底（沿用仓内现状）

**Interfaces:**
- Consumes: Task 5 hooks + Task 6 组件 props。
- 状态管理（容器内）：`const [resetTarget, setResetTarget] = useState<{ hash: string; label: string } | null>(null)`；CommitDetailsPanel 的 `onResetHere` → setResetTarget；ResetDialog `open={resetTarget !== null}`，`onOk` → `useReset.trigger({ref: resetTarget.hash, mode})` → 关闭 + `message.success('已重置')`；失败 `message.error(err.message)`。
- `onUndoCommit` → `useUndoCommit.trigger()`（Popconfirm 在 LogPage 内）；成功 `message.success('已撤销最近提交')`。
- 刷新：events 推送（headHash 变化）已驱动 status/log 自动刷新，无需手动 mutate；reset 响应回写 status 缓存由 hook 完成。

- [ ] **Step 1–4**: 装配 + `pnpm typecheck && pnpm format && pnpm test` 全量绿。
- [ ] **Step 5: 冒烟 + 提交** —— 两端真实仓库：选中历史提交 → Reset 到此处（mixed）→ `git log` 复核；撤销最近提交 → 改动回到暂存区复核；`git commit -m "feat(apps): reset/undo-commit 两端页面接线"`

---

## 自审记录

- Spec 覆盖：§4.2 reset 行三项（mixed/soft/hard ✓、Reset Current Branch to Here ✓ 经 CommitDetailsPanel、Undo Commit ✓）。
- 类型一致性：ResetBody/ResetDialogProps/LogPage 与 CommitDetailsPanel 新 props 跨任务对齐；undo-commit 无体 POST 在路由/hook/容器三层一致。
- 风险：hard reset 误操作——UI 双重确认（Radio 明示 + Checkbox 放行）已设计；`verifyCommitish` 的 `^{commit}` 剥离 tag/分支到提交，分支名 ref 合法（Java Reset 亦允许分支目标）✓。


---

## 关账记录（2026-09-03）

7/7 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: Yes**（无 Critical/Important；15 项 deferred minor 全部 safe-to-defer），正式关账。

**终审亮点**：全链契约一致性（ResetBody 逐层同一出处）、hard 双重确认真实有效（okButtonProps.disabled + 测试双断言）、undo-commit soft 语义有真实 git 证据（改动确实回暂存区）、刷新链（即时回写 + 轮询推送幂等叠加）无缺口。

**Rulings / 采纳**：
1. 终审建议①：容器 label 改用主题行（`commit.message.split('\n')[0]`）——入 hardening 清单⑪。
2. 终审建议②：spec §4.2 reset 行已补注「经 CommitDetailsPanel 按钮入口（非右键菜单）」（随本提交落地）。
3. 终审建议③：core ref 类调用统一加 `--end-of-options` 收敛 exotic ref ——入 hardening 清单⑫。

SDD 工作区已按规程删除，本提交为记录。