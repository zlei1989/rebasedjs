# P3-D：补丁 + 搁置（Shelf）+ Git 控制台 + .gitignore 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P3 阶段最后四个工具型功能域——patch（补丁创建/应用/管理）、shelf（搁置：工作区变更集存档/恢复/删除）、console（Git 命令输出控制台）、ignore（.gitignore 创建/编辑/模板/一键忽略）。全部以 LogPage「更多」菜单为入口。

**Architecture:** 沿用既有分层与两端对称路由。patch 应用走 core 既有 `applyPatch`（stdin 注入）扩展为 check+apply 两段；shelf 为应用层存档（patches 目录旁的 shelves 目录：diff 补丁 + 未跟踪文件内容复制）；console 由 core exec.ts 内置按仓库键控的环形缓冲记录（args/退出码/耗时/输出截断）提供；ignore 是仓库内 `.gitignore` 与 `.git/info/exclude` 的内容读写 + 内建模板。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（patch/shelf/console/ignore 行；`GitStageCreatePatchActionProvider`、平台 `com/intellij/vcs/shelf`、`GitCommandOutputConsolePrinter`、`GitIgnoreFileActionGroup`/`DefaultGitExcludeAction`）；前序计划关账记录（changelist 应用层簿记先例、StatusPage 分组、LogPage 更多菜单）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：core/api 夹具无首提交、预置身份、默认分支名 `git symbolic-ref HEAD --short`；裸仓库装置（patch apply 的双向冲突场景）。
- 错误语义：patch 应用失败（含 check 失败）→ `ServiceError('INVALID_QUERY', '补丁无法应用：<首行 stderr>')`（不落半程状态——check 先行）；shelf 重名 save → INVALID_QUERY；restore/drop 不存在 → INVALID_REF。
- **安全约束**：shelf/patches 目录下用户可控内容仅为补丁与文件内容（写盘与 git apply 的既有安全面）；存档目录在 `REBASED_CONFIG_DIR` 下（测试隔离沿用），生产在 `~/.rebasedjs/`。
- console 缓冲的隐私纪律：仅存 args/退出码/耗时/输出尾 500 字符；不含 token（token 经 extraConfig 注入——**记录 args 时剥离 `-c http.*extraHeader=*` 项**，注释与测试锁定）。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/patches               → PatchList
POST /api/repos/:repoId/patches/create        {name, from?, to?, staged?} → PatchList
POST /api/repos/:repoId/patches/apply         {name} → RepoStatus
POST /api/repos/:repoId/patches/delete        {name} → PatchList
GET  /api/repos/:repoId/shelves               → ShelfList
POST /api/repos/:repoId/shelves               {action:'save',name} | {action:'restore',name} | {action:'drop',name} → ShelfList
GET  /api/repos/:repoId/console?limit=        → ConsoleEntry[]
GET  /api/repos/:repoId/ignore                → {gitignore, exclude}
PUT  /api/repos/:repoId/ignore                {target:'gitignore'|'exclude', content} → 新内容
POST /api/repos/:repoId/ignore/add            {path} → 新内容（追加到 .gitignore）
GET  /api/repos/:repoId/ignore/templates      → IgnoreTemplate[]
```

## 明确不做

- patch 的 3-way apply（`git apply --3way` 增强后置）；patch 文件系统级浏览（自选目录导入导出）。
- shelf 的按 changelist 分层搁置、跨仓库恢复（v1 每仓库独立存档目录）。
- console 的折叠分组（GitConsoleFoldingImpl）、实时流式跟随（v1 拉取式历史列表）。
- ignore 的全局模板同步（jetbrains ignore 插件级功能）。

---

### Task 1: contracts —— patch/shelf/console/ignore 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
export interface PatchEntry { name: string; size: number; createdAtIso: string; }
export interface PatchList { patches: PatchEntry[]; }
export interface ShelfEntry { name: string; createdAtIso: string; untrackedCount: number; }
export interface ShelfList { shelves: ShelfEntry[]; }
export interface ConsoleEntry { id: number; args: string[]; exitCode: number; durationMs: number; stderrTail: string; atIso: string; }
export interface IgnoreContents { gitignore: string; exclude: string; }
export interface IgnoreTemplate { id: string; name: string; content: string; }
```

