# P4-B：工作树 + 子模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 WorktreePanel（git worktree 列表/创建/清理/删除——`GitWorkingTreeDialog`、`workingTrees/ui`）与 SubmodulePanel（子模块状态列表 `.gitmodules` 解析 + init/update——`GitSubmoduleUpdater`/`GitSubmodule`/`GitModulesFileReader`）。纯 git 域：core 原语 + api 服务 + 两端路由 + 面板，无外部 REST。入口为 LogPage「更多」菜单（恒渲染两项，页面内空态/提示处理）。

**Architecture:** 沿用分层与两端对称路由。`core/worktree.ts`（`git worktree list --porcelain` 解析 + add/remove/prune）+ `core/submodule.ts`（`.gitmodules` 解析 + `submodule status` + update --init）；`api/worktree.ts`/`api/submodule.ts` 服务（错误映射/预检）；`composite/WorktreePanel`/`SubmodulePanel`；页面 `/repos/:id/worktrees`、`/repos/:id/submodules`。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** 架构 spec §4.2 `worktree.ts`（工作树：创建/打开/清理/删除——`GitWorkingTreeDialog`、`workingTrees/ui`）、`submodule.ts`（子模块：状态/更新——`GitSubmoduleUpdater`、`GitSubmodule`、`GitModulesFileReader`）；审计报告 C.23（worktree 仓库识别 🟡 core `findRepoRoot` 已支持 `.git` 指针文件；创建/打开/清理/删除 ❌）、C.24（子模块状态列表 ❌ / 更新 ❌；审计 D.0 形态映射注：Java 侧 Submodule 无独立 UI——仅 Update Project 流程内 `GitUpdateProcess.java:327-335`——本计划以独立面板承载状态+更新，流程内子模块更新属 update.ts 域不覆盖）；D.3.4 边 #88（Git 菜单 New Worktree/Show Worktrees）、#70（分支菜单 New Working Tree——**裁定：v1 不做 BranchPanel 入口，仅 LogPage 菜单入口**，边 #70 记录）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：core/api 夹具无首提交、预置身份、默认分支名 `git symbolic-ref HEAD --short`；多 worktree 装置（`git worktree add` 真实副工作树）；子模块装置（`.gitmodules` 手写 + 本地裸仓库为 URL——**子模块 URL 用本地路径**，离线可测；不依赖真实网络）。
- 错误语义（复用 12 码）：worktree add 分支不存在（预检 `listBranches` 无该分支且非 newBranch）→ `INVALID_REF` '分支不存在：<name>'；路径已存在/非法（含仓库内路径）→ `INVALID_QUERY`；remove 无该工作树 → `INVALID_QUERY` '工作树不存在：<path>'；prune 无 stale 成功空操作；submodule update 失败 → `GIT_ERROR`（stderr 首行中文）；`submodule status` 失败（非 submodule init 仓库）→ 空列表（不是错误——**裁定：仓库无子模块时列表中空，不报错**）。
- worktree 数据模型：`git worktree list --porcelain` 条目 → `{path, branch: string | null, detached: boolean, head: string}`（branch 名取 `branch refs/heads/X`；detached 时 head 为提交短哈希）；主工作树与副工作树同等列出（主工作树 `isMain: true` 标记？——**裁定：不加 isMain**，`branch === 当前仓库默认分支且 path === 仓库根` 的判定由 UI 层做"当前"标记；core 原样透传）。
- worktree 创建裁定：`{path, branch?, newBranch?}`——`newBranch` 给定时 `git worktree add -b <newBranch> <path>`（新分支从当前 HEAD 出发）；否则 `branch` 给定时 `git worktree add <path> <branch>`（attach）；两者都给 → `INVALID_QUERY`；都缺 → `INVALID_QUERY`（'需指定分支或新分支'）。path 必须绝对路径且**不在仓库目录内**（`path.resolve` 与 repoPath 前缀校验）→ INVALID_QUERY。
- worktree 删除裁定：`{path, force?}`——`git worktree remove`（force 时 `--force`-含未提交变更）；**不删除磁盘目录以外内容**（remove 即删目录，Java 同语义——文档注明）；主工作树（path === 仓库根）→ INVALID_QUERY '不能移除当前工作树'。
- submodule 数据模型：`.gitmodules`（`git config -f .gitmodules --get-regexp '^submodule\..*\.(path|url|branch)$'`）→ `SubmoduleEntry {name, path, url, branch?: string, status: 'uninitialized' | 'checked-out' | 'different-commit' | 'conflict', commitSha?: string}`；status 由 `git submodule status` 前缀解析：`-`→uninitialized、`+`→different-commit、`U`→conflict、` `→checked-out（commitSha = 摘要）；`.gitmodules` 有但 status 无条目 → uninitialized；submodule status 失败（如未被 `git submodule init`）→ 全部按 uninitialized 兜底（注释说明）。
- submodule 更新裁定：`{name?, recursive?}`——`git submodule update --init [--recursive] [-- name]`（name 与 .gitmodules 的 submodule 名匹配——用 `--` 分隔路径参数，name 即 path 语义；无 name → 全部）；更新后重查 status 返回列表。
- 面板行为：WorktreePanel 列表（path/分支/当前标记/分离 HEAD 徽标 + 行内删除 Popconfirm）+ 顶部创建 Modal（路径 Input + 分支 Select（既有分支）+ 新分支名 Input，两者互斥选择）+「清理」按钮（prune 确认 Popconfirm）；SubmodulePanel 列表（name/path/url/branch/status 徽标（uninitialized 橙/checked-out 绿/different-commit 红/conflict 红）+ commitSha）+「更新」按钮（name 动作 per 行 + 全量更新 + recursive 勾选——**裁定：全量更新按钮带 recursive Checkbox 默认不勾；行内更新按钮只更新该子模块**）。
- 空态/提示：仓库无子模块 → 「无子模块」（页面空态 + 说明`未检测到 .gitmodules`）；worktree 列表恒有主工作树。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/worktrees              → WorktreeList
POST /api/repos/:repoId/worktrees              {path, branch?, newBranch?} → WorktreeList
POST /api/repos/:repoId/worktrees/remove       {path, force?} → WorktreeList
POST /api/repos/:repoId/worktrees/prune        → WorktreeList
GET  /api/repos/:repoId/submodules             → SubmoduleList
POST /api/repos/:repoId/submodules/update      {name?, recursive?} → SubmoduleList
```

## 明确不做

- 打开工作树（Java「Open in new window」）：web 版 = 用户自行在本应用打开仓库（RepoPage 已有），面板不做打开按钮（记边 #88 部分覆盖——列表+创建即可达）。
- `git worktree repair` / move / lock（`--lock`/`--reason`）：v1 后置。
- BranchPanel→WorktreePanel「New Working Tree」入口（边 #70）：后置（LogPage 菜单入口已覆盖创建能力）。
- Update Project 流程内的子模块更新（属 update.ts 域）：本面板独立承载状态+更新。
- submodule 的递归添加/删除 `.gitmodules`、浅克隆参数（--depth）：v1 仅 update --init [--recursive]。
- 终端（terminal 域）与本地历史（local-history）：可选域，独立计划（后置）。

---

### Task 1: contracts —— worktree/submodule 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
export interface WorktreeEntry { path: string; branch: string | null; detached: boolean; head: string; }
export interface WorktreeList { worktrees: WorktreeEntry[]; }
export interface SubmoduleEntry { name: string; path: string; url: string; branch?: string; status: 'uninitialized' | 'checked-out' | 'different-commit' | 'conflict'; commitSha?: string; }
export interface SubmoduleList { submodules: SubmoduleEntry[]; }
```

