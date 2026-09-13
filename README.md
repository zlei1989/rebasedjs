# rebased.js —— Rebased 的 TypeScript 复刻

[Rebased](https://github.com/DetachHead/rebased) 是基于 IntelliJ 平台的独立 Git 客户端（源码基于 `intellij-community`）。
本仓库用 TypeScript 全栈重写它的**操作页面、功能域、交互与导航**。

## 一、复刻基线

| 项 | 值 |
|----|----|
| 参照仓库 | https://github.com/DetachHead/rebased |
| 起始提交（复刻基线） | `4b86f650214545077f77599d6c9955fd2e9c35bf`（2026-08-24） |

以该提交为**快照式基线**：原仓库后续更新不自动追入；「明确不做」项在新需求出现时可重新决议。

## 二、怎么做的

- **技术栈**：Next.js 与 Koa 两个薄下游应用，共享同一套 `ui` + `client`，端点完全对称（103 路由 ↔ 118 注册）；服务端 `core`（git CLI 引擎）/ `api`（一个功能一个文件）/ `contracts`（zod 契约）零框架依赖。
- **移植方法**：*算法移植、结构参照、风格对齐，不搬渲染代码* —— Swing/Jewel 换 antd（主题 token + 紧凑密度，不引入 Tailwind 等工具类框架），IntelliJ 编辑器换 Monaco；VCS Log 的图布局、线性折叠、分支过滤按 Java 源码做纯函数级移植（Java testData 转 vitest 行为等价夹具，保留 Apache-2.0 版权声明）；Git 专属复杂组件（交互式 rebase、暂存区、冲突面板等）按信息架构逐项对照自研。
- **架构原则**：单向依赖 + `withBoundary()` eslint 硬约束（`api`/`core` 禁框架，`ui` 纯展示禁接口调用），详见 [`docs/architecture-design.md`](docs/architecture-design.md)。

## 三、已实现功能

终态以 [`docs/pages-and-api-audit.md`](docs/pages-and-api-audit.md) 为唯一口径；逐页用法见 [`docs/manual.md`](docs/manual.md)。

| 维度 | 终态 |
|------|------|
| 功能域 | **36/36** ✅：repo / status / log / diff / settings / operation / reset / staging / changelist / commit / branch / checkout / merge / stash / conflict / config / auth / rebase（含交互式）/ cherry-pick / revert / tag / remote / update / blame / history / committed / search / patch / shelf / console / ignore / github / gitlab / worktree / submodule / browse |
| 操作页面/面板 | **31/31**：29 ✅ + 2 🟡 等效（CommitDialog → StatusPage 内嵌提交框；QuickActionsMenu → 顶栏 +「更多」菜单 + 操作条，均为定案形态） |
| 接口 | **103 路径 / 118 方法**，两端完全对称；无死接口、无半使用接口 |
| 契约 | zod schema 71、领域类型 99、SSE 事件 6 种、错误码 12 定义（9 实际产生 / 3 预留） |
| 导航边 | 106 条：93 ✅（含等效边）+ 1 🟡 + 8 ➖ + 4 ❌（明确不做）—— **❌ 可做缺口 0** |

首页最近仓库列表项（分支后缀 / 首字母头像 / 失效标记）与日志页线性折叠、分支过滤均已落地，用法见手册 §4.1 / §4.2。

## 四、未实现 / 明确不做

| 类别 | 项 |
|------|----|
| 可选功能域（2 项） | terminal（内置终端）、local-history（本地历史）—— 无编辑器宿主 / 与核心价值正交 |
| 子功能（决策清单） | GitHub Gist / GitLab Snippet；自托管 GitLab 实例；托管平台 OAuth/device 登录流（改 PAT 手动录入）；PR AI 描述；打开 worktree 项目；Update 流程内子模块更新；分支弹窗 New Working Tree；全局 Search Everywhere 与编辑器内嵌 Blame（以页面承载）；分享项目到 GitHub；QuickActionsMenu 独立聚合组件 |
| 🟡 等效形态（非缺口） | 上表 2 项；导航边 #20 分支右键子菜单（功能面完整，仅菜单组织形态差异） |
| 预留错误码（2 个） | `STALE_LOCK`（index.lock 竞态）、`CANCELLED`（客户端断开）—— 待底层路径消费 |
| 环境依赖 | GitHub / GitLab 面板需目标仓库挂有对应托管远程且令牌有效；PR / MR 内容未纳入冒烟截图（冒烟环境无有效令牌） |

## 五、快速开始

前置：Node.js ≥ 20、[pnpm](https://pnpm.io)（corepack）、系统 git CLI。

```bash
pnpm install      # 仅允许 pnpm（preinstall 强制）
pnpm dev          # 并行启动：web-next http://localhost:3081 + web-koa http://localhost:3082
pnpm build        # 生产构建
pnpm test         # vitest 全量测试（预算 ~6 分钟）
pnpm typecheck    # 全链类型检查
pnpm format       # ESLint --fix 统一格式
```

单应用开发：`pnpm --filter @rebased/web-koa dev:web`（Vite SPA，http://localhost:5173，`/api` 代理到 3082）。

```text
rebasedjs/
├── apps/web-next/     # 下游应用①：Next.js（页面壳 + 路由转调服务层）
├── apps/web-koa/      # 下游应用②：Koa（路由 + 静态托管同一 SPA）
├── packages/server/   # core（git CLI 原语，零依赖）/ api（一个功能一个文件）/ contracts（zod 契约）
├── packages/client/   # ui（纯展示组件 + graph-layout 布局引擎）/ client（SWR + SSE hooks）
└── docs/              # 使用手册 + 架构规范 + 盘点报告 + 验收证据
```

## 六、许可与致谢

参照项目 [DetachHead/rebased](https://github.com/DetachHead/rebased)（JetBrains Open-Source Build Terms，Apache-2.0 开源构建）；移植的 VCS Log 算法源自 IntelliJ Community（`platform/vcs-log/graph`，Apache-2.0），TS 移植保留版权声明、行为等价性由 Java testData 转制的 vitest 夹具保障。本仓库为个人学习/复刻项目，与 JetBrains 或 Rebased 原作者无隶属关系。
