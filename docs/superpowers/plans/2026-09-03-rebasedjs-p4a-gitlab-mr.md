# P4-A：GitLab 面板（MR 全流程）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 GitLabPanel（MR 列表/详情/时间线/评论/审查/文件 diff 预览/合并/MR 创建/检出），入口为 LogPage「更多」菜单（检测到 gitlab.com 远程才渲染，与 P3-E GitHub 面板同模式）。数据面走 GitLab REST API v4（服务端 fetch，token 经既有 accounts 存储 `findToken('gitlab.com')`），git 面（MR 检出）走 core 原语。整体以 P3-E（github）为模板：同构结构、同错误映射、同测试纪律。

**Architecture:** 沿用分层与两端对称路由。`api/gitlab.ts`：检测（remote URL 解析 gitlab.com 形态——owner 可含子组 `group/sub/repo` + 账户 token）→ REST（`https://gitlab.com/api/v4`，mock 可测）与 `git fetch refs/merge-requests/:iid/head` + `checkoutNewBranch('mr-iid','FETCH_HEAD')`（git 面与数据面解耦，取 origin/首个远程，真实 git 可测）；client hooks + `composite/GitLabPanel`；页面 `/repos/:id/gitlab`。

**Tech Stack:** TypeScript、React 19、antd 6、SWR、vitest、Next.js 16、Koa、zod。

**Spec:** 架构 spec §4.2 gitlab 行（`gitlab-core`：mergerequest、snippets、ui\review——MR 全流程、Snippet）；审计报告 C.27（功能点：账户认证、MR 创建/列表/详情/diff/评论、MR 审查/合并、Snippet 创建）；D.3.5 边 #90（Git 菜单 Show Merge Requests → GitLabPanel）、#100（登录入口）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc、文件头职责、重要方法注释算法思路。
- 分层边界：`api`/`core` 禁框架 import；`ui` 纯 props 驱动；互调只走各包 `index.ts`。
- 路由三件套：zod 校验 → `resolveRepo` → 调 api → `handleApiError`；两端端点完全对称。
- 每个任务完成后质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 测试夹具事实：core/api 夹具无首提交、预置身份、默认分支名 `git symbolic-ref HEAD --short`；裸仓库+clone 远程装置（MR 检出用）；**绝不依赖真实 GitLab 网络**——数据面测试 mock global fetch（`vi.stubGlobal`）。
- 错误语义（复用既有 12 错误码，不新增）：GitLab API 401/403 → `AUTH_FAILED`（403 且消息含 rate limit → `RATE_LIMITED`）；404 → `INVALID_REF`（'MR 不存在或无权访问：<msg>'）；429/速率命中 → `RATE_LIMITED`；其它 4xx/5xx 与网络错误 → `GIT_ERROR`（'GitLab API 请求失败：<status> <msg>'）；无 GitLab 远程（检测端点除外）→ `INVALID_QUERY`。
- **安全约束**：token 仅经 `findToken('gitlab.com')` 注入 HTTP 头（`PRIVATE-TOKEN: <token>`——GitLab 用 header 而非 Bearer）；绝不出现在日志/错误消息/响应；测试锁定「错误消息与响应体不含 token 文本」。
- GitLabPanel 显示条件：检测到 `https://gitlab.com/{owner[/subgroup]}/{repo}` 或 `git@gitlab.com:{owner[/subgroup]}/{repo}.git` 形态远程（`parseGitlabRemoteUrl` 纯函数）且存在 `findToken('gitlab.com')`；缺一 → 页面提示卡（无远程 / 去 Settings 配置令牌），不报错。
- GitLab REST 形态：base `https://gitlab.com/api/v4`；project id = `encodeURIComponent('group/sub/repo')`（子组嵌套全路径）；MR 用 **iid**（非项目内全局 id）；headers：`PRIVATE-TOKEN`、`Accept: application/json`、`User-Agent: rebasedjs`。
- MR 检出语义：`fetchRemote(refspec 'refs/merge-requests/:iid/head')` → `checkoutNewBranch('mr-iid','FETCH_HEAD')`；已存在仅 checkout；成功后跨键回写 status/branches（客户端）。
- 时间线顺序：旧→新；`kind: 'comment' | 'review'`（notes 与 reviews 合并排序——GitLab reviews 列表可能不可用，v1 以 notes 为准、reviews 尽力合并，注释说明）。
- MR 审查映射：APPROVE → `POST .../approve`；REQUEST_CHANGES → `POST .../reviews`（`{state:'rejected'}`）；COMMENT → `POST .../notes`（body 必需）。返回 detail（approve/reviews 后重查 MR）。
- MR 合并：`PUT .../merge` 载荷 `{squash?}`（GitLab 合并策略为项目设置，无 merge_method 参数；squash 为客户端可选布尔）。