```ts
// endpoints.ts 追加
export const patchCreateBodySchema = z.object({
  name: z.string().min(1).regex(/^[\w.-]+$/),
  from: z.string().optional(), to: z.string().optional(), staged: z.boolean().optional(),
});
export const patchApplyBodySchema = z.object({ name: z.string().min(1) });
export const patchDeleteBodySchema = z.object({ name: z.string().min(1) });
export const shelfActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), name: z.string().min(1).regex(/^[\w.-]+$/) }),
  z.object({ action: z.literal('restore'), name: z.string().min(1) }),
  z.object({ action: z.literal('drop'), name: z.string().min(1) }),
]);
export const consoleQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) });
export const ignorePutBodySchema = z.object({ target: z.enum(['gitignore', 'exclude']), content: z.string().max(200_000) });
export const ignoreAddBodySchema = z.object({ path: z.string().min(1) });
```

- [ ] **Step 1: 写失败测试** —— 各 schema 正反例（含 patch/shelf name 的非法字符拒绝）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): patch/shelf/console/ignore 端点契约"`

---

### Task 2: core —— exec 环形缓冲 + patch apply 两段

**Files:**
- Modify: `packages/server/core/src/exec.ts`（记录环形缓冲 + `getExecLog(cwd, limit)` 导出；**token 剥离**：记录 args 时过滤 `-c` 值含 `extraheader=` 的条目）
- Modify: `packages/server/core/src/staging.ts`（`applyPatch` 追加 `checkFirst?: boolean`——`git apply --check` 先行；或新函数 `checkApplyPatch`）
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/exec.test.ts`（追加缓冲/剥离用例）、`packages/server/core/src/staging.test.ts`（追加两段用例）

**Interfaces:**
- Produces:

```ts
// exec.ts 追加
export interface ExecLogEntry { args: string[]; exitCode: number; durationMs: number; stderrTail: string; atIso: string; }
/** 按 cwd 键控的环形缓冲（cap 200/仓库）；runGit/streamGit 成功与失败均记录（失败含非零退出；spawn 失败 exitCode -1） */
export function getExecLog(cwd: string, limit: number): ExecLogEntry[];
// staging.ts 追加
/** check+apply 两段：先 git apply --check（失败即抛，不产生半程变更），通过才 apply */
export function checkApplyPatch(cwd: string, patch: string, opts: { cached?: boolean; reverse?: boolean }): Promise<void>;
```

- [ ] **Step 1: 写失败测试**：缓冲——两笔记录（含失败记录 exitCode 非零）；limit 截断；token 剥离（extraConfig 注入 `-c http.x.extraHeader=Authorization: Bearer TOKEN` → getExecLog 的 args 不含 TOKEN 文本）；checkApplyPatch——坏补丁 check 失败且工作区零变更（status 前后一致）、好补丁两段成功。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): exec 环形缓冲（token 剥离）与 check+apply 两段原语"`

---

### Task 3: api —— patch/shelf/console/ignore 服务

**Files:**
- Create: `packages/server/api/src/patch.ts`、`packages/server/api/src/shelf.ts`、`packages/server/api/src/console.ts`、`packages/server/api/src/ignore.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: 对应测试文件

**Interfaces:**
- Produces:

```ts
// patch.ts（存档目录：configDir/patches/<repoId>/<name>.patch；repoId 反查沿 changelist 先例）
export function getPatches(repoPath: string): Promise<PatchList>;
export function createPatch(repoPath: string, body: PatchCreateBody): Promise<PatchList>; // 数据源：from/to 两者 → collectFileDiff? 否——**补丁应为仓库级 diff 全文**：from/to 缺省=工作区（HEAD→工作区，staged=true 时为 HEAD→暂存）；from/to 给定时为两提交间全 diff（git diff from to）
export function applyPatchService(repoPath: string, body: PatchApplyBody): Promise<RepoStatus>; // 读文件 → checkApplyPatch（工作区 apply）；失败映射 INVALID_QUERY '补丁无法应用：<stderr 首行>'
export function deletePatch(repoPath: string, body: PatchDeleteBody): Promise<PatchList>;
// shelf.ts（shelves/<repoId>/<name>/ 下 patch.diff + untracked/ 目录复制未跟踪文件；保存不清理工作区）
export function getShelves(repoPath: string): Promise<ShelfList>;
export function applyShelfAction(repoPath: string, action: ShelfAction): Promise<ShelfList>; // save：工作区+暂存 diff + 未跟踪文件复制（fs 递归复制，跳过 .git）；restore：apply patch（同 patch 失败映射）+ 未跟踪文件复制回；drop：删目录；重名 save → INVALID_QUERY '搁置已存在：…'；restore/drop 不存在 → INVALID_REF
// console.ts
export function getConsole(repoPath: string, limit: number): Promise<ConsoleEntry[]>; // core getExecLog 薄映射（含 id 序号）
// ignore.ts
export function getIgnore(repoPath: string): Promise<IgnoreContents>; // .gitignore 与 .git/info/exclude 读取（不存在 → ''）
export function putIgnore(repoPath: string, body: IgnorePutBody): Promise<IgnoreContents>;
export function addIgnore(repoPath: string, body: IgnoreAddBody): Promise<IgnoreContents>; // 追加 '/<path>' 行（已存在相同行则不变）
export function getIgnoreTemplates(): IgnoreTemplate[]; // 内建 3 模板：Node / Python / 通用（常量表，中文注释）
```

- index.ts 追加全部出口。
- [ ] **Step 1: 写失败测试**（REBASED_CONFIG_DIR 隔离）：patch 列表/创建（工作区与 from/to 两态）/apply 成功与坏补丁/删除；shelf save（untrackedCount 正确）/restore（文件回工作区）/drop/重名与不存在预检；console 映射（含 token 剥离断言）；ignore 读/写/add 幂等/模板。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): patch/shelf/console/ignore 服务"`

