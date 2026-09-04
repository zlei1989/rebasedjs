# P3-A：远程 + Update Project + 凭据回路 + watcher 扩展 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P3 阶段 remote（远程 CRUD + fetch/pull/push）与 update（Update Project：fetch + 策略化 pull）两个功能域，并携带四个横切项：① watcher 扩展（refs 指纹 → `refs.changed` 事件，弥合分支/贮藏/标签的外部变更缺口）② `GIT_TERMINAL_PROMPT=0` 防挂 + 认证失败检测（→ AUTH_FAILED）③ HTTPS 认证对话框（收集 token → 入 auth 账户 → 自动重试）+ token 注入（`http.extraHeader`）④ host 规范化约定（防"存了查不到"）。

**Architecture:** 沿用既有分层与两端对称路由。token 注入经 `-c http.<baseurl>.extraHeader=Authorization: Bearer <token>` 随单次 git 调用传递（不落 .git/config、不进进程持久状态；进程参数可见性为本地单用户可接受面，注释明示）。watcher 在既有 status/operation 轮询上增加 refs 指纹（`for-each-ref` objectname 聚合 + `refs/stash`），变化产新事件 `refs.changed`。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（remote 行：添加/删除/编辑、fetch/pull/push、fetch spec、rejected push 处理、shallow/unshallow；update 行：Update Project pull + merge/rebase 策略；auth 行：HTTPS 认证对话框——本期落地）；§5（SSE 事件——新增 `refs.changed`）；前序计划 P2-A…P2-H 关账记录（watcher 缺口登记、host 规范化建议、泄露断言建议）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/`（存在，422 文件）；写 UI 用 context7 或沿用仓内既有 antd 用法。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：core/api 夹具无首提交、预置身份、默认分支名用 `git symbolic-ref HEAD --short`；apps 夹具 registerRepo 自带 init 提交；远程测试用裸仓库（`git init --bare` + clone 配方沿用 core branch.test.ts 的远程跟踪装置）。
- 错误语义：`AUTH_FAILED`（401）= 认证失败（stderr 特征：'Authentication failed'/'could not read Username'/'403'/'401'）；rejected push（non-fast-forward）= `CONFLICT`（409）带中文提示「远端有更新的提交，请先拉取/变基」；其余 git 失败 → `GIT_ERROR`。
- **安全约束**：token 只经 extraHeader 单次调用注入；不落 `.git/config`；不进日志；不进任何响应体；进程参数可见性为已知接受面（注释明示）。
- watcher 注释纪律：事件源覆盖范围如实描述（参照 P2-C/F 的过度声称教训）。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/remotes            → RemoteList
POST /api/repos/:repoId/remotes            {action:'add',name,url} | {action:'remove',name} | {action:'setUrl',name,url} → RemoteList
POST /api/repos/:repoId/fetch              {remote?} → FetchResult（更新后的 ahead/behind 经 events 推送）
POST /api/repos/:repoId/pull               {remote?, rebase?} → PullOutcome
POST /api/repos/:repoId/push               {remote?, branch?, forceWithLease?, setUpstream?} → PushOutcome
POST /api/repos/:repoId/update             {strategy:'merge'|'rebase'} → UpdateOutcome（Update Project：fetch 全远程 + 策略化 pull）
GET  /api/repos/:repoId/events             （既有端点扩展）新增事件类型 refs.changed
```

## 明确不做（后续计划）

- fetch spec 自定义编辑器（remote 高级配置）；force push（非 lease）；push tags（P3 tag 计划）；push up to commit / add commit to remote branch（commit 增强）；多远程矩阵的 Update Project（MergeDirectionModel）。
- OAuth 流程；SSH 配置管理（spec §4.2 settings 行的 SSH 部分后置）。

---