## 端点总览（本计划新增，两端对称）

```text
GET  /api/repos/:repoId/gitlab/status                    → GitLabStatus
GET  /api/repos/:repoId/gitlab/mrs?state=                → GitLabMrList
POST /api/repos/:repoId/gitlab/mrs                       {sourceBranch,targetBranch,title,description?} → GitLabMrDetail
GET  /api/repos/:repoId/gitlab/mrs/:iid                  → GitLabMrDetail
GET  /api/repos/:repoId/gitlab/mrs/:iid/timeline         → GitLabTimeline
POST /api/repos/:repoId/gitlab/mrs/:iid/comments         {body} → GitLabTimeline
GET  /api/repos/:repoId/gitlab/mrs/:iid/files            → GitLabMrFiles
POST /api/repos/:repoId/gitlab/mrs/:iid/review           {event, body?} → GitLabMrDetail
POST /api/repos/:repoId/gitlab/mrs/:iid/merge            {squash?} → GitLabMrMergeResult
POST /api/repos/:repoId/gitlab/mrs/:iid/checkout         → GitLabMrCheckoutResult
```

## 明确不做

- GitLab 专属登录流（OAuth/device）：v1 用 Settings 账户卡片手动录入 PAT（`PAT-`/`glpat-` 前缀随意，`findToken('gitlab.com')` 即用）。
- Snippet 创建（`GitlabCreateSnippetDialog` 对应域）：独立对话框，P4 后置。
- 自托管 GitLab 实例（非 `gitlab.com` 形态一律"未检测到"——Enterprise 后置）。
- AI 描述、MR 行内评论（inline discussion 提交）、MR 合并冲突处理（合并冲突走既有 git 冲突机制，不做 API 层冲突自解）。
- 结构化 diff 渲染（Java `GitLabMergeRequestDiffVirtualFile` 等效）：v1 文件列表 + 每文件 diff 文本只读预览。
- GitLab 的 Issues/Epics/Boards：Java 侧无用户可见 UI（本插件包仅 mergerequest/snippets），不覆盖。

---

### Task 1: contracts —— GitLab 域契约

**Files:**
- Modify: `packages/server/contracts/src/domain.ts`、`packages/server/contracts/src/endpoints.ts`
- Test: `packages/server/contracts/src/endpoints.test.ts`（追加）

**Interfaces:**
- Produces:

```ts
// domain.ts 追加
export interface GitLabRepoRef { owner: string; name: string; remoteUrl: string; } // owner 可含子组（group/sub）
export interface GitLabStatus { detected: boolean; repo?: GitLabRepoRef; account?: string; }
export interface GitLabMrSummary { iid: number; title: string; author: string; state: 'opened' | 'closed' | 'merged' | 'locked'; sourceBranch: string; targetBranch: string; createdAtIso: string; updatedAtIso: string; }
export interface GitLabMrList { mrs: GitLabMrSummary[]; }
export interface GitLabMrDetail extends GitLabMrSummary { body: string; mergeable: boolean; reviewState: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | 'NONE'; commentsCount: number; additions: number; deletions: number; }
export interface GitLabTimelineEntry { id: number; author: string; atIso: string; body: string; kind: 'comment' | 'review'; reviewState?: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; }
export interface GitLabTimeline { entries: GitLabTimelineEntry[]; }
export interface GitLabMrFile { path: string; status: 'added' | 'modified' | 'removed' | 'renamed'; additions: number; deletions: number; diff: string; }
export interface GitLabMrFiles { files: GitLabMrFile[]; }
export interface GitLabMrMergeResult { merged: boolean; message: string; }
export interface GitLabMrCheckoutResult { branchName: string; }
```