```ts
// endpoints.ts 追加
export const worktreeCreateBodySchema = z.object({
  path: z.string().min(1),
  branch: z.string().min(1).optional(),
  newBranch: z.string().min(1).optional(),
});
export const worktreeRemoveBodySchema = z.object({ path: z.string().min(1), force: z.boolean().optional() });
export const submoduleUpdateBodySchema = z.object({ name: z.string().min(1).optional(), recursive: z.boolean().optional() });
```

- [ ] **Step 1: 写失败测试** —— 各 schema 正反例（path 空、branch/newBranch 空、force/recursive 类型、name 空；WorktreeEntry.branch 可空、SubmoduleEntry.status 四值）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): worktree/submodule 域契约"`

---

### Task 2: core —— worktree/submodule 原语

**Files:**
- Create: `packages/server/core/src/worktree.ts`、`packages/server/core/src/submodule.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/worktree.test.ts`、`packages/server/core/src/submodule.test.ts`

**Interfaces:**
- Produces:

```ts
// worktree.ts
export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]>; // git worktree list --porcelain
export async function addWorktree(cwd: string, path: string, opts: { branch?: string; newBranch?: string }): Promise<void>;
export async function removeWorktree(cwd: string, path: string, opts: { force?: boolean }): Promise<void>;
export async function pruneWorktrees(cwd: string): Promise<void>;
// submodule.ts
export async function listSubmodules(cwd: string): Promise<SubmoduleEntry[]>; // .gitmodules + submodule status
export async function updateSubmodules(cwd: string, opts: { name?: string; recursive?: boolean }): Promise<void>;
```