---

### Task 4: 两端路由 —— 四个域端点（11 端点）

**Files:**
- Create: web-next 8 个 route.ts（patches GET、patches/create、patches/apply、patches/delete、shelves GET+POST、console GET、ignore GET+PUT、ignore/add、ignore/templates）
- Modify: `apps/web-koa/src/routes/repos.ts`（11 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 3 api 出口。
- Produces（HTTP 形状）：按端点总览；zod 拒绝 → 400；INVALID_QUERY/INVALID_REF → 400；未注册 404。
- [ ] **Step 1: 写失败测试** —— 两端各：patches create/apply/delete 往返；shelves save/restore/drop；console 列表（造一笔 git 操作后查询）；ignore 读/写/add + 模板；zod 反例（非法 name）；404。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): patch/shelf/console/ignore 端点两端对称落地"`

---

### Task 5: client —— 四组 hooks

**Files:**
- Create: `packages/client/client/src/patch.ts`、`shelf.ts`、`console.ts`、`ignore.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: 对应测试文件

**Interfaces:**
- Produces:

```ts
export function usePatches(repoId: string): SWRResponse<PatchList>;
export function useCreatePatch(repoId: string): mutation; // 同键纪律
export function useApplyPatch(repoId: string): mutation → RepoStatus（回写 status 键）;
export function useDeletePatch(repoId: string): mutation; // 同键纪律
export function useShelves(repoId: string): SWRResponse<ShelfList>;
export function useShelfAction(repoId: string): mutation; // 同键纪律
export function useConsole(repoId: string, limit?: number): SWRResponse<ConsoleEntry[]>;
export function useIgnore(repoId: string): SWRResponse<IgnoreContents>;
export function usePutIgnore(repoId: string): mutation; // 回写 useIgnore 键
export function useAddIgnore(repoId: string): mutation; // 回写 useIgnore 键
export function useIgnoreTemplates(): SWRResponse<IgnoreTemplate[]>;
```

- [ ] **Step 1: 写失败测试**（mock fetch/freshCache/共挂载/1-GET 守卫）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): patch/shelf/console/ignore hooks"`

---

### Task 6: ui —— IgnoreDialog + StatusPage 忽略入口 + ConsolePanel

**Files:**
- Create: `packages/client/ui/src/composite/ignore-dialog.tsx`、`packages/client/ui/src/composite/console-panel.tsx`
- Modify: `packages/client/ui/src/composite/status-page.tsx`（未跟踪组行内可选「忽略」操作——新增可选 prop `onIgnore?: (path: string) => void`，缺省不渲染，向后兼容）、`packages/client/ui/src/index.ts`
- Test: 对应 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** .gitignore 对话框：target 切换（.gitignore / .git/info/exclude）+ 可编辑文本域 + 模板下拉（选中即替换预览，确认才写）+ 确定/取消（关闭复位） */
export interface IgnoreDialogProps { open: boolean; contents: IgnoreContents; templates: IgnoreTemplate[]; onOk: (target: 'gitignore' | 'exclude', content: string) => void; onCancel: () => void; confirming?: boolean; }
export function IgnoreDialog(props: IgnoreDialogProps): React.ReactNode;

