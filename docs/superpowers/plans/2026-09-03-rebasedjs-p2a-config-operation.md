# P2-A：git 配置 + 进行中操作 + SettingsPage + OperationStatus 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 rebasedjs 增加 P2 阶段的前两个功能域——git 配置读写（config）与进行中操作检测/中止（operation），并落地对应 UI（SettingsPage 页面、OperationStatus 操作条），同时接线已存在但未消费的 `PUT /api/settings`。

**Architecture:** 沿用 P1 分层：contracts（zod schema + 领域类型）→ core（git CLI 原语）→ api（功能服务）→ 两端路由（web-next Route Handlers + web-koa koa-router，只做 zod 校验→调 api→错误映射）→ client（SWR hooks）→ ui（纯展示组件）→ 两个应用的页面容器。operation 状态推送复用既有 `/events` SSE 通道（新增 `operation.state-changed` 事件类型）。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16（App Router）、Koa + @koa/router、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md`（§4.2 功能清单 config/operation 行、§4.3 端点约定、§4.5 组件清单、§5 SSE 事件类型 `operation.state-changed`）；`docs/superpowers/specs/2026-09-01-rebasedjs-apps-assembly-design.md`（路由三件套、SSE/取消链路、UX 对齐条目）。

## Global Constraints

- 注释规范（AGENT.md）：TS/TSX 用中文 JSDoc，文件头说明职责；方法/分支/事件处理注释业务目的；重要方法注释算法思路。
- 分层边界（eslint.shared.ts withBoundary 硬约束）：`api`/`core` 禁 import `next`/`koa`/`react`；`ui` 禁 import `client`/`api`；`client` 禁 import `apps/*`；文件互调只走各包 `index.ts` 公共出口。
- 路由三件套：zod 校验（contracts schema）→ `resolveRepo(repoId)` 解析 repoPath → 调 api → `handleApiError`（`toServiceError` + `httpStatusFor` + `{error:{code,message,context?}}`）。
- 每个任务完成后必须跑质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`（相关包可单跑：`pnpm --filter @rebased/<pkg> test`）。
- 写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/` 相关指南；写 UI 前先用 context7 查 antd 组件用法（或严格沿用本仓已有组件的 antd 用法）。
- 提交规范：沿用 git log 现有风格（`feat:` / `fix:` / `test:` 中文摘要）。
- 错误语义：服务层只抛 `ServiceError`（中文 message）；无进行中操作时中止 → `INVALID_QUERY`。
- 取消链路：本计划无新 SSE 端点；`/events` 复用既有断开→AbortSignal→杀 git 进程链路，不得破坏。

## 端点与类型总览（本计划新增）

```text
GET  /api/repos/:repoId/config           → GitConfigView（白名单键的生效值 + local 值）
PUT  /api/repos/:repoId/config           {key, value}（白名单）→ 写 --local → 返回刷新后的 GitConfigView
GET  /api/repos/:repoId/operation        → OperationState（merge/rebase/cherry-pick/revert/none + rebase 进度）
POST /api/repos/:repoId/operation/abort  → 中止当前操作 → 返回刷新后的 OperationState（应为 none）
GET  /api/repos/:repoId/events           （既有端点扩展）新增事件类型 operation.state-changed
```

---

### Task 1: contracts —— config/operation 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`（追加类型）
- Modify: `packages/server/contracts/src/endpoints.ts`（追加 schema）
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加用例；文件已存在则在其后追加 describe）

**Interfaces:**
- Produces（后续所有任务依赖，签名必须完全一致）:

```ts
// domain.ts 追加
/** git 配置白名单键：读写在契约层收敛，避免任意配置写风险 */
export const CONFIG_KEYS = [
  'user.name',
  'user.email',
  'core.autocrlf',
  'pull.rebase',
  'commit.gpgsign',
  'user.signingkey',
  'fetch.prune',
  'init.defaultBranch',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

/** 单个配置键视图：value 为生效值（local>global>system 合并结果），localValue 为仓库级值；未设置均为 null */
export interface GitConfigEntry {
  key: ConfigKey;
  value: string | null;
  localValue: string | null;
}

/** 仓库 git 配置视图：固定覆盖 CONFIG_KEYS 全量键 */
export interface GitConfigView {
  entries: GitConfigEntry[];
}

/** 进行中操作种类 */
export type OperationKind = 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert';

/** 进行中操作状态：kind 为 none 时无其他字段；rebase 时 step/total 为进度（第 step/total 步） */
export interface OperationState {
  kind: OperationKind;
  step?: number;
  total?: number;
}
```

```ts
// endpoints.ts 追加（文件顶部 import 需加 `import { CONFIG_KEYS } from './domain';`）
/** 配置写请求体：键限白名单；值为字符串（布尔类键由调用方传 'true'/'false' 等 git 原样接受） */
export const configPutBodySchema = z.object({
  key: z.enum(CONFIG_KEYS),
  value: z.string().min(1).max(500),
});
export type ConfigPutBody = z.infer<typeof configPutBodySchema>;
```

- SSE 事件名约定（写入 `sse.ts` 文件头注释即可，无需新类型）：`/events` 流在 `repo.state-changed` 之外新增 `operation.state-changed`（payload 为 `OperationState`）。

- [ ] **Step 1: 写失败测试** —— `endpoints.test.ts` 追加：

```ts
describe('configPutBodySchema', () => {
  it('接受白名单键与字符串值', () => {
    const body = configPutBodySchema.parse({ key: 'user.name', value: '张三' });
    expect(body).toEqual({ key: 'user.name', value: '张三' });
  });
  it('拒绝白名单外的键与空值', () => {
    expect(() => configPutBodySchema.parse({ key: 'core.hooksPath', value: '/x' })).toThrow();
    expect(() => configPutBodySchema.parse({ key: 'user.name', value: '' })).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test` —— 报 `configPutBodySchema` 未定义。
- [ ] **Step 3: 实现** —— 按上方代码修改 domain.ts/endpoints.ts；`index.ts` 确认 `export *` 覆盖（既有为 `export * from './domain'` 等则无需改）。
- [ ] **Step 4: 运行确认通过** 同上命令。
- [ ] **Step 5: 质量门 + 提交** —— `pnpm typecheck && pnpm --filter @rebased/contracts test`；`git add -A && git commit -m "feat(contracts): git 配置白名单与进行中操作契约"`

---

### Task 2: core —— config 与 operation 原语

**Files:**
- Create: `packages/server/core/src/config.ts`
- Create: `packages/server/core/src/operation.ts`
- Modify: `packages/server/core/src/index.ts`（追加出口）
- Test: `packages/server/core/src/config.test.ts`、`packages/server/core/src/operation.test.ts`

**Interfaces:**
- Consumes: `runGit(args, { cwd, signal?, timeoutMs? }): Promise<{stdout,stderr}>`、`GitExitError`（`exitCode`/`stderr` 字段）来自 `./exec`；测试夹具 `createTmpRepo(): string`、`cleanupTmpRepo(dir)` 来自 `./testing/tmp-repo`（测试内 import，不进公共出口）。
- Produces:

```ts
// config.ts
/** 单键配置读取结果：value 为生效值（合并所有作用域），localValue 为仓库级值；未设置为 null */
export interface CoreConfigEntry {
  key: string;
  value: string | null;
  localValue: string | null;
}
export function getGitConfigEntries(cwd: string, keys: string[]): Promise<CoreConfigEntry[]>;
export function setGitConfigLocal(cwd: string, key: string, value: string): Promise<void>;
```

```ts
// operation.ts
export interface CoreOperation {
  kind: 'none' | 'merge' | 'rebase' | 'cherry-pick' | 'revert';
  step?: number;
  total?: number;
}
export function getOperationState(cwd: string): Promise<CoreOperation>;
export function abortGitOperation(cwd: string, kind: 'merge' | 'rebase' | 'cherry-pick' | 'revert'): Promise<void>;
```

- index.ts 追加：`export { getGitConfigEntries, setGitConfigLocal } from './config';` 与 `export { getOperationState, abortGitOperation } from './operation';` + `export type { CoreOperation } from './operation';`

**实现要点（写进代码注释）：**
- `getGitConfigEntries`：逐键 `runGit(['config','--get',key])` 取生效值；`runGit(['config','--local','--get',key])` 取仓库级值；`GitExitError.exitCode === 1`（键未设置）映射为 `null`，其他退出码继续抛。并行 `Promise.all`。
- `setGitConfigLocal`：`runGit(['config','--local',key,value])`。
- `getOperationState`：先 `runGit(['rev-parse','--absolute-git-dir'])` 取 gitDir（worktree 安全，比猜 `.git` 目录可靠）；用 `node:fs/promises` 按优先级检测标记文件：**rebase > merge > cherry-pick > revert**（rebase 冲突时 cherry-pick/merge 标记可能并存，rebase 优先）。`rebase-merge/` 目录存在 → rebase，`msgnum`/`end` 两文件（trim 后 parseInt）给 step/total；`rebase-apply/` → rebase（`next`/`last` 给进度，读不到则省略）；`MERGE_HEAD` → merge；`CHERRY_PICK_HEAD` → cherry-pick；`REVERT_HEAD` → revert；全无 → `{ kind: 'none' }`。
- `abortGitOperation`：kind → 命令映射 `merge --abort` / `rebase --abort` / `cherry-pick --abort` / `revert --abort`。

- [ ] **Step 1: 写失败测试**

`config.test.ts`：

```ts
/** config 原语测试：真实 git CLI + 临时仓库（local 读写回环、未设置键为 null） */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGitConfigEntries, setGitConfigLocal } from './config';
import { createTmpRepo, cleanupTmpRepo } from './testing/tmp-repo';

describe('config 原语', () => {
  let repo: string;
  beforeEach(() => { repo = createTmpRepo(); });
  afterEach(() => { cleanupTmpRepo(repo); });

  it('未设置的键 value/localValue 均为 null', async () => {
    const [entry] = await getGitConfigEntries(repo, ['user.name']);
    expect(entry).toEqual({ key: 'user.name', value: null, localValue: null });
  });

  it('setGitConfigLocal 写仓库级值：value 与 localValue 均生效', async () => {
    await setGitConfigLocal(repo, 'user.name', '张三');
    const [entry] = await getGitConfigEntries(repo, ['user.name']);
    expect(entry.value).toBe('张三');
    expect(entry.localValue).toBe('张三');
  });
});
```

`operation.test.ts`：

```ts
/** operation 原语测试：标记文件检测（真实 merge 冲突造 MERGE_HEAD）+ rebase 进度解析 + 中止回环 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runGit } from './exec';
import { abortGitOperation, getOperationState } from './operation';
import { createTmpRepo, cleanupTmpRepo } from './testing/tmp-repo';

describe('operation 原语', () => {
  let repo: string;
  beforeEach(() => { repo = createTmpRepo(); });
  afterEach(() => { cleanupTmpRepo(repo); });

  it('干净仓库为 none', async () => {
    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
  });

  it('merge 冲突时检测为 merge，abort 后回到 none', async () => {
    // 造冲突：main 与 side 分支改同一行后 merge
    await runGit(['checkout', '-b', 'side'], { cwd: repo });
    await writeFile(join(repo, 'a.txt'), 'side\n');
    await runGit(['add', '.'], { cwd: repo });
    await runGit(['commit', '-m', 'side'], { cwd: repo });
    await runGit(['checkout', 'master'], { cwd: repo });
    await writeFile(join(repo, 'a.txt'), 'master\n');
    await runGit(['add', '.'], { cwd: repo });
    await runGit(['commit', '-m', 'master'], { cwd: repo });
    await runGit(['merge', 'side'], { cwd: repo }).catch(() => {});
    expect((await getOperationState(repo)).kind).toBe('merge');
    await abortGitOperation(repo, 'merge');
    expect(await getOperationState(repo)).toEqual({ kind: 'none' });
  });

  it('rebase-merge 目录给出 step/total 进度', async () => {
    const { stdout } = await runGit(['rev-parse', '--absolute-git-dir'], { cwd: repo });
    const dir = join(stdout.trim(), 'rebase-merge');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'msgnum'), '2\n');
    await writeFile(join(dir, 'end'), '5\n');
    expect(await getOperationState(repo)).toEqual({ kind: 'rebase', step: 2, total: 5 });
  });
});
```

> 注意：`createTmpRepo` 若默认分支名非 master（git 版本差异），测试里用 `git symbolic-ref HEAD --short` 取当前分支名替换 `'master'`；fixture 已造首个提交则直接在首提交上改文件即可——以 fixture 实际行为为准调整，但断言语义不变（冲突 → merge 标记 → abort → none）。

- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test` —— 模块不存在。
- [ ] **Step 3: 实现 config.ts / operation.ts / index.ts 出口**（实现要点见上；文件头中文注释说明职责）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** —— `pnpm typecheck && pnpm --filter @rebased/core test`；`git commit -m "feat(core): git 配置读写与进行中操作检测/中止原语"`

---

### Task 3: api —— config.ts / operation.ts + events 扩展

**Files:**
- Create: `packages/server/api/src/config.ts`、`packages/server/api/src/operation.ts`
- Modify: `packages/server/api/src/events.ts`（轮询循环内并入操作检测，产 `operation.state-changed`）
- Modify: `packages/server/api/src/index.ts`（追加出口）
- Test: `packages/server/api/src/config.test.ts`、`packages/server/api/src/operation.test.ts`、`packages/server/api/src/events.test.ts`（追加用例）

**Interfaces:**
- Consumes: Task 2 的 core 出口；`ServiceError`（`@rebased/contracts`）；既有 `events.ts` 结构（轮询 status、仅变化产事件、首帧为当前状态）。
- Produces:

```ts
// config.ts
export function getRepoConfig(repoPath: string): Promise<GitConfigView>;
export function setRepoConfig(repoPath: string, body: ConfigPutBody): Promise<GitConfigView>; // 写 local 后返回刷新视图
// operation.ts
export function getOperation(repoPath: string): Promise<OperationState>;
export function abortOperation(repoPath: string): Promise<OperationState>; // 无进行中操作 → ServiceError('INVALID_QUERY', '当前没有进行中的操作')；中止后返回刷新状态
// index.ts 追加
export { getRepoConfig, setRepoConfig } from './config';
export { abortOperation, getOperation } from './operation';
```

- events.ts 行为契约（routes/client 依赖）：`watchRepoStatus(repoPath, opts)` 每轮轮询同时检测操作状态；**首帧依次产 `repo.state-changed`（当前状态）与 `operation.state-changed`（当前操作）**；之后仅在各自变化时产对应事件。事件对象形状 `{ type: 'operation.state-changed', payload: OperationState }`（`RepoStateEvent` 联合类型扩展）。

- [ ] **Step 1: 写失败测试**

`config.test.ts`：tmp repo 上 `getRepoConfig` 返回 `entries` 长度等于 `CONFIG_KEYS.length` 且含全部键；`setRepoConfig(repo, { key: 'user.email', value: 'a@b.c' })` 后返回视图里该键 `value==='a@b.c'` 且 `localValue==='a@b.c'`。

`operation.test.ts`：干净 tmp repo `getOperation` → `{ kind: 'none' }`；`abortOperation` 在无操作时 rejects `ServiceError` 且 `code === 'INVALID_QUERY'`；造 merge 冲突（同 Task 2 手法）→ `getOperation().kind === 'merge'` → `abortOperation` 后返回 `{ kind: 'none' }`。

`events.test.ts` 追加：`watchRepoStatus` 首帧后还会收到一次 `operation.state-changed`（payload `{kind:'none'}`）——用既有测试的迭代器取前两帧断言 type 集合。

- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**（config/operation 为 core→契约薄映射；events.ts 轮询体内加 operation 检测与去重记忆，与 status 同一 interval）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** —— `pnpm typecheck && pnpm --filter @rebased/api test`；`git commit -m "feat(api): git 配置与进行中操作服务，events 流扩展 operation.state-changed"`

---

### Task 4: 两端路由 —— config/operation 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/config/route.ts`（GET+PUT）、`apps/web-next/app/api/repos/[repoId]/operation/route.ts`（GET）、`apps/web-next/app/api/repos/[repoId]/operation/abort/route.ts`（POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（追加 4 个注册）
- Test: `apps/web-next/src/routes.test.ts`（追加）、`apps/web-koa/src/app.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3 api 出口 + Task 1 `configPutBodySchema`；两端既有 `handleApiError, resolveRepo`（`src/server-context.ts`）。
- Produces（client 任务依赖的 HTTP 形状）：
  - `GET /api/repos/:repoId/config` → `200 GitConfigView`
  - `PUT /api/repos/:repoId/config` 体 `ConfigPutBody` → `200 GitConfigView`（刷新后）；zod 拒绝 → 400
  - `GET /api/repos/:repoId/operation` → `200 OperationState`
  - `POST /api/repos/:repoId/operation/abort`（无请求体）→ `200 OperationState`；无进行中操作 → 400 `INVALID_QUERY`

**实现模板**（web-next，其余端点同构；写前按 AGENT.md 先翻 `apps/web-next/node_modules/next/dist/docs/` 中 route handler 相关页确认 Next 16 约定未变）：

```ts
/** GET /api/repos/:repoId/config —— repoId 解析 → getRepoConfig → 错误映射；PUT zod 校验 → setRepoConfig → 返回刷新视图 */
import { getRepoConfig, setRepoConfig } from '@rebased/api';
import { configPutBodySchema } from '@rebased/contracts';
import { z } from 'zod';
import { handleApiError, resolveRepo } from '../../../../../src/server-context';

export async function GET(_req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    return Response.json(await getRepoConfig(resolveRepo(z.string().min(1).parse(repoId))));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ repoId: string }> }): Promise<Response> {
  try {
    const { repoId } = await params;
    const body = configPutBodySchema.parse(await req.json());
    return Response.json(await setRepoConfig(resolveRepo(z.string().min(1).parse(repoId)), body));
  } catch (error) {
    return handleApiError(error);
  }
}
```

web-koa 在 `repos.ts` 追加（与既有端点同模式）：

```ts
/** GET /api/repos/:repoId/config —— repoId 解析 → getRepoConfig → 错误映射 */
router.get('/api/repos/:repoId/config', async (ctx) => {
  try {
    ctx.body = await getRepoConfig(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** PUT /api/repos/:repoId/config —— zod 校验 → setRepoConfig → 返回刷新视图 */
router.put('/api/repos/:repoId/config', async (ctx) => {
  try {
    const body = configPutBodySchema.parse(ctx.request.body);
    ctx.body = await setRepoConfig(resolveRepo(z.string().min(1).parse(ctx.params.repoId)), body);
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** GET /api/repos/:repoId/operation —— 进行中操作状态 */
router.get('/api/repos/:repoId/operation', async (ctx) => {
  try {
    ctx.body = await getOperation(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});

/** POST /api/repos/:repoId/operation/abort —— 中止当前操作 → 返回刷新状态 */
router.post('/api/repos/:repoId/operation/abort', async (ctx) => {
  try {
    ctx.body = await abortOperation(resolveRepo(z.string().min(1).parse(ctx.params.repoId)));
  } catch (error) {
    handleApiError(error, ctx);
  }
});
```

（import 行同步追加 `getRepoConfig, setRepoConfig, getOperation, abortOperation` 与 `configPutBodySchema`。）

- [ ] **Step 1: 写失败测试** —— 两端测试各追加：真实 tmp repo 走 `openRepo` 拿 repoId（沿用既有测试手法）→ `GET config` 200 且 `entries` 含 `user.name`；`PUT config` `{key:'user.name',value:'李四'}` 200 且返回视图该键 `localValue==='李四'`；`PUT` 白名单外键 → 400；`GET operation` → `{kind:'none'}`；`POST operation/abort` → 400 `INVALID_QUERY`；未注册 repoId → 404。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/web-next test` / `pnpm --filter @rebased/web-koa test`。
- [ ] **Step 3: 实现路由**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** —— `pnpm typecheck && pnpm format`；`git commit -m "feat(apps): config/operation 端点两端对称落地"`

---

### Task 5: client —— config/operation hooks + events 签名扩展

**Files:**
- Create: `packages/client/client/src/config.ts`、`packages/client/client/src/operation.ts`
- Modify: `packages/client/client/src/events.ts`（`useRepoEvents` 签名扩展）
- Modify: `packages/client/client/src/index.ts`（追加出口）
- Test: `packages/client/client/src/config.test.ts`、`packages/client/client/src/operation.test.ts`、`packages/client/client/src/events.test.ts`（更新 + 追加）

**Interfaces:**
- Consumes: `getJson/putJson/postJson`（`./http`）、`subscribeSse`（`./events`）、契约类型。
- Produces:

```ts
// config.ts
/** 仓库 git 配置：GET /api/repos/:repoId/config */
export function useRepoConfig(repoId: string): SWRResponse<GitConfigView>;
/** 写仓库级配置（mutation）：PUT 同路径，响应回写 useRepoConfig 缓存 */
export function useSetConfig(repoId: string): { trigger: (body: ConfigPutBody) => Promise<GitConfigView>; isMutating: boolean };
```

```ts
// operation.ts
/** 进行中操作状态：GET /api/repos/:repoId/operation */
export function useOperation(repoId: string): SWRResponse<OperationState>;
/** 中止当前操作（mutation）：POST operation/abort，响应回写 useOperation 缓存 */
export function useAbortOperation(repoId: string): { trigger: () => Promise<OperationState>; isMutating: boolean };
```

```ts
// events.ts —— 签名变更（Task 7 同步更新调用方）
export interface RepoEventHandlers {
  onStatus?: (status: RepoStatus) => void;
  onOperation?: (operation: OperationState) => void;
}
/** 订阅仓库推送：repo.state-changed → onStatus；operation.state-changed → onOperation；卸载即中止 */
export function useRepoEvents(repoId: string, handlers: RepoEventHandlers): void;
```

- index.ts 追加：`export { useRepoConfig, useSetConfig } from './config';` 与 `export { useAbortOperation, useOperation } from './operation';`；`export type { RepoEventHandlers } from './events';`

- [ ] **Step 1: 写失败测试** —— config.test.ts（查询串与回写缓存断言，沿用 repos.test.ts/settings.test.ts 的 mock fetch 手法）；operation.test.ts（同上；abort mutation 无请求体——`postJson(url, {})`）；events.test.ts：更新既有 `useRepoEvents(repoId, onChange)` 调用为新签名 `{ onStatus }`，追加 `operation.state-changed` 帧 → `onOperation` 用例。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** —— `git commit -m "feat(client): config/operation hooks 与 useRepoEvents 处理器签名"`

---

### Task 6: ui —— OperationStatus 基础组件 + SettingsPage 组合页面

**Files:**
- Create: `packages/client/ui/src/base/operation-status.tsx`
- Create: `packages/client/ui/src/composite/settings-page.tsx`
- Modify: `packages/client/ui/src/index.ts`（追加出口）
- Test: `packages/client/ui/src/base/operation-status.test.tsx`、`packages/client/ui/src/composite/settings-page.test.tsx`

**Interfaces:**
- Consumes: 契约类型 `OperationState`、`GitConfigView`、`ConfigKey`、`CONFIG_KEYS`、`SettingsState`、`SettingsPatch`；既有 `EmptyState` 风格与 antd 用法参照 `composite/repo-page.tsx`。
- Produces:

```tsx
// base/operation-status.tsx
/** 进行中操作条：merge/rebase/cherry-pick/revert 的中文状态 + 中止按钮（Popconfirm 确认）；none 时不渲染 */
export interface OperationStatusProps {
  operation: OperationState;
  onAbort: () => void;
  aborting?: boolean;
}
export function OperationStatus(props: OperationStatusProps): React.ReactNode;
```

```tsx
// composite/settings-page.tsx
/** 设置页：应用设置（logInEditor 开关）+ 仓库 Git 配置（白名单键逐行：生效值展示 + local 覆盖输入 + 保存）。
 *  纯 props 驱动：ui 不调接口，数据与回调由调用方容器注入 hooks。 */
export interface SettingsPageProps {
  settings?: SettingsState;
  onPatchSettings: (patch: SettingsPatch) => Promise<unknown> | void;
  config?: GitConfigView;
  onSetConfig: (key: ConfigKey, value: string) => Promise<unknown> | void;
}
export function SettingsPage(props: SettingsPageProps): React.ReactNode;
```

- index.ts 追加：`export { OperationStatus, type OperationStatusProps } from './base/operation-status';` 与 `export { SettingsPage, type SettingsPageProps } from './composite/settings-page';`

**实现要点：**
- OperationStatus：kind → 文案映射 `合并中` / `变基中`（有 step/total 时追加 `（第 step/total 步）`）/ `拣选中` / `还原中`；用 antd `Space` + `Tag`（warning 色）+ `Popconfirm`（"确定中止当前操作？工作区将回到操作前状态"）包裹 `Button`（danger、loading={aborting}）。`kind==='none'` 返回 `null`。
- SettingsPage：两个 antd `Card`。①"应用设置"：`Switch` 绑定 `settings.logInEditor`，onChange 调 `onPatchSettings({ logInEditor: checked })`；settings 未就绪显 `Skeleton`。②"Git 配置（仓库级）"：`CONFIG_KEYS` 逐行渲染（`Descriptions` 或 `Form` 行）：标签=key，副文本=生效值（`entry.value ?? '未设置'`，置灰），`Input` 受控于本地 state（初始 `entry.localValue ?? ''`），行尾 `Button` 保存（值非空且与 localValue 不同才可点），点击调 `onSetConfig(key, value)`；config 未就绪显 `Skeleton`。暗色主题沿用（ConfigProvider 在应用壳）。
- 样式 antd + Tailwind，不裸写 div（Space/Row 布局可用 antd `Flex`/`Space`）。

- [ ] **Step 1: 写失败测试**

```tsx
// operation-status.test.tsx（要点，补全 render/import 套路参照既有 ui 测试）
it('merge 状态显示"合并中"，点中止经确认后触发 onAbort', async () => {
  const onAbort = vi.fn();
  render(<OperationStatus operation={{ kind: 'merge' }} onAbort={onAbort} />);
  expect(screen.getByText('合并中')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: /中止/ }));
  await userEvent.click(await screen.findByText('确定')); // Popconfirm 确认
  expect(onAbort).toHaveBeenCalledTimes(1);
});
it('rebase 显示进度；none 不渲染', () => {
  render(<OperationStatus operation={{ kind: 'rebase', step: 2, total: 5 }} onAbort={() => {}} />);
  expect(screen.getByText(/第 2\/5 步/)).toBeTruthy();
  const { container } = render(<OperationStatus operation={{ kind: 'none' }} onAbort={() => {}} />);
  expect(container.firstChild).toBeNull();
});
```

settings-page.test.tsx：渲染两个卡片标题；`onPatchSettings` 在 Switch 点击后以 `{ logInEditor: false }` 调用一次（初始 true）；Git 配置行显示生效值；输入新值点保存调 `onSetConfig('user.name', '新名')`；保存按钮在输入为空或与 localValue 相同时禁用。

- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现两组件**（写 UI 前按 AGENT.md 用 context7 查 antd Switch/Popconfirm/Descriptions 用法或严格沿用仓内既有用法）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** —— `git commit -m "feat(ui): OperationStatus 操作条与 SettingsPage 设置页"`

---

### Task 7: 页面装配 —— 两端 settings 路由 + LogPage 操作条/设置入口

**Files:**
- Create: `apps/web-next/app/repos/[repoId]/settings/page.tsx`
- Create: `apps/web-koa/src/pages/settings.tsx`
- Modify: `apps/web-koa/src/main.tsx`（追加 Route）
- Modify: `packages/client/ui/src/composite/log-page.tsx`（顶栏加 OperationStatus + 设置按钮，可选 props）
- Modify: `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（注入 operation 数据与新签名 useRepoEvents + onOpenSettings 导航）
- Test: `packages/client/ui/src/composite/log-page.test.tsx`（更新/追加）、两端页面容器若已有测试则同步更新

**Interfaces:**
- Consumes: Task 5 hooks（`useRepoConfig/useSetConfig/useOperation/useAbortOperation`、新签名 `useRepoEvents(repoId, { onStatus, onOperation })`）、Task 6 `SettingsPage`/`OperationStatus`。
- Produces（路由面）：
  - web-next：`/repos/[repoId]/settings` 页面；web-koa：`/repos/:repoId/settings` Route。
  - `LogPageProps` 追加可选：`operation?: OperationState; onAbortOperation?: () => void; abortingOperation?: boolean; onOpenSettings?: () => void;`（全部可选，旧调用方不传不炸）。

**实现要点：**
- settings 页面容器（'use client' / SPA 同构）：`use(params)` 取 repoId → `useSettings()` + `useRepoConfig(repoId)` + `useSetConfig(repoId)` → 渲染 `<SettingsPage settings={settings} onPatchSettings={update} config={config} onSetConfig={(k, v) => trigger({ key: k, value: v })} />`；顶部 antd `Button` 返回日志页（web-next `useRouter().push`，koa `useNavigate()`）。保存失败 `message.error(err.message)`。
- log-page.tsx：顶栏（仓库名右侧）渲染 `{operation && onAbortOperation && <OperationStatus .../>}` 与设置入口按钮（`SettingOutlined`，onClick=onOpenSettings）；保持既有 props 不变。
- repo 页容器（两端同构）：`useOperation(repoId)` + `useAbortOperation(repoId)`；`useRepoEvents` 改新签名：`onStatus` 为原回调逻辑（回写 status 缓存 + mutateLog + refreshKey+1），`onOperation` 为 `void mutateOperation(next, { revalidate: false })`；`onOpenSettings` 导航到 settings 路由。
- events.test.ts / 页面既有测试若因签名变更失败，同步更新。

- [ ] **Step 1: 写失败测试** —— log-page.test.tsx 追加：传 `operation={{kind:'merge'}}` + `onAbortOperation` 时顶栏出现"合并中"；传 `onOpenSettings` 时点设置按钮回调触发。容器层以 typecheck + 手工冒烟兜底（两端页面容器测试沿用仓内现状，不新增重测试）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现全部修改**。
- [ ] **Step 4: 运行确认通过** —— `pnpm test`（全量）。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `pnpm typecheck && pnpm format && pnpm test`；手动冒烟：`pnpm dev` 后 3030 与 3031 各打开真实仓库 → 日志页可见设置入口 → settings 页改 user.name 保存生效（`git config user.name` 命令行复核）；`git commit -m "feat(apps): settings 页面路由两端落地，LogPage 集成 OperationStatus 与设置入口"`

---

## 自审记录

- Spec 覆盖：config（§4.2 config 行）→ Task 2/3/4/5/6/7；operation（§4.2 operation 行：检测/中止；进度事件与操作锁属后续长操作任务，本计划覆盖检测+中止+推送）→ Task 2/3/4/5/6/7；`operation.state-changed`（§5）→ Task 3/5；SettingsPage（§4.5 清单）→ Task 6/7；PUT /api/settings 接线（审计报告遗留）→ Task 6/7。
- 明确不做（留给后续计划）：进度事件 `operation.progress`（长操作类功能落地时一并做）、操作锁、GPG/SSH 引导（settings.ts 的 P1 扩展）。
- 类型一致性：`OperationState`/`GitConfigView`/`ConfigPutBody`/`RepoEventHandlers` 跨任务签名已逐一对齐。
