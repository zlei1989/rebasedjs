# P2-H：凭据与令牌存储（auth）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 P2 阶段 auth 功能域的可验证子集——令牌/账户存储（供 P3 github.ts / P4 gitlab.ts 复用）+ SettingsPage「账户」管理卡片。HTTPS 认证对话框与 credential helper 桥接**后置到 P3 remote 计划**（彼时才有真实 push/fetch 场景可端到端验证，现在做只能造不可达代码）。

**Architecture:** 账户簿记存应用配置（config-store 扩展 `auth` 字段；token 明文存储 + 配置文件 0600 权限加固——本地优先工具的务实取舍，参照 git credential-store 的明文传统）；api 层提供 CRUD + 掩码视图；UI 复用既有 SettingsPage（`/repos/:repoId/settings` 路由已存在，新增卡片）。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2（auth 行：HTTPS 认证对话框、credential helper、token 存储（供 github/gitlab 复用）；`GitHttpAuthService`/`GitHttpLoginDialog`）；前序计划 P2-A…P2-G。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责。
- 分层边界：`api` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → 调 api（本域无 repoId——账户是应用级，端点不走 /repos/:repoId 前缀）→ `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- **安全约束**：token 永不出现在 GET 响应中（掩码视图：`tokenPreview` 只露前 4 位 + ***）；配置文件写盘权限 0600；日志不得打印 token。

## 端点总览（本计划新增，两端对称；应用级无 repoId）

```text
GET  /api/auth/accounts              → AccountList（掩码视图，token 本体不下行）
POST /api/auth/accounts              {host, account, token} → AccountList（刷新后；同 host+account 覆盖更新）
POST /api/auth/accounts/delete       {host, account} → AccountList（刷新后）
```

## 明确不做（后置到 P3 remote 计划）

- HTTPS 认证失败 → 对话框 → 重试回路（`GitHttpAuthService` 对应物）：需要真实 push/fetch 场景驱动，P3 remote.ts 落地时一并设计。
- credential helper 桥接（`core/credential.ts`，spec §4.1 已标注"后置"）：同 P3。
- OAuth 流程（GitHub OAuth App/Device Flow）：P3 github 计划评估。

---

### Task 1: contracts —— auth 契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加 describe）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
/** 账户条目（掩码视图）：token 本体永不下行；tokenPreview 为前 4 位 + '***'（便于用户辨认自己贴的是哪个 token） */
export interface AccountEntry {
  host: string;
  account: string;
  tokenPreview: string;
}
export interface AccountList {
  accounts: AccountEntry[];
}
```

```ts
// endpoints.ts 追加
/** 添加/覆盖账户：host 为主机名（如 github.com、gitlab.example.com）；token 写入端一次性接收，之后只读掩码 */
export const accountBodySchema = z.object({
  host: z.string().min(1),
  account: z.string().min(1),
  token: z.string().min(1),
});
export type AccountBody = z.infer<typeof accountBodySchema>;

/** 删除账户 */
export const accountDeleteBodySchema = z.object({
  host: z.string().min(1),
  account: z.string().min(1),
});
export type AccountDeleteBody = z.infer<typeof accountDeleteBodySchema>;
```

- [ ] **Step 1: 写失败测试** —— 两 schema 正例 + 反例（空 host/account/token）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): 账户/令牌端点契约"`

---

### Task 2: api —— auth.ts + config-store 权限加固

**Files:**
- Modify: `packages/server/api/src/lib/config-store.ts`（AppConfig 扩展 auth 字段 + saveConfig 写盘后 chmod 0600）
- Create: `packages/server/api/src/auth.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/auth.test.ts`、`packages/server/api/src/lib/config-store` 既有测试若涉及权限则追加用例

**Interfaces:**
- Consumes: config-store loadConfig/saveConfig；`ServiceError`。
- Produces:

```ts
// config-store.ts：AppConfig 增加 `auth?: { accounts: StoredAccount[] }`；StoredAccount = { host, account, token }（token 明文，落盘文件 0600——注释说明安全取舍与理由）
// saveConfig 写文件后 fs.chmod 0600（Windows 上 chmod 语义近似只读位——平台差异写注释；POSIX 生效即可，Windows 尽力而为不报错）

// auth.ts
/** 账户列表（掩码视图）：token → tokenPreview（前 4 位 + '***'；长度 ≤4 时全掩码 '***'） */
export function listAccounts(): AccountList;
/** 添加/覆盖账户（同 host+account 覆盖）；返回刷新掩码视图 */
export function upsertAccount(body: AccountBody): AccountList;
/** 删除账户（不存在 → ServiceError('INVALID_QUERY', '账户不存在：…')）；返回刷新掩码视图 */
export function deleteAccount(body: AccountDeleteBody): AccountList;
```

- index.ts 追加：`export { deleteAccount, listAccounts, upsertAccount } from './auth';`

- [ ] **Step 1: 写失败测试**（REBASED_CONFIG_DIR 隔离手法沿用）：
  - 空列表 → `{accounts: []}`；upsert → 掩码视图（`tokenPreview` 形如 `ghp_***`，完整 token 不在响应任何字段中——断言 JSON.stringify 不含原 token）；同 host+account 再 upsert → 覆盖而非重复；delete → 移除；delete 不存在 → INVALID_QUERY。
  - config-store 权限：saveConfig 后 POSIX 下 `fs.statSync(path).mode & 0o777 === 0o600`（Windows 跳过该断言——`process.platform` 条件）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): 账户/令牌存储与配置文件 0600 加固"`

---

### Task 3: 两端路由 —— auth 端点（应用级，无 repoId）

**Files:**
- Create: `apps/web-next/app/api/auth/accounts/route.ts`（GET+POST）、`apps/web-next/app/api/auth/accounts/delete/route.ts`（POST）
- Modify: `apps/web-koa/src/routes/repos.ts`（3 注册——文件内追加；若文件已臃肿可按既有 import 结构在 repos.ts 追加即可，不新建文件）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 2 api 出口；注意本域端点**无 repoId**——不需要 resolveRepo，三件套退化为「zod 校验 → 调 api → 错误映射」。
- Produces（HTTP 形状）：`GET /api/auth/accounts` → `200 AccountList`；`POST /api/auth/accounts`（accountBodySchema）→ `200 AccountList`；`POST /api/auth/accounts/delete`（accountDeleteBodySchema）→ `200 AccountList`；zod 拒绝/INVALID_QUERY → 400。

- [ ] **Step 1: 写失败测试** —— 两端各：GET 空列表；POST 添加 → 掩码视图且响应不含原 token；重复添加同 host+account → 覆盖（列表长度 1）；POST delete → 移除；zod 反例（空 token）→ 400；delete 不存在 → 400。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): auth 账户端点两端对称落地"`

---

### Task 4: client —— auth hooks

**Files:**
- Create: `packages/client/client/src/auth.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/auth.test.ts`

**Interfaces:**
- Produces:

```ts
/** 账户列表：GET /api/auth/accounts（应用级，无 repoId） */
export function useAccounts(): SWRResponse<AccountList>;
/** 添加/覆盖账户（mutation）：POST /api/auth/accounts，同键纪律（revalidate:false + 显式回写） */
export function useUpsertAccount(): { trigger: (body: AccountBody) => Promise<AccountList>; isMutating: boolean };
/** 删除账户（mutation）：POST /api/auth/accounts/delete，响应回写 useAccounts 缓存键（跨键回写约定） */
export function useDeleteAccount(): { trigger: (body: AccountDeleteBody) => Promise<AccountList>; isMutating: boolean };
```

- [ ] **Step 1: 写失败测试**（mock fetch + freshCache + 共挂载观测 + 恰好 1 次 GET 守卫）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): auth hooks"`

---

### Task 5: ui —— SettingsPage 账户卡片

**Files:**
- Modify: `packages/client/ui/src/composite/settings-page.tsx`（追加第三张 Card）
- Test: `packages/client/ui/src/composite/settings-page.test.tsx`（追加）

**Interfaces:**
- Produces（SettingsPageProps 追加可选字段，缺省不渲染该卡片，向后兼容）：

