# P3-E：GitHub 面板（PR 全流程）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 GitHubPanel（PR 列表/详情/时间线/评论/审查/文件 diff 预览/三种合并策略/检出），入口为 LogPage「更多」菜单（检测到 GitHub 远程才渲染，对齐 Java `GHPRToolWindowFactory` 语义）。全部 HTTP 数据面走 GitHub REST API（服务端 fetch，token 经既有 accounts 存储注入），git 面（PR 检出）走既有 core 原语。

**Architecture:** 沿用既有分层与两端对称路由。`api/github.ts` 服务：检测（remote URL 解析 github.com 形态 + accounts 查 token）→ REST 调用（mock 可测）与 `git fetch refs/pull/N/head` + `checkoutNewBranch`（git 面与数据面解耦：检出不依赖 URL 判定，取当前仓库 origin/首个 remote，真实 git 可测）；client hooks + `composite/GitHubPanel`；页面 `/repos/:id/github`。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md` §4.2 github 行（`github-core`：accounts/pullrequest/ui、`GithubCreateGistDialog`）；审计报告 C.26（功能点级：账户/token 认证 🟡、克隆/分享 ❌、PR 列表/详情/时间线/评论 ❌、审查/diff/合并/AI 描述 ❌、Gist ❌；注：Java 侧 Issues/通知无 UI 不覆盖）；D.3.5 导航边 #97-#101（列表→详情、详情→diff、时间线回跳、4 入口登录、Share Project）与 #90（Git 菜单 View Pull Requests→GitHubPanel）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：core/api 夹具无首提交、预置身份、默认分支名 `git symbolic-ref HEAD --short`；裸仓库+clone 远程装置（PR 检出用）；**绝不依赖真实 GitHub 网络**——数据面测试 mock global fetch（`vi.stubGlobal`），头像/URL 断言避免签名差异。
- 错误语义（复用既有 12 错误码，不新增）：GitHub API 401/403 → `ServiceError('AUTH_FAILED', 'GitHub 认证失败：<msg>')`（403 且消息含 rate limit → `RATE_LIMITED`）；429 或 `X-RateLimit` 命中 → `RATE_LIMITED`；404 → `INVALID_REF`（'PR 不存在或无权访问：<msg>'）；其它 4xx/5xx 与网络错误 → `GIT_ERROR`（'GitHub API 请求失败：<status> <msg>'）；仓库无 GitHub 远程（检测端点除外）→ `INVALID_QUERY`。
- **安全约束**：token 仅经 config-store accounts（`findToken('github.com')`），HTTP 头注入，**不得**出现在任何日志/错误消息/console 记录中（console 只记 git args——已剥离）；响应绝不下发 token（status 端点只给 `account` 与 `tokenMasked`）。测试锁定「错误消息与响应体不含 token 文本」。
- GitHubPanel 显示条件：检测到 `https://github.com/{owner}/{repo}` 或 `git@github.com:{owner}/{repo}.git` 形态的 remote URL（`parseGithubRemoteUrl` 纯函数，contracts 或 core——T2 定）且存在 `findToken('github.com')`；两者缺一 → 页面显示提示卡（无远程文案 / 去 Settings 配置令牌），不报错。
- PR 检出语义：`checkoutNewBranch('pr-N', 'FETCH_HEAD')`（refspec `+refs/pull/N/head`）；本地分支已存在 → 仅 `checkoutBranch('pr-N')`；成功后回写 status 键与 branches 键（客户端）。
- 时间线顺序：旧→新（Java 时间线惯例，评论流自上而下）；`kind: 'comment' | 'review'`（issue comments 与 review summaries 合并排序）。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/github/status                    → GitHubStatus
GET  /api/repos/:repoId/github/prs?state=open|closed|all → GitHubPrList
GET  /api/repos/:repoId/github/prs/:number               → GitHubPrDetail
GET  /api/repos/:repoId/github/prs/:number/timeline      → GitHubTimeline
POST /api/repos/:repoId/github/prs/:number/comments      {body} → GitHubTimeline
GET  /api/repos/:repoId/github/prs/:number/files         → GitHubPrFiles
POST /api/repos/:repoId/github/prs/:number/review        {event, body?} → GitHubPrDetail
POST /api/repos/:repoId/github/prs/:number/merge         {method} → GitHubPrMergeResult
POST /api/repos/:repoId/github/prs/:number/checkout      → GitHubPrCheckoutResult
```

## 明确不做

- GitHub 专属登录流（OAuth/device flow）：v1 用 Settings 账户卡片手动录入 PAT（已落地），`findToken('github.com')` 即用。
- Gist 创建（`GithubCreateGistDialog`）：独立对话框域，P3-E 后置。
- 克隆 GitHub 仓库 / Share Project on GitHub：`cloneRepo` 无端点无 UI（服务层能力后置）；分享 = 既有 remote+push 组合，后置。
- AI 描述生成（需外部 AI 服务与密钥，超 v1）。
- GitHub Enterprise（非 `api.github.com`/`github.com` 形态一律"未检测到"）。
- Issues/通知：Java 侧无用户可见 UI，不覆盖。
- PR 文件行内评论（inline review comments 提交）：v1 只做整体 review（APPROVE/REQUEST_CHANGES/COMMENT）+ issue comment；行内评论后置。
- PR diff 的结构化渲染（Java `GHPRDiffVirtualFile`）：v1 文件列表 + 每文件 patch 文本只读预览（Monospace 块）。

---

### Task 1: contracts —— GitHub 域契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
export interface GitHubRepoRef { owner: string; name: string; remoteUrl: string; }
export interface GitHubStatus { detected: boolean; repo?: GitHubRepoRef; account?: string; }
export interface GitHubPrSummary { number: number; title: string; author: string; state: 'open' | 'closed'; merged: boolean; baseRef: string; headRef: string; createdAtIso: string; updatedAtIso: string; }
export interface GitHubPrList { prs: GitHubPrSummary[]; }
export interface GitHubPrDetail extends GitHubPrSummary { body: string; mergeable: boolean; reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE'; commentsCount: number; additions: number; deletions: number; }
export interface GitHubTimelineEntry { id: number; author: string; atIso: string; body: string; kind: 'comment' | 'review'; reviewState?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; }
export interface GitHubTimeline { entries: GitHubTimelineEntry[]; }
export interface GitHubPrFile { path: string; status: 'added' | 'modified' | 'removed' | 'renamed'; additions: number; deletions: number; patch: string; }
export interface GitHubPrFiles { files: GitHubPrFile[]; }
export interface GitHubPrMergeResult { merged: boolean; message: string; }
export interface GitHubPrCheckoutResult { branchName: string; }
```