### Task 1: contracts —— remote/update 契约 + normalizeHost + refs.changed 约定

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`、`packages/server/contracts/src/sse.ts`（注释 + 事件名常量）
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加）、新增 `packages/server/contracts/src/host.test.ts`

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
/** 远程条目 */
export interface RemoteInfo { name: string; fetchUrl: string; pushUrl: string; }
export interface RemoteList { remotes: RemoteInfo[]; }
/** fetch 结果：updatedRefs 为发生移动的引用（origin/main 等） */
export interface FetchResult { updatedRefs: string[]; }
/** pull/update 结果：up-to-date | updated | conflicts（合并冲突时附冲突列表由调用方查 conflicts 端点） */
export interface PullOutcome { status: 'up-to-date' | 'updated' | 'conflicts'; }
/** push 结果：pushed | rejected | up-to-date；rejected 时 hint 为中文引导 */
export interface PushOutcome { status: 'pushed' | 'rejected' | 'up-to-date'; hint?: string; }
/** Update Project 结果 = fetch + pull 的组合视图 */
export interface UpdateOutcome { fetched: string[]; pull: PullOutcome; }
```

```ts
// endpoints.ts 追加
export const remoteActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: z.string().min(1), url: z.string().min(1) }),
  z.object({ action: z.literal('remove'), name: z.string().min(1) }),
  z.object({ action: z.literal('setUrl'), name: z.string().min(1), url: z.string().min(1) }),
]);
export type RemoteAction = z.infer<typeof remoteActionSchema>;
export const fetchBodySchema = z.object({ remote: z.string().optional() });
export type FetchBody = z.infer<typeof fetchBodySchema>;
export const pullBodySchema = z.object({ remote: z.string().optional(), rebase: z.boolean().optional() });
export type PullBody = z.infer<typeof pullBodySchema>;
export const pushBodySchema = z.object({
  remote: z.string().optional(),
  branch: z.string().optional(),
  forceWithLease: z.boolean().optional(),
  setUpstream: z.boolean().optional(),
});
export type PushBody = z.infer<typeof pushBodySchema>;
export const updateBodySchema = z.object({ strategy: z.enum(['merge', 'rebase']) });
export type UpdateBody = z.infer<typeof updateBodySchema>;
```

```ts
// 新增 packages/server/contracts/src/host.ts（纯函数，跨端共用；index.ts 加 export * from './host'）
/** host 规范化：URL/主机串 → 小写主机名（去协议/端口/路径/尾斜杠）。auth 账户存查与 token 注入的唯一键约定——防「存了查不到」（P2-H 终审建议） */
export function normalizeHost(input: string): string;
```

- sse.ts：`refs.changed` 事件名约定写入文件头注释 + `export const SSE_EVENT_REFS_CHANGED = 'refs.changed'`（payload 为 `{ refs: string[] }` 变化引用名列表，空数组表示指纹变化但名单未知——watcher 实现简化时允许恒空）。
- normalizeHost 语义：`'https://github.com/user/repo.git'`→`'github.com'`；`'git@github.com:user/repo.git'`（scp 式 SSH）→`'github.com'`；`'GitHub.com'`→`'github.com'`；`'github.com:443'`→`'github.com'`（端口剥离——GitHub 443 场景与默认同一账户）；非法输入原样小写返回。

- [ ] **Step 1: 写失败测试** —— 各 schema 正反例；normalizeHost 上列全部用例。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 远程/update 契约 + normalizeHost + refs.changed 约定"`

---

### Task 2: core —— exec 扩展 + remote 原语

