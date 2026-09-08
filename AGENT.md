# AGENT.md

用中文交流。

## 约束

- **写 Next.js 代码前先读 `apps/web-next/node_modules/next/dist/docs/` 中的相关指南** — 当前版本可能有训练数据未覆盖的破坏性变更
- **写 UI 前先用 context7 查组件用法** — 常规界面与布局用 `antd`、数据可视化用 `@ant-design/plots`；样式用 `Tailwind`，避免裸写 `div` 等原始标签
- **代码变更后、进入审查阶段前，必须先执行检查与格式化** — 顺序：`npm run typecheck` → `npm run format` → 修复所有错误 → 再进入代码审查；格式化产生的代码变更需随本次改动一并提交
- web 启动时若端口被占用，先 kill 占用进程再启动

## 目录

monorepo：2 个下游应用 + 服务端/客户端两层，职责严格分离（设计见 `docs/superpowers/specs/2026-09-01-rebasedjs-architecture-design.md`）：

rebasedjs/
├── apps/
│   ├── web-next/       # 下游应用①：Next.js 薄组装（页面壳 + 路由转调 api）
│   └── web-koa/        # 下游应用②：Koa 薄组装（路由 + 静态托管同一 SPA）
├── packages/
│   ├── server/
│   │   ├── core/       # git CLI 引擎封装（流式原语、进程管理），零依赖
│   │   ├── api/        # 功能服务层：一个功能一个文件，禁框架依赖
│   │   └── contracts/  # 跨端契约：zod schema + 领域类型 + 错误码 + SSE 事件
│   └── client/
│       ├── ui/         # 纯展示组件（基础 + 组合），不调接口
│       └── client/     # 数据层：SWR hooks + SSE 订阅 hooks
├── docs/
└── eslint.shared.ts    # 共享规则 + 分层边界规则（withBoundary）

- **core**：与 git 进程打交道的引擎层，无任何业务；测试用真实 git CLI
- **api**：后端逻辑，每个小功能 1 个文件；只依赖 core + contracts，禁止 import 任何框架
- **contracts**：服务端与客户端共享的类型/校验/错误契约
- **ui**：只做基础组件和组合组件，不涉及任何接口调用，纯数据驱动
- **client**：数据获取 hooks（SWR + SSE），类型全部来自 contracts
- **web-next / web-koa**：框架层，路由只做「zod 校验 → 调 api → 错误映射」三件事

依赖方向：`web-next → api/ui/client/contracts`；`web-koa → api/contracts`；`ui → contracts`；`client → contracts`；`api → core/contracts`；`core → 无`。边界由 `eslint.shared.ts` 的 `withBoundary()` 硬约束。

## 命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 并行起所有包的 dev 脚本：web-next (localhost:3030) + web-koa 服务端 (localhost:3031) |
| `pnpm --filter @rebased/web-koa dev:web` | web-koa 的 SPA 前端 Vite 开发服务器 (localhost:5173，代理 /api → 3031) |
| `pnpm build` | 生产构建 |
| `pnpm format` | 统一 ESLint `--fix` 自动修复（共享格式规则见根 `eslint.shared.ts`） |
| `pnpm typecheck` | TypeScript 类型检查 |
| `pnpm test` | 运行 vitest 测试 |

## 注释

| 规则 | 说明 |
|------|------|
| 风格 | TS/TSX 用 JSDoc；中文，简洁，先说"做什么"再说"怎么做" |
| 文件头 | 简要说明文件职责 + 注意事项 |
| 嵌套 > 2 层 | 必须注释业务含义 |
| 功能点 | 方法、条件分支、事件处理、数据转换等独立功能单元都需说明其业务目的和关键逻辑 |
| 重要方法 | 必须注释算法思路或业务逻辑 |
| 特殊处理 | 环境判断、响应处理等需注释原因 |
| 密度 | 同文件内保持一致 |

## 日志

| 级别 | 场景 |
|------|------|
| ERROR | 业务异常、外部调用失败 — 必须打印堆栈和业务上下文 |
| WARN | 降级、重试、超时、配置缺失但可继续 |
| INFO | 请求入口、关键状态变更、外部调用耗时 >500ms |
| DEBUG | 分支走向、中间变量、循环关键节点（生产默认关闭） |

**必须打日志的点位**：请求入口（INFO + 标识）、外部调用（DEBUG 参数 + INFO 耗时）、异常捕获（ERROR + 堆栈 + 上下文）、关键分支（DEBUG + 依据）

## 测试

- **单元/组件/服务测试**：vitest + node，用真实 git CLI + 临时仓库夹具。
- **模拟人工测试（冒烟）**：启动真实服务（web-next :3030 / web-koa :3031），用 mcp 在浏览器中按真实用户路径逐项操作（表单输入、按钮、弹窗、导航），并用 CLI 复核实际 git 状态，页面展示与仓库事实互证。
- **冒烟记录**：每次冒烟后在对应计划/关账记录的「冒烟」小节写入：① 范围清单（逐项 ✅/❌/跳过+理由）；② 操作路径（点击/输入序列）；③ 证据（浏览器状态 + CLI 输出互证）；④ 未覆盖项与后续计划（如有）。

## 技术栈

- **路由** — web-next：App Router（Server Components + Server Actions + API Routes）；web-koa：koa-router
- **测试** — vitest + node
- **路径别名** — 各包自含、无跨包 `@/` 别名：web-next 内 `@/*` 指向 `apps/web-next/*`，web-koa 内 `@/*` 指向 `apps/web-koa/*`（当前两包均未实际配置别名，包内引用走相对路径、跨包引用走 `@rebased/*` 包名）