```ts
// endpoints.ts 追加
export const githubPrQuerySchema = z.object({ state: z.enum(['open', 'closed', 'all']).default('open') });
export const githubPrNumberSchema = z.object({ number: z.coerce.number().int().positive() });
export const githubCommentBodySchema = z.object({ body: z.string().min(1).max(10_000) });
export const githubReviewBodySchema = z.object({ event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']), body: z.string().max(10_000).optional() });
export const githubMergeBodySchema = z.object({ method: z.enum(['merge', 'squash', 'rebase']) });
```

- [ ] **Step 1: 写失败测试** —— 各 schema 正反例（state 非法值、number 非正整数/0、body 空/超 10k、event 非法、method 非法；detail 继承 summary 的 Omit 关系）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): GitHub PR 域契约"`

---

### Task 2: api —— github 服务（REST + git 面）

**Files:**
- Create: `packages/server/api/src/github.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/github.test.ts`
- （如 core `fetchRemote` 缺 refspec 参数则最小扩展 `packages/server/core/src/remote.ts` + 其测试——先读现状再定，能用就不动 core）

**Interfaces:**
- Produces:

```ts
// github.ts
export function parseGithubRemoteUrl(url: string): GitHubRepoRef | null; // 纯函数：https://github.com/{o}/{r}[.git] | git@github.com:{o}/{r}.git
export function getGithubStatus(repoPath: string): Promise<GitHubStatus>; // getRemotes→parse；findToken('github.com')；account=config 中 host 匹配项账户名
export function getGithubPrs(repoPath: string, state: 'open'|'closed'|'all'): Promise<GitHubPrList>;
export function getGithubPrDetail(repoPath: string, number: number): Promise<GitHubPrDetail>;
export function getGithubPrTimeline(repoPath: string, number: number): Promise<GitHubTimeline>; // issues/{n}/comments + pulls/{n}/reviews 合并、旧→新
export function addGithubPrComment(repoPath: string, number: number, body: string): Promise<GitHubTimeline>;
export function getGithubPrFiles(repoPath: string, number: number): Promise<GitHubPrFiles>; // files[].patch 可空 → ''
export function submitGithubPrReview(repoPath: string, number: number, body: GitHubReviewBody): Promise<GitHubPrDetail>; // POST /pulls/{n}/reviews {event, body}
export function mergeGithubPr(repoPath: string, number: number, body: GitHubMergeBody): Promise<GitHubPrMergeResult>; // POST /pulls/{n}/merge {merge_method}
export function checkoutGithubPr(repoPath: string, number: number): Promise<GitHubPrCheckoutResult>; // 首个 remote refspec fetch + checkoutNewBranch('pr-N','FETCH_HEAD')；已存在→仅 checkout
```

