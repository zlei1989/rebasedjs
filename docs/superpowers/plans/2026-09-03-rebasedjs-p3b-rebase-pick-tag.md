# P3-B：变基（含交互式）+ 摘樱桃 + 还原 + 标签 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P3 阶段 rebase（onto + 交互式 pick/reword/squash/fixup/drop + 重排 + continue/abort）、cherry-pick、revert、tag（创建/删除/推送）四个功能域，并以 `POST …/operation/continue` 把"继续"泛化到 merge/rebase/cherry-pick/revert 全操作态（与 P2-A operation 检测、P2-E conflicts 页面形成完整闭环）。

**Architecture:** 沿用既有分层与两端对称路由。交互式变基的程序化执行：`GIT_SEQUENCE_EDITOR` 指向 core 包内的 node shim（`process.execPath` + 包内 shim 文件绝对路径），shim 把服务端按用户编辑生成的 todo 文件复制覆盖 git 传入的 todo 路径；todo 源数据用 `git log --reverse --format=%H%x00%s <base>..HEAD`（与用户编辑结果做全量哈希校验后才执行）。continue 链路统一走 `-c core.editor=true` 编辑器防护（P2-E 教训；reword 提交会开编辑器）。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（rebase/cherry-pick/revert/tag 行）、§4.5.2（`GitRebaseCommitsTableView/Model` → RebaseDialog 交互式提交列表：entry 状态机、上移/下移约束、冲突标记）；前序计划关账记录（P2-A operation、P2-E conflicts/editor 防护、P3-A 认证回路——tag push 复用 withAuth）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：core/api 夹具无首提交、预置身份、默认分支名用 `git symbolic-ref HEAD --short`；冲突配方沿用 P2-A/P2-E；远程推送测试用裸仓库装置（P3-A）。
- 错误语义：`INVALID_REF`（无效 ref/哈希）；`OPERATION_IN_PROGRESS`（已有进行中操作时发起新 rebase/cherry-pick/revert）；无进行中操作 continue → `INVALID_QUERY`；git 失败 → `GIT_ERROR` 带 stderr。
- 编辑器防护：一切可能开编辑器的 git 调用（rebase --continue、reword 产生的提交、cherry-pick/revert --continue）必须 `-c core.editor=true`（注释说明无 TTY 必败动机）。
- watcher 注释纪律：事件覆盖面如实描述。

## 端点总览（本计划新增，两端对称）

```text
POST /api/repos/:repoId/rebase              {onto, branch?} → RebaseOutcome
GET  /api/repos/:repoId/rebase/todo?base=…  → TodoEntry[]（交互式编辑数据源，reverse 顺序）
POST /api/repos/:repoId/rebase/interactive  {base, entries: [{hash, action}]} → RebaseOutcome
POST /api/repos/:repoId/cherry-pick         {hashes: string[]} → PickOutcome
POST /api/repos/:repoId/revert              {hashes: string[]} → PickOutcome
POST /api/repos/:repoId/operation/continue  （无体；按 operation.kind 分派 merge/rebase/cherry-pick/revert --continue）→ RepoStatus
GET  /api/repos/:repoId/tags                → TagList
POST /api/repos/:repoId/tags                {action:'create',name,ref?,message?} | {action:'delete',name} | {action:'push',name,remote?} → TagList
```

`RebaseOutcome = { status: 'success' | 'conflicts' | 'up-to-date' }`；`PickOutcome = { status: 'success' | 'conflicts' }`；`TodoEntry = { hash: string; subject: string }`；`RebaseTodoAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop'`；`TagEntry = { name: string; hash: string; subject: string | null; annotated: boolean }`。

## 明确不做

- auto-squash / fixup-by-subject（`GitAutoSquashCommitAction`/`GitCommitSquashBySubjectAction`）；交互式变基的 exec 行/标签编辑高级项；rebase --update-refs；tag 的 GPG 签名（commit GPG 统一后置）。

---