```ts
// endpoints.ts 追加
export const gitlabMrQuerySchema = z.object({ state: z.enum(['opened', 'closed', 'merged', 'locked', 'all']).default('opened') });
export const gitlabMrIidSchema = z.object({ iid: z.coerce.number().int().positive() });
export const gitlabMrCreateBodySchema = z.object({ sourceBranch: z.string().min(1), targetBranch: z.string().min(1), title: z.string().min(1).max(255), description: z.string().max(20_000).optional() });
export const gitlabCommentBodySchema = z.object({ body: z.string().min(1).max(10_000) });
export const gitlabReviewBodySchema = z.object({ event: z.enum(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']), body: z.string().max(10_000).optional() });
export const gitlabMergeBodySchema = z.object({ squash: z.boolean().optional() });
```

- [ ] **Step 1: 写失败测试** —— 各 schema 正反例（state 非法、iid 非正整数/0、create 缺 sourceBranch/targetBranch/title、title 超 255、comment body 空/超 10k、review event 非法、merge squash 类型）；MrDetail extends Summary。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/contracts test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(contracts): GitLab MR 域契约"`

---

### Task 2: api —— gitlab 服务（REST + git 面）

**Files:**
- Create: `packages/server/api/src/gitlab.ts`
- Modify: `packages/server/api/src/index.ts`
- Test: `packages/server/api/src/gitlab.test.ts`
- （core 无需改动——`fetchRemote` refspec 已由 P3-E 扩展；`checkoutBranch/checkoutNewBranch` 既有）

**Interfaces:**
- Produces:

```ts
// gitlab.ts
export function parseGitlabRemoteUrl(url: string): GitLabRepoRef | null; // https://gitlab.com/{group[/sub]}/{repo}[.git] | git@gitlab.com:{group[/sub]}/{repo}.git；owner 多级
export function getGitlabStatus(repoPath: string): Promise<GitLabStatus>; // 三态不抛错（同 github）
export function getGitlabMrs(repoPath: string, state: GitLabMrQuery['state']): Promise<GitLabMrList>; // GET /projects/:id/merge_requests?state=
export function createGitlabMr(repoPath: string, body: GitLabMrCreateBody): Promise<GitLabMrDetail>; // POST .../merge_requests {source_branch,target_branch,title,description}
export function getGitlabMrDetail(repoPath: string, iid: number): Promise<GitLabMrDetail>;
export function getGitlabMrTimeline(repoPath: string, iid: number): Promise<GitLabTimeline>; // notes + reviews（reviews 尽力）
export function addGitlabMrComment(repoPath: string, iid: number, body: string): Promise<GitLabTimeline>;
export function getGitlabMrFiles(repoPath: string, iid: number): Promise<GitLabMrFiles>; // GET .../changes → changes[] 映射（diff 可空 → ''）
export function submitGitlabMrReview(repoPath: string, iid: number, body: GitLabReviewBody): Promise<GitLabMrDetail>; // 映射见 Global Constraints
export function mergeGitlabMr(repoPath: string, iid: number, body: GitLabMergeBody): Promise<GitLabMrMergeResult>; // PUT .../merge {squash}
export function checkoutGitlabMr(repoPath: string, iid: number): Promise<GitLabMrCheckoutResult>; // origin/首远程 refs/merge-requests/:iid/head + mr-iid 分支
```

