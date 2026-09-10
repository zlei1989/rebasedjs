# rebased.js —— Rebased 的 TypeScript 复刻

> 可视化 Git 工具（pnpm monorepo）。以 [Rebased](https://github.com/DetachHead/rebased)（基于 IntelliJ 平台的独立 Git 客户端）为功能与交互的唯一参照，用 TypeScript 全栈重写。

- **复刻终态口径**：[`docs/pages-and-api-audit.md`](docs/pages-and-api-audit.md)（36 功能域 / 31 页面 / 端点与契约盘点，唯一终态口径）
- **架构规范**：[`docs/architecture-design.md`](docs/architecture-design.md)
- **开发约定**：[`AGENT.md`](AGENT.md)

---

## 目录

1. [原版 Rebased 是什么](#一原版-rebased-是什么)
2. [本仓库复刻了什么](#二本仓库复刻了什么)
3. [复刻基线](#三复刻基线)
4. [已实现功能](#四已实现功能)
5. [未实现 / 明确不做](#五未实现--明确不做)
6. [快速开始](#六快速开始)
7. [如何使用 DeepSeek 布置目标任务复刻](#七如何使用-deepseek-布置目标任务复刻)
8. [文档索引](#八文档索引)
9. [许可与致谢](#九许可与致谢)

---

## 一、原版 Rebased 是什么

[Rebased](https://github.com/DetachHead/rebased) 是 **基于 IntelliJ 平台的独立 Git 客户端**（"A git client based on the IntelliJ platform"）：

- 它是对 JetBrains 曾短暂推出的独立 Git 客户端的开源复刻——该诉求在 [YouTrack IJPL-72504](https://youtrack.jetbrains.com/issue/IJPL-72504/Make-git-client-a-standalone-app) 上被请求了近十年（一度是 YouTrack 上投票第 3 高的未解决 issue）。
- 本质上它就是一个 **JetBrains IDE：移除除 Git 集成外的全部内置插件，外加一些 UI 调整**（源码基于 `intellij-community`，Java/Kotlin，Bazel 构建）。
- 相比官方 IDE 的独占特性：Git 日志可默认放在主编辑区（可改回底部工具窗口）；可禁用 `.idea` 目录生成；附带额外的 TextMate 语法高亮包（如 vue）。
- 发行：Windows installer / winget、Linux AppImage、macOS homebrew；许可为 JetBrains Open-Source Build Terms（Apache-2.0 开源构建条款）。

## 二、本仓库复刻了什么

rebased.js 将 Rebased 的 **操作页面、功能域、交互与导航** 以 TypeScript 全栈重写：

- **技术栈**：Next.js 16（web-next）+ Koa（web-koa）两个薄下游应用，共享同一套 `ui` + `client`，端点完全对称（103 路由文件 ↔ 118 注册）；服务端核心（`core` git CLI 引擎 / `api` 功能服务层 / `contracts` 契约）零框架依赖。
- **移植方法论**：*算法移植、结构参照、风格对齐，不搬渲染代码*——Swing/Jewel 通用控件换成 antd + Tailwind；IntelliJ 编辑器换成 Monaco；**VCS Log 图布局算法（`vcs-log/graph`）算法级移植**为纯函数引擎（Java testData 转 vitest 行为等价夹具，保留 Apache-2.0 版权声明）；Git 专属复杂组件（交互式 rebase、分支树、暂存区、冲突面板等）按信息架构逐项对照自研。
- **架构原则**：单向依赖 + `withBoundary()` eslint 硬约束（`api`/`core` 禁框架、`ui` 纯展示禁接口调用），详见 [`docs/architecture-design.md`](docs/architecture-design.md)。

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

盘点终态（2026-09-21 终核，`docs/pages-and-api-audit.md` 为唯一口径）：

| 维度 | 终态 |
|------|------|
| 功能域 | **36/36**：P1（repo/status/log/diff/settings，5）✅ 全量；P2（operation/reset/staging/changelist/commit/branch/checkout/merge/stash/conflict/config/auth，12）✅ 全量；P3（rebase 交互式/cherry-pick/revert/tag/remote/update/blame/history/committed/search/patch/shelf/console/ignore/github，15）✅ 全量；P4（gitlab/worktree/submodule/browse，4）✅ 全量 |
| 操作页面/面板 | **31/31**：29 ✅ + 2 🟡 等效（CommitDialog→StatusPage 内嵌提交框；QuickActionsMenu→顶栏+更多菜单+操作条，均为定案形态） |
| 接口 | **103 路径 / 118 方法**，web-next 与 web-koa 完全对称；无死接口、无半使用接口（diff/stream 分块渲染、staging/hunks 行内选择均已接 UI） |
| 契约 | zod schema 71、领域类型 97、SSE 事件在用（`log.line`/`diff.chunk`/`repo.state-changed`/`operation.state-changed`/`refs.changed`）、错误码 12 定义（9 实际产生 / 3 预留定档） |
| 导航边 | 106 条终态：93 ✅（含等效边）+ 1 🟡 + 8 ➖ + 4 ❌（明确不做）——**❌ 可做缺口 0** |

功能亮点（均对照 Java 版逐项核对）：

- 提交图（graph-layout 算法级移植 + 虚拟滚动）、提交详情、SSE 实时刷新（干净提交也能触发）
- 工作区/暂存/任意两版本 diff、三版本对比（ThreeWayView）、流式大 diff 渐进渲染（Monaco）
- 提交全套：amend、amend 历史提交、GPG 签名、commit template、CRLF 提示、commit & push、hook 失败 422 引导
- 分支/检出/合并/rebase（含交互式 rebase 编辑器、autosquash、skip、continue）、cherry-pick/revert、冲突统一三态（ours/theirs/manual/delete）+ 按目录分组
- stash/patch/shelf 全链路（keep index、unstash as、import into shelf、unborn HEAD 建补丁/搁置）
- 远程：fetch/pull/push、push up to commit、push 被拒 → Update 联动、shallow 徽标、force-pushed 修复
- 溯源链路：BlameView / HistoryPanel（重命名跟随）/ SearchPanel / CommittedChangesPanel（目录树）↔ 日志页深链
- GitHub PR / GitLab MR 全流程（列表/详情/时间线/评论/**行级 diff 视图与行级评论锚点**/合并/检出）、GitLab Basic 认证
- worktree / submodule（路径越界白名单）/ 保护分支 / git 可执行文件检测与引导 / 历史快照浏览（BrowsePanel）
- 质量：真实 git CLI 夹具测试（建仓模板 0-spawn）、质量门 `typecheck → format → test` 全绿、全量回归 ~359s（1759s→359s，4.9×）、E2E 浏览器实测报告（`docs/verification/`）

## 五、未实现 / 明确不做

功能性缺口 **0**。剩余项全部为决策后的「明确不做」、等效形态或可选后置：

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

单应用开发：`pnpm --filter @rebased/web-koa dev:web`（Vite SPA，http://localhost:5173，`/api` 代理到 3031）。端口被占用先 kill 占用进程再启动（见 AGENT.md）。

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

本仓全部功能即按以下「DeepSeek 驱动复刻」工作流产出。要用 DeepSeek 布置目标任务复刻（新功能或补齐缺口），按 6 步走：

### 1. 固定参照基线

```bash
git clone --depth 1 https://github.com/DetachHead/rebased <local-path>
git -C <local-path> checkout 4b86f650214545077f77599d6c9955fd2e9c35bf   # 钉住复刻基线
```

### 2. 规格先行（让 DeepSeek 读全）

把 [`docs/architecture-design.md`](docs/architecture-design.md)（分层/边界/约定）与 [`docs/pages-and-api-audit.md`](docs/pages-and-api-audit.md)（唯一终态口径：36 功能域 / 31 页面 / 端点 / 导航边 / 决策清单）作为上下文交给 DeepSeek——**先读后改，以盘点报告为验收口径，不在对话里口头约定状态**。

### 3. 布置任务的 prompt 模板

```
/goal 按 pages-and-api-audit.md 复刻参照系项目（Java IntelliJ Rebased）全部页面与功能，无缺口、无遗漏，范围以 https://github.com/DetachHead/rebased 实码为准。
```

### 4. 验证闭环（完成前必做）

1. 质量门三连：`pnpm typecheck` → `pnpm format` → `pnpm test` 全绿；
2. 浏览器冒烟：启动真实服务（web-next :3030 / web-koa :3031），用 playwright MCP 按真实用户路径逐项操作（表单、按钮、弹窗、导航），**并用 CLI 复核实际 git 状态，页面展示与仓库事实互证**；
3. 更新盘点报告对应节 + 缺口计数，保持「唯一终态口径」始终准确。

### 5. 常用约束注入（推荐放入项目级配置）

本仓已落地于 `AGENT.md` / `.agent/`（可复用）：写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/` 对应指南；写 UI 前先用 context7 查 antd / `@ant-design/plots` 用法，适配 light/dark 主题与弹性布局；代码变更后必须先 `typecheck → format` 再进审查；测试遵守 spawn 成本模型（单次 git spawn ~330ms）。

## 八、文档索引

| 文档 | 内容 |
|------|------|
| [`docs/architecture-design.md`](docs/architecture-design.md) | 分层架构、依赖方向、移植方法论、测试与质量门 |
| [`docs/pages-and-api-audit.md`](docs/pages-and-api-audit.md) | 复刻盘点唯一终态口径：36 功能域 / 31 页面 / 端点与契约 / 导航边 / 决策清单 / 任务闭环 |
| [`docs/verification/`](docs/verification/) | P1 E2E 浏览器实测报告与截图证据 |
| [`.superpowers/sdd/`](.superpowers/sdd/) | 三期 SDD 实施记录（briefs / reports / progress + Rulings） |
| [`AGENT.md`](AGENT.md) | 开发约定：命令、注释、日志、冒烟、测试性能 |
| [`.agent/`](.agent/) | 编码规则（common / typescript / web）与 agent 配置 |

## 九、许可与致谢

- 参照项目：[DetachHead/rebased](https://github.com/DetachHead/rebased)（JetBrains Open-Source Build Terms，Apache-2.0 开源构建）。
- 移植的 VCS Log 图布局算法源自 IntelliJ Community（`platform/vcs-log/graph`，Apache-2.0），TS 移植保留了版权声明，行为等价性由 Java testData 转制的 vitest 夹具保障。
- 本仓库为个人学习/复刻项目，与 JetBrains 或 Rebased 原作者无隶属关系。