**控制器裁定（遵守）：**
1. `worktree list --porcelain` 解析：条目以空行分隔；`worktree <path>`、`HEAD <sha>`、`branch refs/heads/<name>`（存在则 branch=name、detached=false；`detached` 行存在则 detached=true、branch=null、head=短哈希（HEAD 前 7））。参考 core 既有 `--porcelain`/`for-each-ref` NUL 解析先例的文件组织。**注意 `git worktree list --porcelain` 在 msys2 下路径可能带引号/转义——先实测真实输出再定解析（报告记录实测样例）**。
2. add：`git worktree add [-b <newBranch>] <path> [<branch>]`（newBranch 优先 -b；都无 → 服务层已拦，core 直抛）；branch 不存在 → git 原生报错（服务层预检）。
3. remove：`git worktree remove [--force] <path>`；`--force` 容错未提交变更。
4. submodule：`git config -f .gitmodules --get-regexp '^submodule\..*\.(path|url|branch)$'` 解析（注意 Git 配置键大小写：submodule.NAME.path 逐字保留 NAME 大小写——**实例返回 .gitmodules 实际子模块名大小写**）；status 用 `git submodule status`（可失败——见 Global Constraints 兜底；`git submodule status` 未 init 仓库 exit 128? 实例验证——若失败则全量按 uninitialized）；update：`git submodule update --init [--recursive] [-- <path>]`。
5. 测试装置：worktree——临时仓库（有提交）→ addWorktree 副目录 → listWorktrees 含两条（主+副、branch 名断言）→ removeWorktree → prune；submodule——写 `.gitmodules`（name/path/url=本地裸仓库）→ **需要先在 index 注册子模块 gitlink?**——`git submodule update --init` 没有 gitlink 不工作；装置先例：`git -c protocol.file.allow=always submodule add <url> <path>` 或手动 `git update-index --add --cacheinfo 160000,<sha>,<path>`——**裁定：用 `git submodule add`（本地路径 URL，`-c protocol.file.allow=always`）造装置**，更新用同一 URL 可离线；断言 list/update 往返。
6. core/index.ts 追加出口。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): worktree 与 submodule 原语"`

---

### Task 3: api —— worktree/submodule 服务

**Files:**
- Create: `packages/server/api/src/worktree.ts`、`packages/server/api/src/submodule.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/worktree.test.ts`、`packages/server/api/src/submodule.test.ts`

**Interfaces:**
- Produces:

```ts
// worktree.ts
export function getWorktrees(repoPath: string): Promise<WorktreeList>;
export function createWorktree(repoPath: string, body: WorktreeCreateBody): Promise<WorktreeList>; // 预检：branch/newBranch 互斥且至少其一；分支存在性（branch 时 listBranches 查）；path 绝对且不在 repoPath 内；add 后重查
export function removeWorktree(repoPath: string, body: WorktreeRemoveBody): Promise<WorktreeList>; // path === repoPath → INVALID_QUERY '不能移除当前工作树'
export function pruneWorktrees(repoPath: string): Promise<WorktreeList>;
// submodule.ts
export function getSubmodules(repoPath: string): Promise<SubmoduleList>;
export function updateSubmodules(repoPath: string, body: SubmoduleUpdateBody): Promise<SubmoduleList>; // update --init [--recursive] [-- name] 后重查
```

**控制器裁定（遵守）：**
1. 预检顺序：branch/newBranch 互斥且至少其一 → INVALID_QUERY '需指定分支或新分支（二选一）'；branch 存在性 → INVALID_REF '分支不存在：<name>'；path 绝对（`path.isAbsolute`）且 `!repoPath 前缀`（`resolve + startsWith(repoPath + sep)` 防逃逸先例——先读 patch/shelf 的路径防逃逸写法）→ INVALID_QUERY；add 后 errno/错误 → GIT_ERROR（stderr 首行）。
2. remove：`path === repoPath` → INVALID_QUERY；core 抛错（路径不在 worktree 列表）→ INVALID_QUERY '工作树不存在：<path>'（**预检**：先 listWorktrees 查 path 在列表内，不在 → 直接 INVALID_QUERY，不调 core）；再调 core remove + 重查。
3. 测试：真实临时仓库全套（创建/删除/清理/预检各态/防逃逸）；submodule 装置（submodule add 本地 URL）→ getSubmodules 断言（path/url/branch/status/commitSha）→ updateSubmodules（改子模块提交 → different-commit → update 后 checked-out 或不同——**断言 update 后 status 变化与 CLI 复核**）。
4. api/index.ts 追加出口。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): worktree/submodule 服务"`