**控制器裁定（遵守）：**
1. `gitlabRequest` helper：`fetch('https://gitlab.com/api/v4/projects/${encodeURIComponent(ownerFull)}${path}')`——ownerFull 含子组（`group/sub/repo` 全 path）；headers：`PRIVATE-TOKEN: <token>`、`Accept: application/json`、`User-Agent: rebasedjs`；错误映射按 Global Constraints；**token 绝不出现在任何消息/响应**。
2. 检测/数据面：先 `resolveGitlabRepo`（getRemotes → 逐项 parseGitlabRemoteUrl；无 → INVALID_QUERY '仓库未检测到 GitLab 远程'），token = findToken('gitlab.com')（无 → AUTH_FAILED '未配置 GitLab 令牌，请在设置中添加'）。`getGitlabStatus` 不抛错（同 github 三态）。
3. git 面解耦（同 github 裁定）：checkout 取 origin/首远程，refspec `refs/merge-requests/:iid/head`，已存在（`mr-iid` 分支）仅 checkout；fetch 失败 → GIT_ERROR（stderr 首行）；无远程 → INVALID_QUERY。
4. 时间线映射：note → `{kind:'comment', id: note.id}`；review → `{kind:'review', reviewState: state==='approved'?'APPROVED': state==='rejected'?'CHANGES_REQUESTED':'COMMENTED', id: 1e9 + review.id}`；升序合并。
5. files 映射：`changes[]` → `{path: new_path ?? old_path, status: new_file→'added'/deleted_file→'removed'/renamed_file→'renamed'/否则 'modified', additions: 0（GitLab changes 不逐文件给行数——v1 additions/deletions 置 0，注释说明；diff: change.diff ?? ''}`。
6. merge 映射：GitLab 合并失败（conflict/not mergeable 等）→ `{merged:false, message: <响应 message>}`（与 github merged 语义一致——**HTTP 层 200 但 merged 状态在响应体**；405/409 等 → 错误映射）。
7. 测试：mock fetch 断言 URL（`/api/v4/projects/${encodeURIComponent('g/s/repo')}/merge_requests` 等）、headers（PRIVATE-TOKEN）、错误映射 401/403/404/429/网络异常、token 不下发；checkout 真实裸仓库装置（`refs/merge-requests/7/head`）；检测用例（含子组路径、非 gitlab 域、本地路径）；MR create 载荷断言。

- [ ] **Step 1: 写失败测试**
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/api test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(api): GitLab MR 服务（REST+检出+创建）"`

---

### Task 3: 两端路由 —— GitLab 域端点（10 端点）

**Files:**
- Create: web-next 10 个 route.ts（`[repoId]/gitlab/status`、`gitlab/mrs` GET+POST、`gitlab/mrs/[iid]`、`.../timeline`、`.../comments`、`.../files`、`.../review`、`.../merge`、`.../checkout`）
- Modify: `apps/web-koa/src/routes/repos.ts`（10 注册）
- Test: `apps/web-next/src/routes.test.ts`、`apps/web-koa/src/app.test.ts`（各追加）

**Interfaces:**
- Consumes: Task 1 schemas + Task 2 api 出口。
- Produces（HTTP 形状）：按端点总览；zod 拒绝 → 400；AUTH_FAILED → 401；RATE_LIMITED → 429；其余沿用 `httpStatusFor`。
- [ ] **Step 1: 写失败测试** —— 两端各：status 三态；mrs 列表 state 透传；create 载荷与回包；detail/timeline/files（mock fetch）；comments/review/merge 载荷；checkout（真实裸仓库 `mr-7` 分支检出）；zod 反例（state 非法/`iid=0`/create 缺字段/event 非法）；404（全 10 端点 REPO_NOT_FOUND）。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 质量门 + 提交** `git commit -m "feat(apps): GitLab 域端点两端对称落地"`

---

### Task 4: client —— GitLab hooks

**Files:**
- Create: `packages/client/client/src/gitlab.ts`
- Modify: `packages/client/client/src/index.ts`
- Test: `packages/client/client/src/gitlab.test.ts`

**Interfaces:**
- Produces:

```ts
export function useGitlabStatus(repoId: string): SWRResponse<GitLabStatus>;
export function useGitlabMrs(repoId: string, state: GitLabMrQuery['state']): SWRResponse<GitLabMrList>;
export function useGitlabMrDetail(repoId: string, iid: number | null): SWRResponse<GitLabMrDetail | null>;
export function useGitlabTimeline(repoId: string, iid: number | null): SWRResponse<GitLabTimeline | null>;
export function useGitlabMrFiles(repoId: string, iid: number | null): SWRResponse<GitLabMrFiles | null>;
export function useCreateGitlabMr(repoId: string): mutation;   // 回写 mrs 键
export function useAddGitlabComment(repoId: string, iid: number): mutation;  // 回写 timeline 键
export function useSubmitGitlabReview(repoId: string, iid: number): mutation; // 回写 detail 键
export function useMergeGitlabMr(repoId: string, iid: number): mutation;     // 回写 mrs 键 + detail 键
export function useCheckoutGitlabMr(repoId: string, iid: number): mutation;  // 跨键 status/branches 裸 mutate
```

- [ ] **Step 1: 写失败测试**（mock fetch/freshCache：查询、mutation 载荷、1-GET 守卫、共挂载、mutation 回写断言——同 github 模板全复制）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/client test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(client): GitLab MR hooks"`

---

### Task 5: ui —— GitLabPanel

**Files:**
- Create: `packages/client/ui/src/composite/gitlab-panel.tsx`、`packages/client/ui/src/composite/gitlab-panel.test.tsx`
- Modify: `packages/client/ui/src/index.ts`
- Test: 对应 `.test.tsx`

**Interfaces:**
- Produces:

```tsx
/** GitLab 面板：MR 列表（iid/title/author/state 徽标）+ 详情（元信息/reviewState 徽标/增删行）+ tabs（时间线|文件）+ 操作（评论、Approve、Request changes、合并 Modal（squash Checkbox）、新建 MR Modal（源/目标分支选择+标题）、检出、刷新） */
export interface GitLabPanelProps {
  status: GitLabStatus; mrs: GitLabMrList; iid: number | null;
  detail: GitLabMrDetail | null; timeline: GitLabTimeline | null; files: GitLabMrFiles | null;
  branches: BranchRef[];
  loading?: boolean; acting?: boolean;
  onSelectMr: (iid: number) => void; onRefresh?: () => void;
  onCreateMr: (body: GitLabMrCreateBody) => void;
  onComment: (body: string) => void; onReview: (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body?: string) => void;
  onMerge: (squash: boolean) => void; onCheckout: () => void;
}
export function GitLabPanel(props: GitLabPanelProps): React.ReactNode;
```

**控制器裁定（遵守）：** 以 GitHubPanel 为模板逐项同构（提示卡两态、单击选中、reviewState 徽标（NONE 不渲染）、时间线 kind 徽标、文件 diff 折叠预览（空串不渲染）、合并 Modal **squash Checkbox**（默认勾选?——**裁定默认不勾选**，用户显式选择；GitLab 项目可配置 squash 默认，仅传参）、新建 MR Modal（源分支 Select（branches 列表）+ 目标分支 Select + 标题 Input + 描述 TextArea 可选；校验源≠目标、标题非空）、空态、acting 禁用、onRefresh 可选缺省不渲染）；新建 MR 成功回调后由容器关闭 Modal。