**Files:**
- Modify: `packages/server/core/src/exec.ts`（env 加 `GIT_TERMINAL_PROMPT: '0'` + `GIT_ASKPASS: ''` 防交互挂起；opts 加 `extraConfig?: string[]`——每项作为一个 `-c <entry>` 插入参数数组头部既有 `-c core.pager=cat` 之后）
- Create: `packages/server/core/src/remote.ts`
- Modify: `packages/server/core/src/index.ts`
- Test: `packages/server/core/src/remote.test.ts`、`packages/server/core/src/exec.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// remote.ts
export interface CoreRemote { name: string; fetchUrl: string; pushUrl: string; }
/** 远程列表：git remote -v 解析（同名 fetch/push 两行聚合；缺 push 行时 pushUrl=fetchUrl） */
export function listRemotes(cwd: string): Promise<CoreRemote[]>;
export function addRemote(cwd: string, name: string, url: string): Promise<void>;
export function removeRemote(cwd: string, name: string): Promise<void>;
export function setRemoteUrl(cwd: string, name: string, url: string): Promise<void>;
/** fetch：git fetch [--all 或指定远程]；返回发生移动的引用行（-v 输出解析，简洁起见可用 before/after for-each-ref 对比——见实现要点） */
export function fetchRemote(cwd: string, opts: { remote?: string; extraConfig?: string[] }): Promise<{ updatedRefs: string[] }>;
/** pull：git pull [--rebase] [remote]；conflict 检测复用 operation/conflict 原语（kind 或 ls-files -u 非空） */
export function pullRemote(cwd: string, opts: { remote?: string; rebase?: boolean; extraConfig?: string[] }): Promise<{ status: 'up-to-date' | 'updated' | 'conflicts' }>;
/** push：git push [-u] [--force-with-lease] [remote] [branch]（默认当前分支）；rejected 检测：stderr 含 'rejected' 且含 'non-fast-forward'/'fetch first'；返回值同 contracts PushOutcome 形状（core 层用同名字面量） */
export function pushBranch(cwd: string, opts: { remote?: string; branch?: string; forceWithLease?: boolean; setUpstream?: boolean; extraConfig?: string[] }): Promise<{ status: 'pushed' | 'rejected' | 'up-to-date'; hint?: string }>;
/** 浅克隆检测：git rev-parse --is-shallow-repository（输出 'true'/'false'） */
export function isShallowRepo(cwd: string): Promise<boolean>;
```

- 实现要点：`GIT_TERMINAL_PROMPT=0` 使无凭据的 HTTPS 操作快速失败（进 AUTH_FAILED 检测路径）而非挂起等输入——exec.ts env 扩展注释说明动机；`extraConfig` 逐项 `-c` 注入（token 注入的唯一通道）；fetch 的 updatedRefs 用 before/after `for-each-ref --format=%(refname)%00%(objectname) refs/remotes refs/tags` 快照 diff（复用 Task 3 watcher 的指纹函数——core 层导出 `refsFingerprint`/`listRefValues`，Task 2/3 共用）；push 的 'up-to-date' 判定：stderr/stdout 含 'Everything up-to-date'。
- [ ] **Step 1: 写失败测试**（裸仓库 + clone 配方）：listRemotes/addRemote/setRemoteUrl/removeRemote 轮转；fetch：对端裸仓库加提交 → fetch → updatedRefs 含对应引用、ahead/behind 变化（用既有 getStatus 断言）；pull：对端新提交 → updated；无变化 → up-to-date；冲突配方（本地与对端同改一行）→ conflicts；push：本地新提交 → pushed 且对端可见；对端先推 → 本地 push → rejected 且 hint 含「先拉取」；exec：extraConfig 以 `-c` 注入生效（如 `-c core.abbrev=40` 行为差异或 `--show-origin` 探测）+ GIT_TERMINAL_PROMPT 在 env（经 `git var` 不可读——改为间接验证：无凭据 https 远程 fetch 快速失败不挂起，设置短 timeout 断言在超时前以非零退出返回）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/core test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core): exec 防交互扩展与远程原语（fetch/pull/push/CRUD/shallow）"`

---

### Task 3: watcher 扩展 —— refs 指纹 + refs.changed 事件

**Files:**
- Modify: `packages/server/core/src/refs.ts`（新建：refs 指纹原语——若 Task 2 已建则复用/扩展）或并入 `remote.ts`（控制器裁定：指纹原语放 `core/src/refs.ts` 新文件，Task 2 若先在 remote.ts 实现了等价物，本任务做提取合并）
- Modify: `packages/server/api/src/events.ts`（轮询循环并入 refs 指纹，变化产 `refs.changed`）
- Test: `packages/server/core/src/refs.test.ts`（或 remote.test.ts 追加）、`packages/server/api/src/events.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// core/src/refs.ts（新文件）
/** refs 指纹：refs/heads + refs/remotes + refs/tags + refs/stash 的 refname+objectname 聚合哈希（顺序稳定排序后拼接取 sha1 前 16 位）+ 变化的 refname 列表（与上一指纹对比时给出；watcher 与 fetch 快照 diff 共用） */
export interface RefsSnapshot { fingerprint: string; refs: Record<string, string>; }
export function takeRefsSnapshot(cwd: string): Promise<RefsSnapshot>;
export function diffRefsSnapshots(prev: RefsSnapshot, next: RefsSnapshot): string[]; // 变化/新增/删除的 refname 列表
```