### Task 1: contracts —— rebase/pick/tag 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
export interface RebaseOutcome { status: 'success' | 'conflicts' | 'up-to-date'; }
export interface PickOutcome { status: 'success' | 'conflicts'; }
export interface TodoEntry { hash: string; subject: string; }
export type RebaseTodoAction = 'pick' | 'reword' | 'squash' | 'fixup' | 'drop';
export interface TagEntry { name: string; hash: string; subject: string | null; annotated: boolean; }
export interface TagList { tags: TagEntry[]; }
```

```ts
// endpoints.ts 追加
export const rebaseBodySchema = z.object({ onto: z.string().min(1), branch: z.string().optional() });
export type RebaseBody = z.infer<typeof rebaseBodySchema>;
export const rebaseTodoQuerySchema = z.object({ base: z.string().min(1) });
export const interactiveRebaseBodySchema = z.object({
  base: z.string().min(1),
  entries: z.array(z.object({
    hash: z.string().min(1),
    action: z.enum(['pick', 'reword', 'squash', 'fixup', 'drop']),
  })).min(1),
});
export type InteractiveRebaseBody = z.infer<typeof interactiveRebaseBodySchema>;
export const pickBodySchema = z.object({ hashes: z.array(z.string().min(1)).min(1) });
export type PickBody = z.infer<typeof pickBodySchema>; // cherry-pick 与 revert 共用
export const tagActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), name: z.string().min(1), ref: z.string().optional(), message: z.string().optional() }),
  z.object({ action: z.literal('delete'), name: z.string().min(1) }),
  z.object({ action: z.literal('push'), name: z.string().min(1), remote: z.string().optional() }),
]);
export type TagAction = z.infer<typeof tagActionSchema>;
```

- [ ] **Step 1: 写失败测试** —— 各 schema 正反例。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 变基/摘樱桃/还原/标签端点契约"`

---

### Task 2: core —— rebase/cherry-pick/revert/tag 原语 + sequence-editor shim

**Files:**
- Create: `packages/server/core/src/rebase.ts`、`packages/server/core/src/pick.ts`、`packages/server/core/src/tag.ts`、`packages/server/core/src/git-sequence-editor.mjs`（shim）
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/rebase.test.ts`、`packages/server/core/src/pick.test.ts`、`packages/server/core/src/tag.test.ts`

**Interfaces:**
- Consumes: `runGit`、`GitExitError`；`getOperationState`/`listConflictedPaths`（冲突判定）；`verifyCommitish`（ref 预检可用）。
- Produces:

```ts
// rebase.ts
export interface CoreRebaseResult { status: 'success' | 'conflicts' | 'up-to-date'; }
/** rebase onto：git rebase <onto> [branch]；conflict 判定同 P2-E（operation.kind==='rebase' 或 ls-files -u 非空）；up-to-date 判定：退出码 0 且 HEAD 未移动 */
export function rebaseOnto(cwd: string, opts: { onto: string; branch?: string }): Promise<CoreRebaseResult>;
/** 交互式变基 todo 数据源：git log --reverse --format=%H%x00%s <base>..HEAD（NUL 分隔字段；base 无效由 git 报错透出） */
export function listTodoCommits(cwd: string, base: string): Promise<{ hash: string; subject: string }[]>;
/** 交互式变基执行：entries 经 api 层校验后写入临时 todo 文件 → GIT_SEQUENCE_EDITOR=<node shim> git rebase -i <base>；
 *  shim 机制注释：git 以 sh -c 调编辑器并传 todo 路径为末参，shim 读取该路径并把准备好的 todo 覆盖写入——实现"程序化编辑"。
 *  conflict 判定同 rebaseOnto；完成后清理临时 todo 文件 */
export function runInteractiveRebase(cwd: string, opts: { base: string; entries: { hash: string; action: string }[] }): Promise<CoreRebaseResult>;
/** 继续变基：git -c core.editor=true rebase --continue（无 rebase 态由 git 报错，api 层预检） */
export function continueRebase(cwd: string): Promise<void>;

// pick.ts
export interface CorePickResult { status: 'success' | 'conflicts'; }
export function cherryPickCommits(cwd: string, hashes: string[]): Promise<CorePickResult>;
export function revertCommits(cwd: string, hashes: string[]): Promise<CorePickResult>;
export function continuePick(cwd: string, kind: 'cherry-pick' | 'revert'): Promise<void>; // git -c core.editor=true <kind> --continue