**控制器裁定（遵守）：**
1. `githubRequest` 内部 helper：`fetch('https://api.github.com/repos/${owner}/${name}${path}', { headers })`；headers 含 `Authorization: Bearer <token>`、`Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`、`User-Agent: rebasedjs`；全部错误映射按 Global Constraints；**错误消息/响应体绝不带 token**。
2. **git 面与数据面解耦**：checkout 不解析 URL——直接取 `getRemotes` 的 origin（无 origin 取第一个；无 remote → INVALID_QUERY '未检测到远程'），`core.fetchRemote`（refspec `+refs/pull/N/head`；若现有签名不支持 refspec 则最小扩展并在报告说明）→ `checkoutNewBranch('pr-N', 'FETCH_HEAD')`；`FETCH_HEAD` 不可用或分支已存在 → 仅 `checkoutBranch('pr-N')`；fetch 失败 → GIT_ERROR（消息中文，首行 stderr）。
3. 检测/数据面（status/prs/detail/timeline/comments/files/review/merge）：先 `resolveGithubRepo`（getRemotes → 逐项 parseGithubRemoteUrl；无 → INVALID_QUERY '仓库未检测到 GitHub 远程'），token = findToken('github.com')（无 → AUTH_FAILED '未配置 GitHub 令牌，请在设置中添加'）。
4. `getGithubStatus` 不抛错：无远程 → `{detected:false}`；有远程无令牌 → `{detected:true, repo, account: undefined}`；有令牌 → `{detected:true, repo, account}`。
5. 时间线映射：issue comment → `{kind:'comment'}`；review → `{kind:'review', reviewState: state==='APPROVED'?'APPROVED': state==='CHANGES_REQUESTED'?'CHANGES_REQUESTED':'COMMENTED'}`；两者按 `created_at` 升序合并；`id` 用各自 API id（数字冲突时 review id 加前缀移位——以 `id: number` 唯一需要求处理，注释说明）。
6. 测试：`vi.stubGlobal('fetch', ...)` mock（断言 URL/headers/body 精确值、错误映射 401/403/404/429/网络异常、token 不下发）；真实临时仓库 + 裸仓库装置测 checkout（origin=本地裸仓库，含 `refs/pull/7/head`）；检测用例（github URL 形态解析 + 非 github 形态 → detected false）；无远程 → INVALID_QUERY；无令牌 → AUTH_FAILED；**断言 mock 调用记录与响应体中不含 token 文本**。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): GitHub PR 服务（REST+检出）"`

---

### Task 3: 两端路由 —— GitHub 域端点（9 端点）

**Files:**
- Create: web-next 9 个 route.ts（`[repoId]/github/status`、`github/prs`、`github/prs/[number]`、`.../timeline`、`.../comments`、`.../files`、`.../review`、`.../merge`、`.../checkout`）
- Modify: `apps/web-koa/src/routes/repos.ts`（9 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 2 api 出口。
- Produces（HTTP 形状）：按端点总览；zod 拒绝 → 400（`githubPrNumberSchema` 校验路径参数；`state` 非法 → 400）；AUTH_FAILED → 401；RATE_LIMITED → 429；其余映射沿用 `httpStatusFor`。
- [ ] **Step 1: 写失败测试** —— 两端各：status（有/无远程、有/无令牌三态）；prs 列表（state 透传）；detail/timeline/files（mock fetch）；comments/review/merge 提交载荷与回包；checkout（真实裸仓库 + clone，pr-N 分支建立并检出）；zod 反例（state/`number=0`/非法 event/method）；404。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): GitHub 域端点两端对称落地"`