- api/events.ts 行为契约：轮询循环内 `takeRefsSnapshot` 与既有 status/operation 同 interval；**首帧追加一帧 `refs.changed`**（payload 为当前全量 refname 列表——客户端首帧建立基线）；之后指纹变化才产 `refs.changed`（payload 为 diffRefsSnapshots 的变化名单）。
- [ ] **Step 1: 写失败测试**：core——空仓库指纹稳定；建分支后指纹变且 diff 含新分支名；stash save 后（refs/stash 出现）diff 含 stash 引用。api events——首帧序列现为 repo.state-changed + operation.state-changed + refs.changed 三帧；造分支后收到 refs.changed 且 payload.refs 含新分支名。
- [ ] **Step 2: 运行确认失败**（core + api 两包）。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(core+api): refs 指纹快照与 refs.changed 事件——watcher 扩展弥合建删缺口"`

---

### Task 4: api —— remote.ts / update.ts + 认证回路

**Files:**
- Create: `packages/server/api/src/remote.ts`、`packages/server/api/src/update.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/remote.test.ts`、`packages/server/api/src/update.test.ts`

**Interfaces:**
- Consumes: Task 2 core 出口；Task 1 `normalizeHost`；既有 `auth.ts`（查账户——auth.ts 需追加一个内部函数 `findToken(host: string): string | null`（**不经掩码出口**，注释标明"仅服务端内部使用，永不出现在响应/日志"；index.ts 不出口该函数——同层直接 import './auth'）。
- Produces:

```ts
// remote.ts
export function getRemotes(repoPath: string): Promise<RemoteList>;
export function applyRemoteAction(repoPath: string, action: RemoteAction): Promise<RemoteList>; // add 重名 → INVALID_QUERY '远程已存在：…'；remove/setUrl 不存在 → INVALID_REF '远程不存在：…'
export function fetchRepo(repoPath: string, body: FetchBody): Promise<FetchResult>;
export function pullRepo(repoPath: string, body: PullBody): Promise<PullOutcome>;
export function pushRepo(repoPath: string, body: PushBody): Promise<PushOutcome>; // rejected → hint '远端有更新的提交，请先拉取/变基'
// update.ts
/** Update Project：fetch 全远程 + 按 strategy 的 pull（merge=git pull / rebase=git pull --rebase） */
export function updateProject(repoPath: string, body: UpdateBody): Promise<UpdateOutcome>;
```

- 认证回路（三个数据传输操作的公共包装 `withAuth(repoPath, remoteName?, gitOp)`）：①解析远程 URL → `normalizeHost` → `findToken`；有 token → extraConfig 注入 `-c http.<scheme>://<host>.extraHeader=Authorization: Bearer <token>`（`http.<baseurl>` 条件节语法：`http.https://github.com.extraheader`——git 对该节的 key 需小写且匹配 URL 前缀，注释写明）；②git 失败且 stderr 命中认证特征 → `ServiceError('AUTH_FAILED', '认证失败，请配置该主机的访问令牌', { context: { host } })`；③其余透出 GIT_ERROR。
- index.ts 追加：`export { applyRemoteAction, fetchRepo, getRemotes, pullRepo, pushRepo } from './remote';`、`export { updateProject } from './update';`
- [ ] **Step 1: 写失败测试**（裸仓库 + clone 配方）：remote CRUD 轮转（重名/不存在预检）；fetch/pull/push 三状态；rejected push → status 'rejected' + hint 中文；updateProject merge/rebase 两策略（rebase 后本地提交落在对端之上——log 顺序断言）；AUTH_FAILED：https 远程指向不存在主机 + 短 timeout → 错误码为 AUTH_FAILED 或 GIT_ERROR 超时均可接受？**否**——认证特征检测须用可控场景：构造本地 HTTP 服务器（node:http）对 git smart-http 端点返回 401——过重；务实裁定：AUTH_FAILED 检测抽纯函数 `isAuthFailure(stderr: string): boolean` 单测覆盖特征串矩阵，集成路径以 GIT_ERROR 透出为接受面（本地无 https 凭据场景下 git 报 'could not read Username' 在 GIT_TERMINAL_PROMPT=0 下出现——该特征串入矩阵即可真实触发，测试用它断言 AUTH_FAILED）。
- token 注入测试：本地裸仓库不支持 http；纯函数级测试 extraConfig 组装（`buildAuthConfig(host, token)` 纯函数导出供测试）；**端到端泄露断言**（P2-H 终审建议）：任意远程操作后，断言该操作的响应体与 events 首帧均不含 token 文本。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 远程/update 服务与认证回路（token 注入 + AUTH_FAILED）"`