// tag.ts
export interface CoreTag { name: string; hash: string; subject: string | null; annotated: boolean; }
/** 标签列表：git for-each-ref --format=%(refname:short)%00%(objectname)%00%(subject)%00%(objecttype) refs/tags；annotated = objecttype==='tag'（轻量为 'commit'） */
export function listTags(cwd: string): Promise<CoreTag[]>;
export function createTag(cwd: string, opts: { name: string; ref?: string; message?: string }): Promise<void>; // message → -a -m（附注）；否则轻量
export function deleteTag(cwd: string, name: string): Promise<void>;
export function pushTag(cwd: string, opts: { name: string; remote?: string; extraConfig?: string[] }): Promise<{ status: 'pushed' | 'rejected' | 'up-to-date' }>;
```

- shim 文件 `git-sequence-editor.mjs`：读取 `process.argv` 末参（git 传入的 todo 路径），把 `process.env.REBASED_TODO_FILE` 指向的已备 todo 内容覆盖写入；零依赖、含中文头注释。
- [ ] **Step 1: 写失败测试**（tmp repo 多提交装置）：
  - rebaseOnto：side 分支领先 → main 上 rebase onto side → success 且 log 线性；无变化 → up-to-date；双向改一行 → conflicts 且 `getOperationState().kind==='rebase'`（含 step/total）。
  - listTodoCommits 反序返回 base..HEAD 全量提交。
  - runInteractiveRebase：三提交 pick 中间 drop → 中间提交消失；两提交 squash → 合并为一（父数断言）；reword 单提交（core.editor=true 防护下不改信息——**reword 不改信息时结果等于 pick，测试聚焦 drop/squash/fixup 与重排**；重排：两提交交换 → log 顺序反转）。
  - continueRebase：造冲突解决后 → 完成（kind 回 none）。
  - cherryPickCommits/revertCommits：success/conflicts 两态；continuePick 解决后完成。
  - tag：create 轻量/附注（annotated 字段）→ list 断言；delete；push 到裸仓库（pushed；重复 → up-to-date；对端已有同名不同指向 → rejected）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): 变基/摘樱桃/还原/标签原语与 sequence-editor shim"`

---

### Task 3: api —— rebase/pick/tag 服务 + operation/continue 泛化

**Files:**
- Create: `packages/server/api/src/rebase.ts`、`packages/server/api/src/pick.ts`、`packages/server/api/src/tag.ts`
- Modify: `packages/server/api/src/operation.ts`（追加 `continueOperation` 分派）、`packages/server/api/src/index.ts`
- Test: 对应测试文件

**Interfaces:**
- Consumes: Task 2 core 出口；P3-A 的 `withAuth`（tag push 复用——从 ./remote 同层 import）；`getOperation`（continue 预检）；`getRepoStatus`。
- Produces:

```ts
// rebase.ts
export function rebaseBranch(repoPath: string, body: RebaseBody): Promise<RebaseOutcome>; // 预检：无进行中操作（OPERATION_IN_PROGRESS）；onto 经 verifyCommitish（INVALID_REF）
export function getRebaseTodo(repoPath: string, base: string): Promise<TodoEntry[]>;
export function runInteractiveRebaseService(repoPath: string, body: InteractiveRebaseBody): Promise<RebaseOutcome>; // 预检：无进行中操作；entries 哈希与 listTodoCommits 全量匹配（缺/多/重复 → INVALID_QUERY '提交清单与仓库实际不符')
// pick.ts
export function cherryPick(repoPath: string, body: PickBody): Promise<PickOutcome>; // 哈希经 verifyCommitish 逐个预检（INVALID_REF）；预检无进行中操作
export function revert(repoPath: string, body: PickBody): Promise<PickOutcome>;
// tag.ts
export function getTags(repoPath: string): Promise<TagList>;
export function applyTagAction(repoPath: string, action: TagAction): Promise<TagList>; // create 重名 → INVALID_QUERY '标签已存在：…'；delete/push 不存在 → INVALID_REF；push 走 withAuth
// operation.ts 追加
/** 继续进行中操作：按 kind 分派（merge → core continueMerge；rebase → continueRebase；cherry-pick/revert → continuePick）；kind none 且无 squash 标记 → INVALID_QUERY '当前没有可继续的操作'（merge 的 squash 退化沿用 canContinueMerge） */
export function continueOperation(repoPath: string): Promise<RepoStatus>;
```

- index.ts 追加全部出口（含 `continueOperation`）。
- [ ] **Step 1: 写失败测试**：各服务的状态矩阵 + 预检分支；interactive 的清单校验失败用例；continueOperation 按 kind 分派（rebase 冲突解决后 → 完成；merge 路径不回归；none → INVALID_QUERY）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 变基/摘樱桃/还原/标签服务与 operation/continue 泛化"`

---

### Task 4: 两端路由 —— rebase/cherry-pick/revert/operation-continue/tags 端点

**Files:**
- Create: web-next 7 个 route.ts（rebase、rebase/todo、rebase/interactive、cherry-pick、revert、operation/continue、tags（GET+POST））
- Modify: `apps/web-koa/src/routes/repos.ts`（8 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 3 api 出口。
- Produces（HTTP 形状）：按端点总览；`operation/continue` 无体 POST；`rebase/todo` 的 base 经 rebaseTodoQuerySchema 校验。
- [ ] **Step 1: 写失败测试** —— 两端各：rebase onto 200；todo 列表；interactive（drop 一提交 → 200 且 git log 复核）；cherry-pick 200；revert 200；operation/continue 无态 → 400；tags CRUD+push 往返（裸仓库对端）；zod 反例；未注册 404。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): rebase/cherry-pick/revert/operation-continue/tags 端点两端对称落地"`

