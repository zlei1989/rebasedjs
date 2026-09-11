# rebased.js —— Rebased 的 TypeScript 复刻

## 一、原版 Rebased 是什么

[Rebased](https://github.com/DetachHead/rebased) 是**基于 IntelliJ 平台的独立 Git 客户端**（"A git client based on the IntelliJ platform"）：

- 对 JetBrains 曾短暂推出的独立 Git 客户端的开源复刻；该诉求在 [YouTrack IJPL-72504](https://youtrack.jetbrains.com/issue/IJPL-72504/Make-git-client-a-standalone-app) 上被请求近十年（一度是投票第 3 高的未解决 issue）。
- 实现上就是一个 **JetBrains IDE**：移除除 Git 集成外的全部内置插件，外加少量 UI 调整（源码基于 `intellij-community`，Java/Kotlin，Bazel 构建）。
- 与官方 IDE 的差异：Git 日志默认置于主编辑区（可改回底部工具窗口）；可禁用 `.idea` 目录生成；附带额外 TextMate 语法高亮包。
- 发行：Windows installer / winget、Linux AppImage、macOS Homebrew；许可为 JetBrains Open-Source Build Terms（Apache-2.0 开源构建条款）。

## 二、本仓库复刻了什么

rebased.js 以 TypeScript 全栈重写 Rebased 的**操作页面、功能域、交互与导航**：

- **技术栈**：Next.js 与 Koa 两个薄下游应用，共享同一套 `ui` + `client`，端点完全对称（103 路由文件 ↔ 118 注册）；服务端核心（`core` git CLI 引擎 / `api` 功能服务层 / `contracts` 契约）零框架依赖。
- **移植方法**：*算法移植、结构参照、风格对齐，不搬渲染代码*——Swing/Jewel 控件换 antd + Tailwind，IntelliJ 编辑器换 Monaco；VCS Log 图布局算法（`vcs-log/graph`）做算法级移植为纯函数引擎（Java testData 转 vitest 行为等价夹具，保留 Apache-2.0 版权声明）；Git 专属复杂组件（交互式 rebase、分支树、暂存区、冲突面板等）按信息架构逐项对照自研。
- **架构原则**：单向依赖 + `withBoundary()` eslint 硬约束（`api`/`core` 禁框架，`ui` 纯展示禁接口调用），详见 [`docs/architecture-design.md`](docs/architecture-design.md)。

## 三、复刻基线

| 项 | 值 |
|----|----|
| 参照仓库 | https://github.com/DetachHead/rebased |
| **起始提交（复刻基线）** | `4b86f650214545077f77599d6c9955fd2e9c35bf`（2026-08-24，*support debugging intellij platform plugins targeting Rebased (#332)*） |
| 本地参照位置 | `D:\zhanglei1120\Github\rebased`（浅克隆，钉在该提交） |
| 本仓开发起点 | 2026-09-01（首个可见提交 `13a68f6`；此前 `.git` 目录意外丢失，基于工作树重建基线，代码零丢失） |
| 盘点终核 | 2026-09-21（`docs/pages-and-api-audit.md` §六/§七 全部闭环） |

复刻以该提交为**快照式基线**：原仓库后续更新不自动追入；「明确不做」项与可选任务在新需求出现时可重新决议（见盘点报告 §1.3/§7.9）。

## 四、已实现功能

盘点终态（2026-09-21 终核，以 `docs/pages-and-api-audit.md` 为唯一口径）：

| 维度 | 终态 |
|------|------|
| 功能域 | **36/36**：P1（repo/status/log/diff/settings，5）✅ 全量；P2（operation/reset/staging/changelist/commit/branch/checkout/merge/stash/conflict/config/auth，12）✅ 全量；P3（rebase 交互式/cherry-pick/revert/tag/remote/update/blame/history/committed/search/patch/shelf/console/ignore/github，15）✅ 全量；P4（gitlab/worktree/submodule/browse，4）✅ 全量 |
| 操作页面/面板 | **31/31**：29 ✅ + 2 🟡 等效（CommitDialog→StatusPage 内嵌提交框；QuickActionsMenu→顶栏+更多菜单+操作条，均为定案形态） |
| 接口 | **103 路径 / 118 方法**，web-next 与 web-koa 完全对称；无死接口、无半使用接口（diff/stream 分块渲染、staging/hunks 行内选择均已接 UI） |
| 契约 | zod schema 71、领域类型 97、SSE 事件在用（`log.line`/`diff.chunk`/`repo.state-changed`/`operation.state-changed`/`refs.changed`）、错误码 12 定义（9 实际产生 / 3 预留定档） |
| 导航边 | 106 条终态：93 ✅（含等效边）+ 1 🟡 + 8 ➖ + 4 ❌（明确不做）——**❌ 可做缺口 0** |

## 五、未实现 / 明确不做

| 类别 | 项 |
|------|----|
| 明确不做（可选功能域 2 项） | terminal（内置终端）、local-history（本地历史）——无编辑器宿主 / 与核心价值正交 |
| 明确不做（子功能，12 项决策清单） | GitHub Gist / GitLab Snippet；自托管 GitLab 实例；托管平台 OAuth/device 登录流（改 PAT 手动录入）；PR AI 描述；打开 worktree 项目；Update 流程内子模块更新；分支弹窗 New Working Tree；全局 Search Everywhere / 编辑器内嵌 Blame（以页面承载）；克隆/分享项目到 GitHub（分享不做，克隆已落地）；QuickActionsMenu 独立聚合组件 |
| 🟡 等效形态（非缺口） | CommitDialog → StatusPage 内嵌提交框；QuickActionsMenu → 顶栏+「更多」菜单+操作条；导航边 #20 分支右键子菜单（功能面完整，仅菜单组织形态） |
| 可选任务（1 项） | LogPage 分支折叠——大仓库折叠诉求出现时单独立项（过滤 UI 前置已落地，仅剩 PermanentGraph 类缓存结构） |
| 预留错误码（2 个） | `STALE_LOCK`（index.lock 竞态）、`CANCELLED`（客户端断开）——待底层路径消费 |
| 装饰性后置（1 项） | RepoPage 最近列表项分支后缀/图标/失效标记 |

## 六、快速开始

前置：Node.js ≥ 20、[pnpm](https://pnpm.io)（corepack）、系统 git CLI。

```bash
pnpm install      # 仅允许 pnpm（preinstall 强制）
pnpm dev          # 并行启动：web-next http://localhost:3030 + web-koa http://localhost:3031
pnpm build        # 生产构建
pnpm test         # vitest 全量测试（预算 ~6 分钟）
pnpm typecheck    # 全链类型检查
pnpm format       # ESLint --fix 统一格式
```

单应用开发：`pnpm --filter @rebased/web-koa dev:web`（Vite SPA，http://localhost:5173，`/api` 代理到 3031）。

目录结构（职责与依赖方向详见 `AGENT.md` 与 `docs/architecture-design.md`）：

```text
rebasedjs/
├── apps/web-next/     # 下游应用①：Next.js 16（页面壳 + 路由转调服务层）
├── apps/web-koa/      # 下游应用②：Koa（路由 + 静态托管同一 SPA）
├── packages/server/   # core（git CLI 原语，零依赖）/ api（一个功能一个文件）/ contracts（zod 契约）
├── packages/client/   # ui（纯展示组件 + graph-layout 布局引擎）/ client（SWR + SSE hooks）
└── docs/              # 架构规范 + 盘点报告 + 验收证据
```

## 七、如何使用 DeepSeek 布置目标任务复刻

本仓全部功能即按以下「DeepSeek Harness 驱动复刻」工作流产出。

### 1. 固定参照基线

```bash
git clone --depth 1 https://github.com/DetachHead/rebased <local-path>
git -C <local-path> checkout 4b86f650214545077f77599d6c9955fd2e9c35bf   # 钉住复刻基线
```

### 2. 规格先行

将 [`docs/architecture-design.md`](docs/architecture-design.md)（分层/边界/约定）与 [`docs/pages-and-api-audit.md`](docs/pages-and-api-audit.md)（唯一终态口径：36 功能域 / 31 页面 / 端点 / 导航边 / 决策清单）作为上下文交给 DeepSeek——**先读后改，以盘点报告为验收口径，不在对话里口头约定状态**。

### 3. 布置任务的 prompt 模板

```
/goal 按 pages-and-api-audit.md 复刻参照系项目（Java IntelliJ Rebased）全部页面与功能，无缺口、无遗漏，范围以 https://github.com/DetachHead/rebased 实码为准
```

## 八、许可与致谢

- 参照项目：[DetachHead/rebased](https://github.com/DetachHead/rebased)（JetBrains Open-Source Build Terms，Apache-2.0 开源构建）。
- 移植的 VCS Log 图布局算法源自 IntelliJ Community（`platform/vcs-log/graph`，Apache-2.0），TS 移植保留了版权声明，行为等价性由 Java testData 转制的 vitest 夹具保障。
- 本仓库为个人学习/复刻项目，与 JetBrains 或 Rebased 原作者无隶属关系。