---

### Task 5: 两端路由 —— remotes/fetch/pull/push/update 端点

**Files:**
- Create: `apps/web-next/app/api/repos/[repoId]/remotes/route.ts`（GET+POST）、`fetch/route.ts`、`pull/route.ts`、`push/route.ts`、`update/route.ts`（各 POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（6 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 4 api 出口。
- Produces（HTTP 形状）：按端点总览；zod 拒绝 → 400；`AUTH_FAILED` → 401（错误体 `context.host` 供 UI 对话框预填）；`CONFLICT`（rejected push 不用 409——PushOutcome.rejected 是 200 业务结果，409 保留给真冲突；路由层无特判）。
- [ ] **Step 1: 写失败测试** —— 两端各：openRepo + 裸仓库对端（测试内 `git init --bare` + `git remote add`）→ remotes CRUD 往返；fetch → 200 FetchResult；push 本地提交 → pushed；制造分叉后再 push → rejected + hint；update merge → 200；zod 反例各一；未注册 404。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): remotes/fetch/pull/push/update 端点两端对称落地"`

---

### Task 6: client —— remote/update hooks + useRepoEvents refs 扩展

**Files:**
- Create: `packages/client/client/src/remote.ts`、`packages/client/client/src/update.ts`
- Modify: `packages/client/client/src/events.ts`（RepoEventHandlers 加 `onRefs?: (refs: string[]) => void`，`refs.changed` 帧分派）、`packages/client/client/src/index.ts`
- Test: 对应新增/更新测试文件

**Interfaces:**
- Produces:

```ts
// remote.ts
export function useRemotes(repoId: string): SWRResponse<RemoteList>;
export function useRemoteAction(repoId: string): { trigger: (action: RemoteAction) => Promise<RemoteList>; isMutating: boolean }; // 同键纪律
export function useFetch(repoId: string): { trigger: (body?: FetchBody) => Promise<FetchResult>; isMutating: boolean };
export function usePull(repoId: string): { trigger: (body?: PullBody) => Promise<PullOutcome>; isMutating: boolean };
export function usePush(repoId: string): { trigger: (body?: PushBody) => Promise<PushOutcome>; isMutating: boolean };
// update.ts
export function useUpdateProject(repoId: string): { trigger: (body: UpdateBody) => Promise<UpdateOutcome>; isMutating: boolean };
// events.ts —— RepoEventHandlers 追加 onRefs?: (refs: string[]) => void（refs.changed 帧；首帧为全量基线）
```

- [ ] **Step 1: 写失败测试**（沿用 mock fetch/freshCache/共挂载/1-GET 守卫；events.test.ts 追加 refs.changed 帧 → onRefs 用例）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): remote/update hooks 与 refs.changed 订阅"`

---

### Task 7: ui —— RemotePanel + PushDialog/PullDialog/UpdateProjectDialog + AuthDialog