---

### Task 5: client —— rebase/pick/tag/operation-continue hooks

**Files:**
- Create: `packages/client/client/src/rebase.ts`、`packages/client/client/src/pick.ts`、`packages/client/client/src/tag.ts`
- Modify: `packages/client/client/src/operation.ts`（追加 `useContinueOperation`）、`packages/client/client/src/index.ts`
- Test: 对应测试文件

**Interfaces:**
- Produces:

```ts
// rebase.ts
export function useRebase(repoId: string): { trigger: (body: RebaseBody) => Promise<RebaseOutcome>; isMutating: boolean };
export function useRebaseTodo(repoId: string, base: string): SWRResponse<TodoEntry[]>; // base==='' → key null
export function useInteractiveRebase(repoId: string): { trigger: (body: InteractiveRebaseBody) => Promise<RebaseOutcome>; isMutating: boolean };
// pick.ts
export function useCherryPick(repoId: string): { trigger: (body: PickBody) => Promise<PickOutcome>; isMutating: boolean };
export function useRevert(repoId: string): { trigger: (body: PickBody) => Promise<PickOutcome>; isMutating: boolean };
// tag.ts
export function useTags(repoId: string): SWRResponse<TagList>;
export function useTagAction(repoId: string): { trigger: (action: TagAction) => Promise<TagList>; isMutating: boolean }; // 同键纪律
// operation.ts 追加
export function useContinueOperation(repoId: string): { trigger: () => Promise<RepoStatus>; isMutating: boolean }; // 响应回写 status 缓存键
```

- [ ] **Step 1: 写失败测试**（沿用 mock fetch/freshCache/共挂载/1-GET 守卫）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): rebase/pick/tag/continue hooks"`

---

### Task 6: ui —— RebaseDialog（交互式 todo 编辑器）

**Files:**
- Create: `packages/client/ui/src/composite/rebase-dialog.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: `packages/client/ui/src/composite/rebase-dialog.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** 交互式变基对话框（对照 GitInteractiveRebaseDialog + GitRebaseCommitsTableView）：
 *  两种模式：简单模式（onto 输入 + 开始）与交互模式（todo 列表编辑）。
 *  todo 行：短哈希 + subject + 动作 Select（pick/reword/squash/fixup/drop）+ 上移/下移按钮（首行禁上移、末行禁下移——对照 Java 的排序约束）。
 *  纯受控组件：open/mode 由父级持有；todo 数据由容器注入（useRebaseTodo）。 */
export interface RebaseDialogProps {
  open: boolean;
  /** 简单模式提交 */
  onRebaseOnto: (body: RebaseBody) => void;
  /** 交互模式数据源（容器按 base 注入） */
  todo?: TodoEntry[];
  todoLoading?: boolean;
  /** 交互模式提交（entries 为编辑后全量列表，顺序即新顺序） */
  onInteractiveRebase: (body: { base: string; entries: { hash: string; action: RebaseTodoAction }[] }) => void;
  onCancel: () => void;
  confirming?: boolean;
  /** 交互模式的 base 引用（容器已知，回传用） */
  base?: string;
}
export function RebaseDialog(props: RebaseDialogProps): React.ReactNode;
```

**实现要点：**
- 模式切换用 `Radio.Group`（简单/交互）；交互模式：base 输入变化 → `onLoadTodo?` 回调（或容器按 base 驱动数据，组件纯渲染——选后者：加可选 `onBaseChange?: (base: string) => void` 让容器重取 todo）。
- 行内状态：初始每行 action='pick'；本地 state 管理顺序与动作（Modal 关闭复位——BranchPanel 教训）；squash/fixup 的目标行交互提示（squash 会并入上一非 drop 行——文案注释即可，不强制约束）。
- 校验：全部行 drop 时禁用确定（无意义）；确定载荷 = 编辑后顺序的 entries。
- [ ] **Step 1: 写失败测试**：行渲染（哈希+subject+默认 pick）；上移/下移交换顺序与边界禁用；动作 Select 变更；全 drop 禁用确定；提交载荷顺序正确；onCancel 复位（重开恢复初始）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): RebaseDialog 交互式变基编辑器"`

---