---

### Task 4: 两端路由 + client hooks —— worktree/submodule（6 端点 + 6 hooks）

**Files:**
- Create: web-next 5 个 route.ts（`[repoId]/worktrees` GET+POST、`.../remove`、`.../prune`；`[repoId]/submodules` GET、`.../update`）
- Modify: `apps/web-koa/src/routes/repos.ts`（6 注册）、`packages/client/client/src/worktree.ts`（新建）、`packages/client/client/src/submodule.ts`（新建）、`packages/client/client/src/index.ts`
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`、`packages/client/client/src/worktree.test.ts`、`packages/client/client/src/submodule.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 3 api 出口。
- Produces（HTTP 形状）：按端点总览；zod 拒绝 → 400；INVALID_REF/INVALID_QUERY → 400。
- Produces（client hooks）：

```ts
export function useWorktrees(repoId: string): SWRResponse<WorktreeList>;
export function useCreateWorktree(repoId: string): mutation;  // 回写 worktrees 键
export function useRemoveWorktree(repoId: string): mutation;  // 回写 worktrees 键
export function usePruneWorktrees(repoId: string): mutation;  // 回写 worktrees 键
export function useSubmodules(repoId: string): SWRResponse<SubmoduleList>;
export function useUpdateSubmodules(repoId: string): mutation; // 回写 submodules 键
```

- 同键 mutation 纪律（P2-C 教训）：全部 `revalidate:false` + 显式 mutate 回写；mutation 键 = 实际端点 URL；测试照 P3-E/P4-A hooks 模板（freshCache/1-GET 守卫/共挂载/回写断言）。
- [ ] **Step 1: 写失败测试** —— 两端路由（worktrees 列表/创建 branch attach 与 newBranch 创建/互斥 400/删除/清理；submodules 列表/更新；zod 反例 path 空；404）+ client hooks（查询/mutation 回写/1-GET 守卫/共挂载）。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): worktree/submodule 端点两端对称落地与 hooks"`

---

### Task 5: ui —— WorktreePanel + SubmodulePanel

**Files:**
- Create: `packages/client/ui/src/composite/worktree-panel.tsx`、`packages/client/ui/src/composite/submodule-panel.tsx` + 对应 `composite/*.test.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** 工作树面板：列表（path/分支/「当前」标记（path===repoPath 由容器传 currentPath prop 判定?——裁定：组件不解耦，用 props：currentPath?: string）/分离 HEAD 徽标）+ 行内删除 Popconfirm + 顶部创建 Modal（路径 + 分支 Select + 新分支名 Input 互斥）+「清理」按钮（Popconfirm） */
export interface WorktreePanelProps {
  worktrees: WorktreeList; currentPath?: string; // 高亮当前工作树（仓库根路径）
  onCreate: (body: WorktreeCreateBody) => void; onRemove: (path: string, force?: boolean) => void; onPrune: () => void;
  acting?: boolean;
}
export function WorktreePanel(props: WorktreePanelProps): React.ReactNode;

/** 子模块面板：列表（name/path/url/branch/status 徽标/commitSha）+ 行内「更新」+ 顶部「更新全部」（recursive Checkbox 默认不勾） */
export interface SubmodulePanelProps {
  submodules: SubmoduleList;
  onUpdate: (body: SubmoduleUpdateBody) => void; // 行内 → {name}; 全量 → {recursive?}
  acting?: boolean;
}
export function SubmodulePanel(props: SubmodulePanelProps): React.ReactNode;
```

**控制器裁定（遵守）：**
1. WorktreePanel：创建 Modal 路径 Input + 分支 Select（branches **不传——裁定：分支 Select 用文本输入 + 新分支名互斥 Radio**？——简化裁定：两输入框（分支名/新分支名）互斥 Radio 选择「关联已有分支」/「创建新分支」，服务层校验；不引 branches prop（保持面板轻）；path 输入非空校验。行内删除 Popconfirm（「移除工作树」）；「清理」Popconfirm（「清理失效工作树」）→ onPrune。
2. 「当前」标记：currentPath prop 与行 path 相等 → Tag「当前」（绿色）；detached 行 → Tag「分离」（橙）+ head 短哈希。
3. SubmodulePanel：status 徽标（uninitialized 橙「未初始化」/checked-out 绿「已检出」/different-commit 红「提交漂移」/conflict 红「冲突」）；行内「更新」按钮（onUpdate({name})）；顶部「更新全部」+ recursive Checkbox（默认不勾）→ onUpdate({recursive?})（recursive 未勾 → 不带 recursive 键——schema optional）。
4. 空态：worktrees 无（不可能——恒有主工作树；防御空态「暂无工作树」）；submodules 空 → 「无子模块」（未检测到 .gitmodules 说明文字）；acting 禁用；刷新按钮（onRefresh? 可选缺省不渲染——两面板照 ConsolePanel 惯例）。
5. 测试：列表渲染/当前标记/分离徽标/创建 Modal 三态（互斥 Radio、路径非空校验）/删除确认回调/清理回调；submodule 四徽标/行内更新载荷/全量更新载荷（recursive 默认不带键）/空态/acting。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): WorktreePanel 与 SubmodulePanel"`