- [ ] **Step 1: 写失败测试**（两卡、列表、详情、时间线、文件、合并 squash 载荷、新建 MR 三态校验与载荷、评论/审查/检出回调、空态、acting、刷新缺省）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "feat(ui): GitLabPanel"`

---

### Task 6: 页面装配 —— 两端 GitLab 页 + LogPage 入口

**Files:**
- Create: web-next `app/repos/[repoId]/gitlab/page.tsx`、web-koa `src/pages/gitlab.tsx`
- Modify: `apps/web-koa/src/main.tsx`（1 Route）、`packages/client/ui/src/composite/log-page.tsx`（追加 `onOpenGitlab?`/`gitlabAvailable?` 可选 props）、两端日志容器（注入 useGitlabStatus + 导航）、`log-page.test.tsx`（追加两态用例）
- Test: 页面渲染冒烟 + log-page 用例

**Interfaces:**
- Consumes: Task 4 hooks + Task 5 组件。
- Produces：路由 `/repos/:repoId/gitlab`（两端）；LogPage「更多」菜单「GitLab 面板」项（双条件渲染）；GitLab 页容器：useGitlabStatus + useGitlabMrs（opened/closed 两 Tab——**裁定：opened/merged 两 Tab**，GitLab 完结态是 merged）→ 详情/timeline/files 条件 hook → 五个 mutation 接线（create → 回写 mrs + 关 Modal；comment → timeline；review → detail；merge → mrs+detail；checkout → 跨键 status/branches）；branches = useBranches 传给面板；错误处理同 github（AUTH_FAILED 卡仅 mrs、RATE_LIMITED 文案、其余 toast）。

**控制器裁定（遵守）：**
1. LogPage 新 props：`onOpenGitlab?`/`gitlabAvailable?` 双条件渲染「GitLab 面板」菜单项（与 GitHub 面板项并排，各自检测）。
2. 冒烟（命令序列写报告）：web-next build（含 gitlab 路由）+ web-koa build；checkout 全链路（本地裸仓库装置 `refs/merge-requests/7/head` → mr-7 检出 + git CLI 复核）；页面渲染以 build + typecheck + 组件测试为准（真实 MR 数据面不依赖网络）。

- [ ] **Step 1: 写失败测试**（log-page 新入口：注入渲染、gitlabAvailable=false 不渲染）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/ui test`。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过** `pnpm test` 全量。
- [ ] **Step 5: 质量门 + 冒烟 + 提交** —— `git commit -m "feat(apps): GitLab 页面两端落地与 LogPage 入口"`

---

### Task 7: 全分支终审（合约任务，无独立实现）

- [ ] 终审包（MERGE_BASE..HEAD）→ 最严 reviewer → findings → ONE fix wave → 限定复审 → 关账记录（计划文件尾）→ 删 SDD 工作区。
- [ ] 关账 commit `docs: P4-A 关账记录（…）`；审计报告增补 P4-A 进度。

---

## 自审记录

- Spec 覆盖：§4.2 gitlab 行全功能点映射——账户/token 认证：🟡→✅（复用 P2-H + findToken('gitlab.com')；专属登录流明确不做）；MR 创建：✅（endpoint+Modal）；列表/详情/diff/评论：✅；审查（approve/request changes）/合并：✅（squash 参数）；Snippet：明确不做（后置）。
- 类型一致性：GitLab{Status,RepoRef,MrSummary,MrDetail,Timeline,TimelineEntry,MrFile,MrFiles,MrMergeResult,MrCheckoutResult,MrCreateBody 经 schema infer} + 6 schema 跨任务签名对齐；错误复用 12 码不新增。
- 简化裁定：与 P3-E 完全同构（git 面解耦、单击选中、时间线旧→新、diff 文本预览、reviews 尽力合并、files 行数置 0 注明）；GitLab 特有：iid、owner 子组、PRIVATE-TOKEN header、merge 仅 squash、MR 创建含源/目标分支。
- 风险：GitLab REST 形状随版本演进（mock 断言避开易变字段）；changes 接口已过滤提交顺序（v1 按返回原样）；自托管实例不支持（明确不做）。


---

## 关账记录（P4-A）

**流水线**：6 任务全完成（contracts → api → 两端路由 → client → ui GitLabPanel → 装配），终审 Merge-with-fixes → 修复波 `6054559`（I-1 新建入口提升 / I-2 标题 maxLength / I-3 LogPage 缺省用例）→ 限定复审 all addressed → **关账**。实现区间 `df9a50f..6054559`。