### Task 7: ui —— TagPanel + CommitDetailsPanel 摘樱桃/还原入口 + conflicts 页 continue 泛化

**Files:**
- Create: `packages/client/ui/src/composite/tag-panel.tsx`
- Modify: `packages/client/ui/src/domain/commit-details-panel.tsx`（可选 props `onCherryPick?/onRevert?: (hash: string) => void`）、`packages/client/ui/src/composite/conflicts-panel.tsx`（continue 文案按 operation kind 泛化——可选 prop `operationKind?: OperationKind`；merge→「完成合并」、rebase→「继续变基」、cherry-pick→「继续摘樱桃」、revert→「继续还原」）
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应测试文件

**Interfaces:**
- Produces:

```tsx
/** 标签面板：列表（name + annotated 徽标 + subject + 操作：推送/删除 Popconfirm）+ 创建 Modal（name + ref 可空默认 HEAD + message 可空（附注）） */
export interface TagPanelProps { tags: TagList; onAction: (action: TagAction) => void; acting?: boolean; }
```

- [ ] **Step 1: 写失败测试**：TagPanel 列表/创建载荷（轻量 vs 附注 message 携带）/删除确认/push 回调；CommitDetailsPanel 两按钮渲染与回调；ConflictsPanel 按 operationKind 的 continue 文案四态 + 默认 merge。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): TagPanel 与提交操作入口 + conflicts continue 泛化"`

---

### Task 8: 页面装配 —— 两端 tags 路由 + 日志页操作接线 + conflicts 页 continue 迁移

**Files:**
- Create: `apps/web-next/app/repos/[repoId]/tags/page.tsx`、`apps/web-koa/src/pages/tags.tsx`
- Modify: `apps/web-koa/src/main.tsx`（Route）；`packages/client/ui/src/composite/log-page.tsx`（顶栏「更多」菜单加 变基/标签 入口——可选 props `onOpenRebase?/onOpenTags?`）；两端 repo 页容器（注入入口 + RebaseDialog 状态机 + CommitDetailsPanel 的 onCherryPick/onRevert（Popconfirm 确认后调 hook））；两端 conflicts 页容器（continue 改走 `useContinueOperation` + operationKind 透传）
- Test: `log-page.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 5 hooks + Task 6/7 组件。
- Produces：路由 `/repos/:repoId/tags`（两端）；日志页 变基/标签 入口；RebaseDialog 在日志页容器内（简单/交互两模式接线：简单 → useRebase；交互 → base 变化时 useRebaseTodo 重取 + useInteractiveRebase 提交）；摘樱桃/还原的 Popconfirm → useCherryPick/useRevert；conflicts 页 continue 用 useContinueOperation + operationKind 按 useOperation 数据透传。
- 结果反馈：success → message.success + 日志刷新（events 驱动——rebase 改历史，headHash 变 → 已有链路 ✓；refs 变 → refs.changed ✓）；conflicts → message.warning + 跳 conflicts 页。
- 冒烟：两端真实仓库——rebase onto；交互式 drop+squash（CLI git log 复核）；cherry-pick 与 revert（CLI 复核）；rebase 冲突 → conflicts 页解决 → 继续变基（kind=rebase 文案）；tag 创建/删除/推送裸仓库复核；dev server 停。
- [ ] **Step 1: 写失败测试**（log-page 入口用例）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `git commit -m "feat(apps): tags 页面与变基/摘樱桃/还原/continue 泛化两端落地"`

---

## 自审记录

- Spec 覆盖：§4.2 rebase 行（onto ✓、交互式 pick/reword/squash/fixup/drop ✓、重排 ✓、continue/abort ✓（abort 为 P2-A 既有）；auto-squash/by-subject 明确后置）；cherry-pick 行 ✓（含 continue）；revert 行 ✓；tag 行（创建/删除/推送 ✓）。
- §4.5.2 RebaseDialog 对照：entry 状态机（五动作）✓、上移/下移约束 ✓、冲突标记（结果反馈 + conflicts 页）✓。
- 类型一致性：RebaseOutcome/PickOutcome/TodoEntry/RebaseTodoAction/TagEntry/TagList/TagAction/组件 Props 跨任务签名已对齐；operation/continue 泛化复用 P2-A kind 检测与 P2-E canContinueMerge（squash 退化）。
- 风险：GIT_SEQUENCE_EDITOR shim 的 Windows 路径引号（sh -c 调用约定，测试在 Windows 本机验证）；reword 不改信息等于 pick（测试聚焦结构性变更）；todo 清单校验防错基（服务端全量哈希比对）。