/** Git 控制台面板：记录列表（时间 + args 一行 + 退出码徽标（0 绿/非 0 红）+ 耗时 + stderr 尾）；「刷新」按钮；空态 */
export interface ConsolePanelProps { entries?: ConsoleEntry[]; loading?: boolean; onRefresh?: () => void; }
export function ConsolePanel(props: ConsolePanelProps): React.ReactNode;
```

- [ ] **Step 1: 写失败测试**：IgnoreDialog 两 target 切换/模板替换/提交载荷/复位；StatusPage onIgnore 入口渲染与回调（未跟踪行）；ConsolePanel 列表/徽标/空态/刷新。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): IgnoreDialog 与 ConsolePanel 及 StatusPage 忽略入口"`

---

### Task 7: ui —— PatchPanel + ShelfPanel

**Files:**
- Create: `packages/client/ui/src/composite/patch-panel.tsx`、`packages/client/ui/src/composite/shelf-panel.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** 补丁面板：列表（name/大小/创建时间 + 应用/删除 Popconfirm）+ 创建 Modal（name + 范围 Radio：工作区 / 暂存 / 提交区间（from/to 输入）） */
export interface PatchPanelProps { patches: PatchList; onCreate: (body: PatchCreateBody) => void; onApply: (name: string) => void; onDelete: (name: string) => void; acting?: boolean; }
export function PatchPanel(props: PatchPanelProps): React.ReactNode;

/** 搁置面板：列表（name/时间/未跟踪数 + 恢复/删除 Popconfirm）+ 保存 Modal（name 输入） */
export interface ShelfPanelProps { shelves: ShelfList; onAction: (action: ShelfAction) => void; acting?: boolean; }
export function ShelfPanel(props: ShelfPanelProps): React.ReactNode;
```

- [ ] **Step 1: 写失败测试**：PatchPanel 列表/创建载荷三态/应用/删除确认；ShelfPanel 列表/保存/恢复/删除。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): PatchPanel 与 ShelfPanel"`

---

### Task 8: 页面装配 —— 两端四页面 + LogPage 入口

**Files:**
- Create: web-next 4 页面（patches/shelves/console/ignore）+ web-koa 4 页面
- Modify: `apps/web-koa/src/main.tsx`（4 Route）；`packages/client/ui/src/composite/log-page.tsx`（更多菜单追加 补丁/搁置/控制台/忽略 入口——可选 props `onOpenPatches?/onOpenShelves?/onOpenConsole?/onOpenIgnore?`）；两端日志容器注入；两端 status 页容器注入 `onIgnore`（→ useAddIgnore 接 Popconfirm）
- Test: `log-page.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 5 hooks + Task 6/7 组件。
- Produces：路由 `/repos/:repoId/patches|shelves|console|ignore`（两端）；LogPage 四入口；StatusPage 忽略接线。
- 冒烟：两端真实仓库——patch 创建（工作区态）→ 改动 → 应用 → CLI 复核；shelf save（含未跟踪文件）→ 清理工作区 → restore → CLI 复核；console 显示刚才的操作记录（无 token）；ignore 编辑 + StatusPage 一键忽略 → CLI 复核 .gitignore；四入口导航。
- [ ] **Step 1: 写失败测试**（log-page 四入口用例）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `git commit -m "feat(apps): patch/shelf/console/ignore 四页面两端落地与 LogPage 入口"`

---

## 自审记录

- Spec 覆盖：§4.2 四行全落地（patch 创建/应用/管理 ✓；shelf 保存/恢复/删除 ✓（未跟踪文件内容随档）；console git 命令输出展示 ✓（历史列表，折叠/流式明确后置）；ignore 创建/编辑/模板 ✓ + 一键忽略（DefaultGitExcludeAction 的 exclude 面由 target 切换承载））。
- 类型一致性：PatchEntry/PatchList/ShelfEntry/ShelfList/ConsoleEntry/IgnoreContents/IgnoreTemplate/四组 schema/组件 Props 跨任务签名已对齐；console 的 token 剥离为安全硬约束（测试锁定）。
- 简化裁定：shelf 为每仓库独立存档目录（跨仓库恢复后置）；patch 无 3-way apply（错误语义明示）。
- 风险：shelf 未跟踪文件复制对巨型文件的存储成本（v1 接受，注释说明）；ignore 的 add 追加格式 `/path`（以根为基准——Java 同款语义）。