---

### Task 4: client —— GitHub hooks

**Files:**
- Create: `packages/client/client/src/github.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/github.test.ts`

**Interfaces:**
- Produces:

```ts
export function useGithubStatus(repoId: string): SWRResponse<GitHubStatus>;
export function useGithubPrs(repoId: string, state: 'open'|'closed'|'all'): SWRResponse<GitHubPrList>;
export function useGithubPrDetail(repoId: string, number: number | null): SWRResponse<GitHubPrDetail | null>; // null → 不请求
export function useGithubTimeline(repoId: string, number: number | null): SWRResponse<GitHubTimeline | null>;
export function useGithubPrFiles(repoId: string, number: number | null): SWRResponse<GitHubPrFiles | null>;
export function useAddGithubComment(repoId: string, number: number): mutation;   // 回写 timeline 键
export function useSubmitGithubReview(repoId: string, number: number): mutation; // 回写 detail 键（reviewDecision 变化）
export function useMergeGithubPr(repoId: string, number: number): mutation;      // 回写 prs 键 + detail 键
export function useCheckoutGithubPr(repoId: string, number: number): mutation;   // 回写 status 键 + branches 键（跨键）
```

- [ ] **Step 1: 写失败测试**（mock fetch/freshCache：查询、mutation 载荷与 JSON body、1-GET 守卫、共挂载、**mutation 回写断言**——comments/timeline、review/detail、merge/prs+detail、checkout/status+branches 跨键回写均 `{revalidate:false}` 显式 mutate）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): GitHub PR hooks"`

---

### Task 5: ui —— GitHubPanel

**Files:**
- Create: `packages/client/ui/src/composite/github-panel.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: `packages/client/ui/src/github-panel.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** GitHub 面板：左列表（number/title/author/state 徽标/更新时间）+ 右详情（标题/主体/元信息/reviewDecision 徽标/增删行统计）+ tabs（时间线 | 文件）+ 操作区（评论、Approve、Request changes、合并 Modal、检出、刷新） */
export interface GitHubPanelProps {
  status: GitHubStatus;
  prs: GitHubPrList; number: number | null;
  detail: GitHubPrDetail | null; timeline: GitHubTimeline | null; files: GitHubPrFiles | null;
  loading?: boolean; acting?: boolean;
  onSelectPr: (number: number) => void; onRefresh: () => void;
  onComment: (body: string) => void; onReview: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) => void;
  onMerge: (method: 'merge' | 'squash' | 'rebase') => void; onCheckout: () => void;
}
export function GitHubPanel(props: GitHubPanelProps): React.ReactNode;
```

**控制器裁定（遵守）：**
1. 检测未通过（status.detected===false 或无账户）时渲染提示卡（「未检测到 GitHub 远程」/「未配置 GitHub 令牌，请在设置中添加」），不渲染列表。
2. 时间线条目渲染：author + 时间（formatCommitDate）+ kind 徽标（comment/review+state）+ body（保留换行的 pre-wrap）；文件 tab：path/status 徽标/增删行 + 展开 patch 文本（Monospace `<pre>`，只读）。
3. 合并 Modal：三方法 Radio（merge/squash/rebase，默认 merge）+ 文案说明；确认调 onMerge。
4. 评论/审查：上下文中一个输入框 + 「发送评论」；顶部「Approve」「Request changes」按钮（带确认 Popconfirm，REQUEST_CHANGES 可带 body——用同一输入框内容）；acting 时禁用。
5. 检出按钮：「检出 PR 分支」→ onCheckout；成功后由容器接管（跨键刷新）。
6. 空态：无 PR（当前 state 筛选）中文空态；列表选中态；双击/单击均 onSelectPr（单击即可，对齐 Java 双击——**裁定单击选中**，简单一致）。

- [ ] **Step 1: 写失败测试**（提示卡两态、列表、详情元信息、时间线两种 kind、文件 patch 展开、合并三方法载荷、review/评论回调、检出回调、空态、acting 禁用）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): GitHubPanel"`