```ts
/** SettingsPageProps 追加：
 *  accounts?: AccountList
 *  onAddAccount?: (body: AccountBody) => void   // 添加成功/失败反馈由容器负责
 *  onDeleteAccount?: (body: AccountDeleteBody) => void
 */
```

**实现要点：**
- 「账户」Card：列表（host + account + tokenPreview + 删除 Popconfirm）；「添加账户」按钮开 Modal（host Input + account Input + token Input.Password + 确定，三字段空禁用）；删除走 Popconfirm。
- 空 message 风格与既有卡片一致；Modal 关闭复位（BranchPanel 教训）。

- [ ] **Step 1: 写失败测试**：缺省 props 不渲染卡片（向后兼容）；渲染账户行；添加 Modal 提交载荷 `{host, account, token}`；删除经确认回调 `{host, account}`。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): SettingsPage 账户管理卡片"`

---

### Task 6: 页面装配 —— 两端 settings 页注入账户

**Files:**
- Modify: `apps/web-next/app/repos/[repoId]/settings/page.tsx`、`apps/web-koa/src/pages/settings.tsx`
- Test: 容器以 typecheck + 冒烟兜底

**Interfaces:**
- Consumes: Task 4 hooks + Task 5 SettingsPage 新 props。
- 容器：追加 `useAccounts()` + `useUpsertAccount()` + `useDeleteAccount()` → 传入 SettingsPage；失败 `message.error`；成功 `message.success`。

- [ ] **Step 1–4**: 装配 + `pnpm typecheck && pnpm format && pnpm test` 全量绿。
- [ ] **Step 5: 冒烟 + 提交** —— 冒烟（web-next 用 `next dev --webpack`）：settings 页添加账户 → 重进页面确认持久化（配置文件复核：0600 权限 + token 落盘、响应不含原 token）→ 删除；`git commit -m "feat(apps): settings 页账户管理两端接线"`

---

## 自审记录

- Spec 覆盖：§4.2 auth 行的"token 存储（供 github/gitlab 复用）"✓ 本期落地；"HTTPS 认证对话框 + credential helper"明确后置 P3（无可达场景时造代码是死代码，P2-C 终审的 detach 端点教训——无 UI 入口的端点是测试才能到达的死路，本期账户端点有 SettingsPage 真实消费）。
- 类型一致性：AccountEntry/AccountList/AccountBody/AccountDeleteBody/三个 hook/SettingsPageProps 追加 跨任务签名已对齐。
- 风险：token 明文落盘——0600 + 本地优先场景可接受，已在安全约束中明示；Windows chmod 语义差异尽力而为。
- 端点无 repoId 属有意设计（账户是应用级资源），三件套退化为两件套已在 Task 3 注明。


---

## 关账记录（2026-09-03）

6/6 任务完成并通过逐任务审查；全分支终审结论 **Ready to merge: Yes**（无 Critical/Important；13 项 deferred minor 全部 safe-to-defer），正式关账。**至此 P2 阶段 12/12 功能域全部落地。**

**终审亮点**：安全核心经逐路径核实——单出口掩码设计（toView 唯一出口）使泄露难以重新引入，且有三个独立层级（api 单测 + 两端 HTTP）的 `JSON.stringify 不含原 token` 断言锁定；0600 每次保存自愈旧权限；auth 簿记全同步读写、不触 P2-G 修复的 await 窗口竞态类；本期端点全部有真实 UI 消费方（对照 P2-C detach 死端点教训）。

**Rulings / 采纳**：
1. 本期范围裁定为可验证子集（令牌存储 + 管理 UI）；HTTPS 对话框 + credential helper 桥接后置 P3 remote——终审认可该论证。
2. 终审建议采纳：P3 remote 计划第一件事=host 规范化约定（github.com vs https://github.com vs 大小写，防"存了查不到"）；P3 落地真实消费后补端到端泄露断言；merge.test.ts 偶发超时升级为正式观察项（两例目击）；`writeFileSync {mode:0o600}` 双保险并入 hardening ⑯。
3. 掩码前 4 位对短 token 暴露比例高（理论性，真实 token 20+ 字符）——长度比例规则入 hardening ⑱。

SDD 工作区已按规程删除，本提交为记录。