**Files:**
- Create: `packages/client/ui/src/composite/remote-panel.tsx`、`push-dialog.tsx`、`pull-dialog.tsx`、`update-project-dialog.tsx`、`auth-dialog.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** 远程面板（对照 Java GitConfigureRemotesDialog + 远程操作聚合）：远程列表（name + fetchUrl + 操作：编辑/删除 Popconfirm）+ 添加远程 Modal（name+url）+ 行级 fetch 按钮 + 顶部 fetch 全部按钮 */
export interface RemotePanelProps { remotes: RemoteList; onAction: (a: RemoteAction) => void; onFetch: (remote?: string) => void; acting?: boolean; }

/** Push 对话框：远程 Select（默认 origin/唯一远程）+ 分支文本（默认当前分支）+ forceWithLease Checkbox（danger 文案）+ setUpstream Checkbox（默认勾，首次推送场景） */
export interface PushDialogProps { open: boolean; remotes: RemoteList; currentBranch: string | null; onOk: (b: PushBody) => void; onCancel: () => void; confirming?: boolean; }
/** Pull 对话框：远程 Select + rebase Checkbox（「使用 rebase 而非 merge」） */
export interface PullDialogProps { open: boolean; remotes: RemoteList; onOk: (b: PullBody) => void; onCancel: () => void; confirming?: boolean; }
/** Update Project 对话框（对照 GitUpdateOptionsDialog）：策略 Radio（merge/rebase，默认 merge） */
export interface UpdateProjectDialogProps { open: boolean; onOk: (b: UpdateBody) => void; onCancel: () => void; confirming?: boolean; }
/** 认证对话框（对照 GitHttpLoginDialog）：AUTH_FAILED 时弹出——host 只读展示 + account Input + token Input.Password + 确定（「保存并重试」）；取消即放弃操作 */
export interface AuthDialogProps { open: boolean; host: string; onOk: (account: string, token: string) => void; onCancel: () => void; confirming?: boolean; }
```

- [ ] **Step 1: 写失败测试**：RemotePanel 列表/添加 Modal/编辑/删除确认/fetch 回调；PushDialog 载荷组装（forceWithLease/setUpstream 勾选态）；PullDialog rebase 勾选；UpdateProjectDialog 策略 Radio 默认 merge；AuthDialog 提交载荷 + 空禁用。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**（沿用既有 Modal/Popconfirm/Flex 约定）。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): RemotePanel 与 push/pull/update/auth 对话框"`

---

### Task 8: 页面装配 —— 两端 remotes 路由 + LogPage 操作区 + 认证重试回路