---

### Task 6: 页面装配 —— 两端 GitHub 页 + LogPage 入口

**Files:**
- Create: web-next `app/repos/[repoId]/github/page.tsx`、web-koa `src/pages/github.tsx`
- Modify: `apps/web-koa/src/main.tsx`（1 Route）、`packages/client/ui/src/composite/log-page.tsx`（追加 `onOpenGithub?` 与 `githubAvailable?` 可选 props，缺省不渲染）、`apps/web-next/app/repos/[repoId]/page.tsx`、`apps/web-koa/src/pages/repo.tsx`（注入：useGithubStatus → githubAvailable + onOpenGithub 导航）、`packages/client/ui/src/composite/log-page.test.tsx`（追加）
- Test: 页面渲染冒烟 + log-page 用例

**Interfaces:**
- Consumes: Task 4 hooks + Task 5 组件。
- Produces：路由 `/repos/:repoId/github`（两端）；LogPage「更多」菜单项（`githubAvailable` 时才渲染）；GitHub 页容器：useGithubStatus（检测/提示卡）、useGithubPrs(state 切 Tab open/closed)、useGithubPrDetail/Timeline/Files（选中 PR 后）、四个 mutation 接线（评论→回写 timeline、review→回写 detail、merge→回写 prs+detail 并刷新、checkout→跨键 status/branches 刷新）、刷新按钮。

**控制器裁定（遵守）：**
1. LogPage 新 props：`onOpenGithub?: () => void`、`githubAvailable?: boolean`；两者都有效时才渲染「GitHub 面板」菜单项（对齐 Java「检测到 GitHub 远程才显示工具窗口」）。
2. 页面状态：prs 加载失败（AUTH_FAILED）→ 显示「GitHub 认证失败」提示卡 + 去 Settings 链接；RATE_LIMITED → 提示稍后重试；其余沿用 handleApiError toast。
3. 冒烟（命令序列写报告）：web-next build（含 github 路由）+ web-koa build；四态页面渲染（无远程/无令牌/有远程有令牌但 mock 数据——**页面冒烟以 build+typecheck+组件测试为准**，真实 GitHub 数据面不依赖网络）；checkout 全链路（本地裸仓库装置，git CLI 复核 pr-7 分支存在且检出）。

- [ ] **Step 1: 写失败测试**（log-page 新入口：注入渲染、githubAvailable=false 不渲染）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `git commit -m "feat(apps): GitHub 页面两端落地与 LogPage 入口"`

---

### Task 7: 全分支终审（合约任务，无独立实现）

- [ ] 终审包（MERGE_BASE..HEAD）→ 最严 reviewer → findings → ONE fix wave → 限定复审 → 关账记录（计划文件尾）→ 删 SDD 工作区。
- [ ] 关账 commit `docs: P3-E 关账记录（…）`；审计报告增补 P3-E 进度。

---

## 自审记录

- Spec 覆盖：§4.2 github 行全功能点映射——账户/token 认证：🟡→✅（PAT 手动录入 + findToken 复用；专属登录流明确不做）；克隆/分享：明确不做（cloneRepo 服务层能力后置，边 #101 记录）；PR 列表/详情/时间线/评论：✅；审查（approve/request changes）/diff 视图（patch 文本预览）/三种合并策略：✅；AI 描述：明确不做；Gist：明确不做（边 #100 部分覆盖——登录入口为 Settings 账户卡片既有流）。
- 类型一致性：GitHub{Status,RepoRef,PrSummary,PrDetail,Timeline,TimelineEntry,PrFile,PrFiles,PrMergeResult,PrCheckoutResult} + 5 schema 跨任务签名对齐；错误码复用既有 12 码不新增（AUTH_FAILED/RATE_LIMITED/INVALID_REF/INVALID_QUERY/GIT_ERROR）。
- 简化裁定：checkout 与数据面解耦（不解析 URL，取 origin/首个远程——测试可离线）；list→详情用单击选中；diff 视图=patch 文本预览；时间线=issue comments+reviews 合并。
- 风险：GitHub REST 形状随版本演进（pin `2022-11-28` + 测试不依赖真实网络——mock 断言避开易变字段）；大仓库 files 接口 patch 可能被服务端截断（v1 按返回原样展示，注明）。