**终审结论**：无 Critical；3 Important（终审确认 + 修复闭环）；14 条跨任务一致性核对全过（detected 三层语义、reviewState /reviews 尽力派生、timeline 1e9 偏移↔面板 key、merge message warning 路径、branchName toast、null-key 条件 hook↔iid 选中态、create 面板自关流、token 零泄漏、错误契约全链、两端 10 端点/页面/LogPage 入口对称、明确不做零夹带）；**安全面：GitLab 域无新增 token 泄漏面**（PRIVATE-TOKEN 头、错误消息/响应零 token、客户端只见 account 名、checkout 走既有 withAuth——Bearer 对 GitLab 属已知限制见排期）。

**Rulings（控制器裁定）**：
- iid 语义（非全局 id）；owner 全路径含子组（`encodeURIComponent`；与 github「子路径→null」差异系有意，注释在案）；PRIVATE-TOKEN header（非 Bearer）；merge 仅 {squash?}（GitLab 策略为项目设置）；review 三映射（approve / reviews{state:rejected} / notes）；files 行数置 0（GitLab 不逐文件给行数，注释在案）。
- checkout git 面与数据面解耦（origin/首远程，refspec `refs/merge-requests/:iid/head`，`mr-N` 已存在仅 checkout）；checkout 认证失败 → AUTH_FAILED。
- 时间线 notes+reviews 尽力合并（reviews 4xx/429 忽略）；review id = 1e9 + reviewId；reviewState 经 /reviews 尽力派生（detail=2 请求；REVIEW_REQUIRED v1 不产出——契约并集成员，注释在案）。
- 创建 Modal 确认即关+复位 = v1 接受（GH 合并 Modal 同构；T6 按「面板自关，容器只 trigger+toast+回写」接线；失败丢表单记 minor，受控通道后置）。终审提升「新建 MR」按钮至列表卡 extra（空库可创建首个 MR）+ 标题 maxLength=255——均已随修复波落地。
- 5 state 键全维（gitlabMrQuerySchema 枚举；UI 仅 opened/merged 两 Tab 是容器层）；mrs 键恒带 ?state=。
- merge 后条目留在 opened 缓存（GH 同构，切 Tab 重取兜底）；create 前置插入依赖默认排序（容器刷新兜底）；文档类笔误（T3「10 route.ts」=9 文件 10 端点、提交信息英文=brief 逐字规定）存档。

**triage（deferred → 排期/不修）**：
- 排期：① checkout 经 withAuth 注入 Bearer——GitLab 官方文档化为 PRIVATE-TOKEN/token-as-password；SSH 远程不受影响，HTTPS 失败以可读 AUTH_FAILED 呈现（非静默）→ 真机验证 + 必要时 core 层改 Basic/PRIVATE-TOKEN 注入；② web-next 空/非法 JSON body → 500 vs koa 400（既存全局行为，P3-E 同构）→ 全局评估清单；③ createOpen 跨仓库保持打开（SPA 同路由切换，容器 repoId effect 配合处理——fix-wave 后新发现）；④ 无令牌提示卡补「去设置」链接（GH 同构后置）。
- 不修（记录在案）：T1/T3 报告计数类、gitlabAccount() vs findToken（行为等价）、commented→NONE 与时间线 COMMENTED 口径差（注释在案）、merge{merged:false} 防御分支（405/406 走 GIT_ERROR）、jsdom/antd Modal 怪癖（环境）、REVIEW_STATE_COLORS NONE 死条目（GH 同构）、容器无独立单测（github 先例）、质量门 30s 超时（串行复跑全绿）、提交 scope 信息性、M-1..M-8 观察项。

**环境备注**：core 30s 并行超时 flake + web-next EPERM 清理 flake（既有 GitHub 用例，两次失败用例不同）均为既有环境缺陷（串行复跑全绿、与 GitLab 代码面零耦合）。

**冒烟**：checkout 全链路（koa 真实服务 + 本地裸仓库 `refs/merge-requests/7/head` → mr-7 + git CLI 三断言）；两端 build PASS（web-next 路由表含全部 10 gitlab 端点 + 页面；web-koa vite）；真实 MR 数据面需用户 GitLab token 人工验证（测试零真实网络）。