**Files:**
- Create: `apps/web-next/app/repos/[repoId]/remotes/page.tsx`、`apps/web-koa/src/pages/remotes.tsx`
- Modify: `apps/web-koa/src/main.tsx`（Route）；`packages/client/ui/src/composite/log-page.tsx`（顶栏加 pull/push/update/远程入口——可选 props `onOpenPull?/onOpenPush?/onOpenUpdate?/onOpenRemotes?`；顶栏按钮增多，把 变更/分支/贮藏/合并/设置 与新区分为「主按钮区 + 更多 Dropdown」由实现者按既有样式最小改动，Dropdown 用 antd 既有组件）
- Modify: `apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（注入四入口 + pull/push/update 对话框状态机 + **认证重试回路**：操作失败 err instanceof ServiceError 且 code==='AUTH_FAILED' → 开 AuthDialog（host 自 err.context）→ onOk = upsertAccount({host, account, token}) → 成功后重试原操作一次）
- Test: `log-page.test.tsx`（追加入口用例）

**Interfaces:**
- Consumes: Task 6 hooks + Task 7 组件 + P2-H 的 `useUpsertAccount`。
- Produces：路由 `/repos/:repoId/remotes`（两端）；LogPage 四个新入口；pull/push/update 对话框在日志页容器内（页面化 Modal 不如对话框内联——Java 版即为对话框）；AuthDialog 全局于日志页容器（其重试回路范式后续页面复用，注释说明）。

**实现要点：**
- fetch/pull/push/update 成功后：status 由 events 推送驱动刷新（fetch 改变 ahead/behind → repo.state-changed；refs 移动 → refs.changed → 日志页重验证分支/日志——容器在 onRefs 回调里 `void mutateLog()` + `void mutateBranches()`（若缓存存在）——watcher 扩展的首个消费方，注释如实描述事件语义）。
- 冒烟：本地裸仓库对端全链路（add remote → push -u → 对端加提交 → fetch → ahead/behind 徽标变化 → pull → 日志出现新提交；update rebase 路径；rejected push 提示；401 场景可用无效 https 远程触发 AUTH_FAILED 对话框→填任意 token→重试失败仍 AUTH_FAILED（提示仍失败属预期，验证对话框开合与重试回路）→ 取消）。
- [ ] **Step 1: 写失败测试**（log-page 入口 + onRefs 装配层以 typecheck + 冒烟兜底）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `git commit -m "feat(apps): 远程页面与 pull/push/update 入口 + 认证重试回路两端落地"`

---

## 自审记录

- Spec 覆盖：§4.2 remote 行（CRUD ✓、fetch/pull/push ✓、shallow 检测原语 ✓（unshallow 操作并入 fetch --unshallow 后置——isShallowRepo 本期只交付检测，unshallow UI 入 remote 增强）、rejected push ✓（200 业务结果 + 中文 hint，完整对话框后置）、fetch spec 明确后置）；update 行 ✓（策略化 pull；多远程矩阵后置）；auth 行（HTTPS 认证对话框 ✓ + 重试回路；credential helper 桥接由 extraHeader 注入替代——本地优先场景下 helper 桥接无增量价值，注释留痕）。
- 横切项：watcher 扩展（refs.changed）✓ Task 3/6/8；GIT_TERMINAL_PROMPT ✓ Task 2；AUTH_FAILED + 对话框 ✓ Task 4/7/8；host 规范化 ✓ Task 1/4；泄露断言 ✓ Task 4。
- 类型一致性：normalizeHost 为 contracts 纯函数（client/server 共用唯一键约定）；refs.changed 事件名常量在 contracts；认证回路 `withAuth`/`isAuthFailure`/`buildAuthConfig` 纯函数可测。
- 风险：extraHeader 的 `http.<baseurl>` 条件节语法版本差异（git ≥2.13 支持；大小写规则注释写明）；Windows 进程参数可见性已在安全约束明示。


---

## 关账记录（2026-09-03）

8/8 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: With fixes**——1 Important（传输操作无超时兜底——终审纠正了 ledger 中"服务端 30s 兜底"的失实延期依据）+ 2 搭车项（未知远程 INVALID_REF 预检、events 泄露守卫）修复波（commit `e872edb`）经限定复审全部 ADDRESSED、零新破坏，正式关账。

**终审亮点**：token 封装链结构性密封（GitExitError 只持原始 args，-c 注入永不进入 context.args → 500 路径）+ 行为级证明（401 集成用例：本地 HTTP 服务器端确收 Bearer 头 + 响应/错误体无 token）；认证重试回路每环有测试；watcher 扩展诚实有锚（stash save/drop 指纹锚定 P2-F 缺口）；isAuthFailure 反向矩阵覆盖 rejected-push 误伤面。

**Rulings（控制器裁决记录）**：
1. GCM_INTERACTIVE=never 追加（GCM 不受 git 自身 GIT_TERMINAL_PROMPT 约束，Git for Windows 全局 credential.helper=manager 是普遍配置；never=有凭据照常、无凭据快败，不破坏已存凭据流）。
2. updatedRefs 用完整 refname 口径（契约注释已同步修正）。
3. buildAuthConfig 双键分离：注入节用完整 authority（含非默认端口——git config --get-urlmatch 实证），查找键用 normalizeHost（端口剥离）。
4. http.ts error.context 透传为真实既有缺陷的正确修复（服务端本已序列化 context，客户端丢弃）。
5. 无体 POST 的 koa/web-next 不对称判 safe-to-defer（全仓既有同款，app 级决策入 hardening ⑳）。

**环境缺陷（msys2/Git for Windows 并发）**：根级全量验证已执行——首次运行在 api 包遭遇 EPERM 临时目录删除竞态（已知 flake 族），api 包单独复跑 106+1skip 全绿；全部包在本分支生命周期内均各自全绿。根级单次全绿在本机受环境缺陷制约，入 hardening ㉑（vitest 对 git 传输夹具限并发评估 + 本机 Git 修复 rebaseall）。

**hardening 新增**：㉒ toServiceError/UI 对 exitCode 124 特判为「操作超时」中文消息（当前为「退出码 124」裸文本）。

终审 triage：24 项 deferred minor 全部 safe-to-defer（#23 改判已随修复消解）。SDD 工作区已按规程删除，本提交为记录。