---

### Task 6: 页面装配 —— 两端两页 + LogPage 入口

**Files:**
- Create: web-next `app/repos/[repoId]/worktrees/page.tsx`、`app/repos/[repoId]/submodules/page.tsx`；web-koa `src/pages/worktrees.tsx`、`src/pages/submodules.tsx`
- Modify: `apps/web-koa/src/main.tsx`（2 Route）、`packages/client/ui/src/composite/log-page.tsx`（追加 `onOpenWorktrees?`/`onOpenSubmodules?` 可选 props——**恒渲染两菜单项**（无 available gate——工作树/子模块是任何仓库都可达的操作面；子模块空态在页面内承载））、两端日志容器（注入导航）、`log-page.test.tsx`（追加两入口用例）
- Test: 页面渲染冒烟 + log-page 用例

**Interfaces:**
- Consumes: Task 4 hooks（useWorktrees/useCreateWorktree/useRemoveWorktree/usePruneWorktrees/useSubmodules/useUpdateSubmodules）+ Task 5 组件。
- Produces：路由 `/repos/:repoId/worktrees|submodules`（两端）；LogPage「更多」菜单两项（恒渲染）；两端页面容器接线（hooks + 面板 + toast/错误处理）。

**控制器裁定（遵守）：**
1. LogPage 新 props：`onOpenWorktrees?`/`onOpenSubmodules?`（**恒渲染，无 available**——与 github/gitlab 的检测门不同，本域无外部依赖；缺省不渲染菜单项，向后兼容）。
2. 页面容器：useWorktrees + 三 mutation（create/remove/prune 均同键回写）；useSubmodules + update 同键回写；错误 toast（照既有容器）；acting 并合。
3. 冒烟（命令序列写报告）：web-next build（含两路由）+ web-koa build；worktree 全链路（koa 真实服务：create 副工作树 → CLI `git worktree list` 复核 → remove → 复核）；submodule 全链路（本地 URL 装置：get → update → CLI `git submodule status` 复核）。

- [ ] **Step 1: 写失败测试**（log-page 两入口用例：注入渲染+回调、缺省不渲染）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `git commit -m "feat(apps): worktree/submodule 两页面两端落地与 LogPage 入口"`

---

### Task 7: 全分支终审（合约任务，无独立实现）

- [ ] 终审包（MERGE_BASE..HEAD）→ 最严 reviewer → findings → ONE fix wave → 限定复审 → 关账记录（计划文件尾）→ 删 SDD 工作区。
- [ ] 关账 commit `docs: P4-B 关账记录（…）`；审计报告增补 P4-B 进度。

---

## 自审记录

- Spec 覆盖：§4.2 worktree.ts/submodule.ts 全功能点映射——worktree 创建/清理/删除 ✅（打开=用户自行打开仓库，记边 #88 部分覆盖）；submodule 状态列表（.gitmodules 解析 ✅）/更新（init/update ✅——Java 无独立 UI，独立面板承载，流程内更新属 update.ts 域不覆盖）。
- 类型一致性：WorktreeEntry/WorktreeList/SubmoduleEntry/SubmoduleList + 3 schema 跨任务签名对齐；错误复用 12 码不新增。
- 简化裁定：worktree current 标记由容器 currentPath prop；分支输入用文本（不引 branches prop）；submodule status 未 init 兜底 uninitialized；Submodule 无外部 REST 所以不需要检测门；子模块 URL 用本地路径装置离线可测。
- 风险：`git worktree list --porcelain` 的 msys2 路径转义（Task 2 实测记录）；`git submodule status` 在未 init 仓库的退出码（Task 2 实例验证）；子模块 gitlink 装置（`git submodule add -c protocol.file.allow=always`）在 CI 环境的口径。
