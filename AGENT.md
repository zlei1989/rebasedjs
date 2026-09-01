# AGENT.md

用中文交流。

## 约束

- **写 Next.js 代码前先读 `packages/web/node_modules/next/dist/docs/` 中的相关指南** — 当前版本可能有训练数据未覆盖的破坏性变更
- **写 UI 前先用 context7 查组件用法** — 常规界面与布局用 `antd`、数据可视化用 `@ant-design/plots`；样式用 `Tailwind`，避免裸写 `div` 等原始标签
- **代码变更后、进入审查阶段前，必须先执行检查与格式化** — 顺序：`npm run typecheck` → `npm run format` → 修复所有错误 → 再进入代码审查；格式化产生的代码变更需随本次改动一并提交
- web 启动时若端口被占用，先 kill 占用进程再启动

## 目录

monorepo 分 3 层，职责严格分离：

```text
rebasedjs/           # pnpm monorepo
├── packages/
│   ├── web/         # 组装层 — 只做最终的组装与运行：路由、入口、进程/状态编排，不承载业务逻辑
│   ├── git-api/     # 接口层 — 后端逻辑，每个小功能 1 个文件
│   └── git-ui/      # UI 层 — 基础组件 + 组合组件，纯数据驱动的展示组件
├── docs/
└── eslint.shared.ts # 共享 ESLint 配置
```

- **web**：只是最终的组装运行，把 ui 的组件与 api 的能力装配成应用
- **api**：每个小功能 1 个文件，实现后端逻辑
- **ui**：只做基础组件和组合组件，不涉及任何接口调用，只是数据驱动的 UI 展示组件

依赖方向：`web → git-api`、`web → git-ui`；`git-ui` 不依赖 `git-api`（UI 不涉及任何接口调用）。

## 命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 (localhost:3030) |
| `npm run build` | 生产构建 |
| `npm run format` | 统一 ESLint `--fix` 自动修复（共享格式规则见根 `eslint.shared.ts`） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test` | 运行 vitest 测试 |

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

## 技术栈

- **路由** — App Router（Server Components + Server Actions + API Routes）
- **测试** — vitest + node
- **路径别名** — `@/` 指向 `packages/web/src/`
