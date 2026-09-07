# P4-C：Playwright e2e（真实操作模拟测试）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 Playwright 端到端套件——以真实浏览器（chromium）驱动 web-next 应用，模拟人工操作真实仓库（临时 git 仓库 + REBASED_CONFIG_DIR 隔离，全程无外部网络），覆盖核心流（状态/提交/日志/分支/暂存/合并冲突/重置）与工具域（补丁/搁置/控制台/忽略/工作树/子模块/设置/账户 + GitHub/GitLab 检测态与提示卡）。满足目标「playwright 模拟人工测试」——套件可重复运行、CI 可挂。

**Architecture:** 新包 `apps/e2e`（playwright @playwright/test + @playwright/test 的 webServer 启动 web-next dev（`pnpm --filter @rebased/web-next dev`、REBASED_CONFIG_DIR 隔离、端口复用既有 3030）+ 仓库工厂 utils（tmp repo 创建/提交/裸克隆/夹具复用——沿 core/api 测试装置模式，Node 层）、UI 流 page objects 轻量（不引 framework——直接 page.locator data-testid）。测试走真实 API（服务层零 mock），数据面仅 mock GitHub/GitLab 检测态（无 token → 页面提示卡；不依赖网络）。

**Tech Stack:** TypeScript、@playwright/test、vitest（不冲突——e2e 独立 runner）、Next.js 16 dev server、Node 18+。

**Spec:** goal 要求（playwright 人工模拟）；审计报告 C 附录逐页功能点（e2e 以「每页至少一条真实操作流」为覆盖目标——C.26/C.27 数据面除外）；既有测试资产参照：core/api 夹具（createTmpRepo/裸仓库/子模块装置）、apps/web-koa/src/app.test.ts 的 rig 先例、ui 包 data-testid 清单（各面板报告均有）。**web-next 端口 3030 为既有约定**（web-koa 3031——本套件只测 web-next）。

## Global Constraints

- 注释规范（AGENT.md）：中文 JSDoc。
- **零真实网络**：e2e 全程 localhost；github/gitlab 页仅为检测态（无远程/无令牌两态断言），不进数据面；绝不触发真实 API 调用（页面在无账户时 AUTH_FAILED 卡/提示卡——数据面本身是服务端负责，页面e2e 不配 token 即天然不进数据面）。
- **独立工作目录**：e2e 测试在 `apps/e2e` 包内；playwright 产物（test-results/playwright-report）加入 .gitignore（检查现有——若无则补）。
- 质量门：`pnpm typecheck` → `pnpm format` → `pnpm test`（vitest 全量——e2e 不并入 vitest，单独 `pnpm --filter @rebased/e2e test`，require node 18+）；e2e 用的临时仓库清理（afterEach rmSync——Windows EPERM 防抖：retry 包装）。
- 提交信息 `feat:`/`fix:`/`test:` 中文摘要。
- 装置纪律：每个 test 独立临时仓库（`fs.mkdtemp` + `git init`/`clone`）；身份预置（`user.name/email` 用 `-c` 局部配置或 config 写入）；默认分支 `git symbolic-ref HEAD --short`；REBASED_CONFIG_DIR 每 test 独立；registerRepo 经 UI（ReposPage 打开）或 config 直写（**裁定：经 UI 打开（模拟人工）——ReposPage 输入 path 打开即可；更快路径可先注册再打开，报告说明**）。
- e2e 超时：动作级 5s/断言 5s（playwright 默认），单 test 60s；重试 0（本地可重跑）。

## 明确不做

- GitHub/GitLab 数据面 e2e（真实 token 网络——人工验证域，报告注明）。
- web-koa 端 e2e（两端路由/页面已由 vitest 对称覆盖；e2e 以 web-next 为宿主）。
- 视觉回归（snapshot）与多浏览器矩阵（仅 chromium；报告注明）。
- 终端/local-history（P4-C 决策：明确不做）。
- Monaco 编辑器内部操作 e2e（DiffPage 渲染断言即可）。

---

### Task 1: e2e 基建 —— playwright 依赖、config、仓库工厂、打开仓库流

**Files:**
- Create: `apps/e2e/package.json`、`apps/e2e/tsconfig.json`、`apps/e2e/playwright.config.ts`、`apps/e2e/src/repo-fixture.ts`（tmp 仓库工厂 + 提交/裸克隆/子模块装置——参照 core/api 夹具写法）、`apps/e2e/src/ui.ts`（轻量 page-objects：openReposPage/openRepo/statusOperations/logOperations）、`apps/e2e/tests/open-repo.spec.ts`（首条冒烟：打开真实仓库 → LogPage 渲染）
- Modify: `pnpm-workspace.yaml`、根 `package.json`（如需要）、`.gitignore`（e2e 产物）

**Interfaces:**
- Produces：`pnpm --filter @rebased/e2e test`（playwright test → chromium headless）；webServer = `pnpm --filter @rebased/web-next dev`（env: REBASED_CONFIG_DIR=<e2e 专属 tmp>、PORT=3030、NEXT_TELEMETRY_DISABLED=1）；`repoFixture()` 返回 {repoPath, cleanup}。
- [ ] **Step 1: 写失败测试**（open-repo.spec.ts 首条——列断言不存在/无法运行：本体夹具先行）。
- [ ] **Step 2: 运行确认失败** `pnpm --filter @rebased/e2e test`（无浏览器/无应用 → 失败形态确认）。
- [ ] **Step 3: 实现**（依赖 `pnpm add -D -w @playwright/test` + `pnpm exec playwright install chromium`——**安装 chromium 需要网络，属一次性环境操作；若受限则记录并改用既有浏览器通道（channel: 'chrome'）**）。
- [ ] **Step 4: 运行确认通过**（首条冒烟绿：打开 → LogPage 出现最近提交/顶栏按钮）。
- [ ] **Step 5: 提交** `git commit -m "test(e2e): Playwright 基建与打开仓库冒烟"`

---

### Task 2: 核心流 e2e —— 状态/提交/日志/分支/暂存/重置

**Files:**
- Create: `apps/e2e/tests/status-commit.spec.ts`、`apps/e2e/tests/log-branch.spec.ts`
- Test: 上述两文件

**Interfaces:**
- Produces（每条 = 真实人工操作模拟 + CLI 复核）：
  1. status：改文件（fs）→ StatusPage「已修改」组出现 → 行内 stage → 「已暂存」组 → 提交框（message+commit）→ CLI `git log --oneline -1` 复核。
  2. log：提交后 LogPage 列表出现新提交（标题+哈希）→ 点击进入 diff/详情（渲染断言）。
  3. branch：BranchPanel 创建新分支（checkout）→ CLI `git branch --show-current` 复核 → 切换回主分支 → 删除。
  4. stash：StatusPage 改动 → StashPanel save（含未跟踪）→ CLI `git stash list` 复核 → apply 或 drop。
  5. merge 冲突：两个分支改同一文件 → MergeDialog merge → ConflictsPanel 出现冲突 → ours/theirs 解决 → 完成合并 → CLI `git status` 复核。
  6. reset：LogPage ResetDialog（soft/hard 一例）→ CLI `git log` 复核。
- [ ] **Step 1: 写失败测试**（全部用例——先红）
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "test(e2e): 核心流（提交/日志/分支/贮藏/合并/重置）"`

---

### Task 3: 工具域 e2e —— patch/shelf/console/ignore/worktrees/submodules/settings + 集成页检测态

**Files:**
- Create: `apps/e2e/tests/tool-domains.spec.ts`（patch/shelf/console/ignore）、`apps/e2e/tests/worktrees-submodules.spec.ts`（worktree 创建/移除 CLI 复核；submodule 装置（本地 URL）→ 面板更新）、`apps/e2e/tests/settings-integrations.spec.ts`（Settings 账户卡 + github/gitlab 页检测态两态断言）
- Test: 上述三文件

**Interfaces:**
- Produces：每条 = 真实人工操作 + CLI 复核：
  1. patch：patch 页创建（工作区态）→ CLI `git apply --check <configDir>/patches/...` 或列表往返复核 → apply。
  2. shelf：save（含未跟踪）→ 工作区清空 → restore → CLI 复核文件回来。
  3. console：操作后 console 页记录出现（args 无 extraHeader 对）→ 刷新。
  4. ignore：StatusPage 未跟踪行「忽略」→ Modal.confirm → CLI 复核 .gitignore 含 `/path`。
  5. worktrees：创建副工作树（sibling 路径）→ CLI `git worktree list` 复核 → 移除。
  6. submodules：面板列表（本地 URL fixture）→ 更新 → CLI `git submodule status` 复核。
  7. settings：账户卡片添加（host=github.com/token 假值）→ 读回掩码断言（token 不显示）。
  8. github/gitlab 检测态：无远程 repo → 页面提示卡「未检测到」；无远程 → LogPage 菜单项不存在；有 github.com 远程无 token → 菜单项存在 + 页面「未配置令牌」卡。
- [ ] **Step 1: 写失败测试**。
- [ ] **Step 2: 运行确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 运行确认通过**。
- [ ] **Step 5: 提交** `git commit -m "test(e2e): 工具域与集成页检测态"`

---

### Task 4: 终审 —— e2e 套件审计 + 全量回归 + 审计终稿

- [ ] e2e 套件终审（复用性/隔离性/零网络/assert 真实性/flake 稳定性——连续两轮全绿）+ 修复波 + 限定复审。
- [ ] 全量回归：`pnpm typecheck` → `pnpm format` → `pnpm test`（vitest 全量）+ `pnpm --filter @rebased/e2e test` 全绿。
- [ ] 审计终稿：审计报告追加 0.29（e2e 证据 + 覆盖率清单 + 剩余人工验证域（github/gitlab 数据面））；功能域终稿盘点（spec §4.2 域表逐行核对——差异表入报告）。
- [ ] 关账 commit `docs: P4-C 关账记录（…）`；删 SDD 工作区。

---

## 自审记录

- 目标覆盖：goal「playwright 模拟人工测试」= 套件化真实操作（核心流 6 + 工具域 8 + 集成检测 2 大类）；人工验证域（github/gitlab 数据面）显示注明。
- 与既有测试关系：vitest 已覆盖服务层/组件层全部；e2e 只测「UI 串联 + 真实 git 端到端」——覆盖差异面，不重复。
- 风险：chromium 安装需网络（T1 记录通道降级）；Windows 下 dev server 启动慢（webServer timeout 120s——next dev 冷启动）；EPERM 清理（retry 包装）；CI 环境未定（套件本地权威）。
